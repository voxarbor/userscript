import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

import type { HttpRequest } from '../src/platform/gm';
import { installAudio } from './fake_audio';
import { fake, installDom } from './fake_dom';

vi.mock('../src/adapters/youtube/index', () => ({
  youtubeAdapter: {
    match: () => true,
    getVideo: () => document.querySelector('video'),
    getVideoUrl: () => 'https://www.youtube.com/watch?v=abcdefghijk',
    ukrainianDub: () => false,
    mountControls: (buttons: HTMLElement[]) => document.body.append(...buttons),
    wantsRemount: () => false,
    onNavigate: () => {},
    inAd: () => false,
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function page() {
  vi.useFakeTimers();
  const doc = installDom();
  installAudio();
  doc.found.video = Object.assign(doc.createElement('video'), { paused: false, currentTime: 0, volume: 1 });
  doc.body.append(doc.found.video);
  const values = new Map([['settings', JSON.stringify({ token: 'old', account: 'А' })]]);
  const sent: HttpRequest[] = [];
  let duringRead: (() => void) | undefined;
  vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=abcdefghijk'));
  vi.stubGlobal('window', { addEventListener: () => {} });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('GM', {
    getValue: async (key: string) => {
      const value = values.get(key);
      if (key === 'connection') duringRead?.();
      return value;
    },
    setValue: async (key: string, value: string) => { values.set(key, value); },
    xmlHttpRequest: (request: HttpRequest) => { sent.push(request); },
  });
  await import('../src/main');
  await vi.advanceTimersByTimeAsync(0);
  const answer = (request: HttpRequest, body: object, status = 200) =>
    request.onload({ status, responseText: JSON.stringify(body), response: null });
  const toggle = () => doc.body.all('button').find((b) => b.dataset.vot === 'main')!.fire('click');
  const open = () => sent.filter((r) => r.method === 'POST' && r.url.endsWith('/v1/videos'));
  return { answer, doc, open, sent, toggle, onConnectionRead: (run: () => void) => { duringRead = run; } };
}

test('№54 · «Озвучити новим» передає switch=true у першому POST з власним голосом', async () => {
  const p = await page();
  p.toggle();
  p.answer(p.sent[0]!, { voices: { anna: 1 } });
  await vi.advanceTimersByTimeAsync(0);
  p.answer(p.sent[1]!, [
    { id: 'anna', label: 'Анна', sample: '/anna' },
    { id: 'Speaker_53', label: 'Мій голос', sample: '/own' },
  ]);
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(p.open().length, 0);
  fake(p.doc.body.all('button').find((b) => b.textContent.startsWith('Озвучити новим:'))).fire('click');
  await vi.advanceTimersByTimeAsync(0);
  const body = JSON.parse(p.open()[0]!.data!);
  assert.deepEqual([body.voice, body.switch], ['Speaker_53', true]);
  p.toggle(); // зупинити озвучку, доки відкриття ще триває
  p.toggle(); // рішення вже збережено, повторно перемикати голос не треба
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(JSON.parse(p.open()[1]!.data!).switch, false);
});

test('№33 · після 401 від старого підключення вкладка перечитує GM.* і відкриває відео з новим', async () => {
  const p = await page();
  p.toggle();
  p.answer(p.sent[0]!, { voices: {} });
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(p.open()[0]?.headers.Authorization, 'Bearer old');

  const { scriptManager } = await import('../src/platform/gm');
  const { SettingsStore } = await import('../src/settings/store');
  const other = new SettingsStore((await scriptManager())!);
  Object.assign(other.current, { token: 'new', account: 'Б' });
  other.saveConnection();
  p.answer(p.open()[0]!, {}, 401);
  await vi.advanceTimersByTimeAsync(2);
  assert.equal(p.open()[1]?.headers.Authorization, 'Bearer new');
  assert.equal(new SettingsStore((await scriptManager())!).current.token, 'new');
});

test('№33 · обробник 401 не стирає підключення, збережене після читання старого', async () => {
  const p = await page();
  p.toggle();
  p.answer(p.sent[0]!, { voices: {} });
  await vi.advanceTimersByTimeAsync(1);
  const { scriptManager } = await import('../src/platform/gm');
  const { SettingsStore } = await import('../src/settings/store');
  const other = new SettingsStore((await scriptManager())!);
  p.onConnectionRead(() => {
    p.onConnectionRead(() => {});
    Object.assign(other.current, { token: 'new', account: 'Б' });
    other.saveConnection();
  });
  p.answer(p.open()[0]!, {}, 401);
  await vi.advanceTimersByTimeAsync(2);
  assert.equal(new SettingsStore((await scriptManager())!).current.token, 'new');
});
