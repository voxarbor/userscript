import assert from 'node:assert/strict';
import { test } from 'vitest';

import { ApiError } from '../src/api/client';
import { autoLink, onPanel, type LinkBox, type LinkHost } from '../src/core/autolink';

/** The «Скрипт» page's #script-link as the script sees it, and a server that hands out one token. */
function page(code = 'dev-once', login = 'ann') {
  const slots: Record<string, { textContent: string; onclick: null | (() => void) }> = {
    '[data-slot="other"]': { textContent: '', onclick: null },
    '[data-slot="error"]': { textContent: '', onclick: null },
    '#script-relink': { textContent: '', onclick: null },
  };
  const box: LinkBox = { dataset: { code, login }, querySelector: (s) => slots[s] ?? null };
  return { box, slots };
}

function host(settings: { token: string; account: string }, answer: ApiError | null = null) {
  const asked: string[] = [];
  const h: LinkHost = {
    settings,
    api: {
      deviceToken: async (body) => {
        asked.push(body.device_code);
        if (answer) throw answer;
        return { token: 'vxa_new', login: 'ann', name: 'Firefox · Windows' };
      },
    },
    saved: () => asked.push('saved'),
  };
  return { h, asked };
}

test('a script not connected yet connects on the page by itself, without a question', async () => {
  const { box } = page();
  const settings = { token: '', account: '' };
  const { h, asked } = host(settings);
  await autoLink(box, h);
  assert.deepEqual(asked, ['dev-once', 'saved']);
  assert.deepEqual(settings, { token: 'vxa_new', account: 'ann · Firefox · Windows' });
  assert.equal(box.dataset.state, 'connected');
});

test('a script connected to this account already keeps its token and says so', async () => {
  const { box } = page();
  const settings = { token: 'vxa_old', account: 'ann · Chrome · Linux' };
  const { h, asked } = host(settings);
  await autoLink(box, h);
  assert.deepEqual(asked, []);
  assert.equal(settings.token, 'vxa_old');
  assert.equal(box.dataset.state, 'connected');
});

test('a script connected to another account is not switched silently: the page asks, a press switches it', async () => {
  const { box, slots } = page();
  const settings = { token: 'vxa_bob', account: 'bob · Firefox · Windows' };
  const { h, asked } = host(settings);
  await autoLink(box, h);
  assert.deepEqual(asked, []);
  assert.equal(box.dataset.state, 'other');
  assert.equal(slots['[data-slot="other"]']!.textContent, 'bob');
  await (slots['#script-relink']!.onclick as () => Promise<void>)();
  assert.equal(settings.token, 'vxa_new');
  assert.equal(box.dataset.state, 'connected');
});

test('«Підключити до цього» pressed twice: the one-time code is sent once and the page says «connected»', async () => {
  const { box, slots } = page();
  const settings = { token: 'vxa_bob', account: 'bob · Firefox · Windows' };
  const asked: string[] = [];
  // the server as it is: the code is good for one token, a second asking is refused
  const h: LinkHost = {
    settings,
    api: {
      deviceToken: async (body) => {
        asked.push(body.device_code);
        await Promise.resolve();
        if (asked.length > 1) throw new ApiError(400, 'HTTP 400', JSON.stringify({ error: 'expired_token' }));
        return { token: 'vxa_new', login: 'ann', name: 'Firefox · Windows' };
      },
    },
    saved: () => asked.push('saved'),
  };
  await autoLink(box, h);
  const press = slots['#script-relink']!.onclick as () => Promise<void>;
  await Promise.all([press(), press()]); // a double click: the second comes while the first is on its way
  await press(); // and one after the script is connected
  assert.deepEqual(asked, ['dev-once', 'saved']);
  assert.equal(settings.token, 'vxa_new');
  assert.equal(box.dataset.state, 'connected');
  assert.equal(slots['[data-slot="error"]']!.textContent, '');
});

test('a code the server refuses: the page says it failed, the old connection stays', async () => {
  const { box, slots } = page();
  const settings = { token: '', account: '' };
  const { h } = host(settings, new ApiError(400, 'HTTP 400', JSON.stringify({ error: 'expired_token' })));
  await autoLink(box, h);
  assert.equal(box.dataset.state, 'failed');
  assert.equal(settings.token, '');
  assert.match(slots['[data-slot="error"]']!.textContent, /застар/);
});

test('only the server\'s own «Скрипт» page is one to connect on', () => {
  assert.ok(onPanel({ origin: 'https://vox.example.org', pathname: '/panel/install' }, 'https://vox.example.org'));
  assert.ok(!onPanel({ origin: 'https://evil.example', pathname: '/panel/install' }, 'https://vox.example.org'));
  assert.ok(!onPanel({ origin: 'https://vox.example.org', pathname: '/panel/videos' }, 'https://vox.example.org'));
  assert.ok(!onPanel({ origin: 'https://vox.example.org', pathname: '/panel/install' }, '__VOXARBOR_SERVER__'));
});
