import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import { type HttpRequest, MemoryPlatform, scriptManager } from '../src/platform/gm';

const NAMES = ['GM', 'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'GM_registerMenuCommand', 'GM_openInTab', 'GM_setClipboard'];
afterEach(() => {
  for (const name of NAMES) delete (globalThis as Record<string, unknown>)[name];
});

test('the platform of the tests keeps values, records requests and menu commands', () => {
  const p = new MemoryPlatform({ settings: { voice: 'a' } });
  assert.deepEqual(p.getValue('settings', {}), { voice: 'a' });
  assert.deepEqual(p.getValue('ukDubOk', ['x']), ['x']); // the fallback while nothing is kept
  p.setValue('ukDubOk', ['y']);
  assert.deepEqual(p.getValue('ukDubOk', []), ['y']);
  let ran = 0;
  p.menu('Налаштування', () => ran++);
  p.menus[0]!.run();
  assert.deepEqual([p.menus[0]!.title, ran], ['Налаштування', 1]);
  p.openTab('https://vox.test/panel/connect');
  assert.deepEqual(p.tabs, ['https://vox.test/panel/connect']);
});

test('a manager with GM_* functions: its values are read and written as they are', async () => {
  const kept: Record<string, unknown> = { settings: { voice: 'a' } };
  Object.assign(globalThis, {
    GM_getValue: (key: string, fallback: unknown) => (key in kept ? kept[key] : fallback),
    GM_setValue: (key: string, value: unknown) => (kept[key] = value),
    GM_xmlhttpRequest: () => {},
  });
  const p = (await scriptManager())!;
  assert.deepEqual(p.getValue('settings', {}), { voice: 'a' });
  p.setValue('ukDubOk', ['u']);
  assert.deepEqual(kept.ukDubOk, ['u']);
});

test('a manager with the promise-based GM.* only (Greasemonkey 4, Userscripts): values read ahead, kept as JSON text', async () => {
  const kept: Record<string, unknown> = { settings: JSON.stringify({ voice: 'a' }), videoVoice: 'not json' };
  const sent: HttpRequest[] = [];
  const tabs: [string, boolean][] = [];
  Object.assign(globalThis, {
    GM: {
      getValue: async (key: string) => kept[key],
      setValue: async (key: string, value: unknown) => void (kept[key] = value),
      xmlHttpRequest: (r: HttpRequest) => sent.push(r),
      openInTab: (url: string, background: boolean) => tabs.push([url, background]),
    },
  });
  const p = (await scriptManager())!;
  assert.deepEqual([p.getValue('settings', {}), p.getValue('videoVoice', []), p.getValue('ukDubOk', ['x'])], [{ voice: 'a' }, [], ['x']]);
  p.setValue('ukDubOk', ['u']);
  assert.deepEqual([p.getValue('ukDubOk', []), kept.ukDubOk], [['u'], '["u"]']);
  kept.settings = JSON.stringify({ voice: 'b' }); // another tab wrote meanwhile: seen after reload()
  await p.reload();
  assert.deepEqual(p.getValue('settings', {}), { voice: 'b' });
  p.request({ url: 'x' } as HttpRequest);
  p.openTab('https://vox.test/panel/connect');
  p.menu('m', () => {}); // no menu there: nothing happens
  assert.deepEqual([sent.length, tabs], [1, [['https://vox.test/panel/connect', false]]]);
});

test('a manager with neither gives no platform', async () => {
  assert.equal(await scriptManager(), null);
  Object.assign(globalThis, { GM: { getValue: async () => undefined } }); // no requests: the script cannot work
  assert.equal(await scriptManager(), null);
});
