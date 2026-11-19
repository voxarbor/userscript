import assert from 'node:assert/strict';
import { test } from 'vitest';

import { ApiError, ServerApi } from '../src/api/client';
import type { HttpRequest, HttpResponse } from '../src/platform/gm';

/** A transport that answers every request with what `answer` returns ('error', 'timeout' or a response). */
function fake(answer: (r: HttpRequest) => Partial<HttpResponse> | 'error' | 'timeout') {
  const sent: HttpRequest[] = [];
  const send = (r: HttpRequest): void => {
    sent.push(r);
    const a = answer(r);
    if (a === 'error') r.onerror();
    else if (a === 'timeout') r.ontimeout();
    else r.onload({ status: 200, responseText: '', response: null, ...a });
  };
  return { sent, send };
}
const where = { server: 'https://vox.test/', token: 'tok' };

test('a JSON request goes to the server of the settings with the script token', async () => {
  const { sent, send } = fake(() => ({ responseText: '{"video_key":"youtube:abc"}' }));
  const api = new ServerApi(send, () => where);
  assert.equal((await api.video({ url: 'u', page_support: true })).video_key, 'youtube:abc');
  const r = sent[0]!;
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://vox.test/v1/videos'); // one slash, whatever the setting ends with
  assert.deepEqual(r.headers, { Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
  assert.equal(r.data, '{"url":"u","page_support":true}');
  assert.equal(r.timeout, 30000);
  assert.equal(r.responseType, undefined);
});

test('a GET has no body and no content type; the settings are read at each request', async () => {
  const now = { ...where };
  const { sent, send } = fake(() => ({ responseText: '[]' }));
  const api = new ServerApi(send, () => now);
  await api.voices();
  now.server = 'http://127.0.0.1:8780';
  now.token = 'other';
  await api.speakerVoice('youtube:k', 'A/1', null);
  assert.equal(sent[0]!.url, 'https://vox.test/v1/voices');
  assert.deepEqual(sent[0]!.headers, { Authorization: 'Bearer tok' });
  assert.equal(sent[0]!.data, undefined);
  assert.equal(sent[1]!.method, 'PUT');
  assert.equal(sent[1]!.url, 'http://127.0.0.1:8780/v1/videos/youtube%3Ak/speakers/A%2F1');
  assert.equal(sent[1]!.headers.Authorization, 'Bearer other');
  assert.equal(sent[1]!.data, '{"voice":null}');
});

test('audio is fetched as bytes, from the path the server gave or from a full address', async () => {
  const bytes = new ArrayBuffer(4);
  const { sent, send } = fake(() => ({ response: bytes }));
  const api = new ServerApi(send, () => where);
  assert.equal(await api.bytes('/v1/audio/ab.opus'), bytes);
  await api.bytes('https://cdn.test/x.opus');
  assert.equal(sent[0]!.responseType, 'arraybuffer');
  assert.equal(sent[0]!.url, 'https://vox.test/v1/audio/ab.opus');
  assert.equal(sent[1]!.url, 'https://cdn.test/x.opus');
});

test('a refusal carries its HTTP status; no answer at all has status 0', async () => {
  const failing = (a: Parameters<typeof fake>[0]) => new ServerApi(fake(a).send, () => where).voices();
  const status = async (p: Promise<unknown>): Promise<[number, string]> => {
    try {
      await p;
    } catch (e) {
      assert.ok(e instanceof ApiError);
      return [e.status, e.message];
    }
    throw new Error('did not fail');
  };
  assert.deepEqual(await status(failing(() => ({ status: 401 }))), [401, 'HTTP 401']);
  assert.deepEqual(await status(failing(() => ({ status: 503 }))), [503, 'HTTP 503']);
  assert.deepEqual(await status(failing(() => ({ responseText: '<html>' }))), [0, 'bad JSON']);
  assert.deepEqual(await status(failing(() => 'error')), [0, 'network error']);
  assert.deepEqual(await status(failing(() => 'timeout')), [0, 'timeout']);
});

test('a video is asked for by its key: the phrases of a minute, its voices and its speakers', async () => {
  const { sent, send } = fake(() => ({ responseText: '{}' }));
  const api = new ServerApi(send, () => where);
  await api.segments('youtube:abc', 12.345, false);
  await api.segments('youtube:abc', 0, true); // the viewer does not watch now
  await api.videoVoices('youtube:abc');
  await api.speakers('youtube:abc');
  await api.voiced('https://www.youtube.com/watch?v=abc&t=5'); // by its address, before it is opened
  const tab = /tab=([a-z0-9]+)/.exec(sent[0]!.url)?.[1]; // one id for the tab, the same in every poll
  assert.ok(tab && tab.length >= 6);
  assert.deepEqual(sent.map((r) => r.method + ' ' + r.url.slice('https://vox.test'.length)), [
    `GET /v1/videos/youtube%3Aabc/segments?from=12.35&window=60&tab=${tab}`,
    `GET /v1/videos/youtube%3Aabc/segments?from=0.00&window=60&paused=1&tab=${tab}`,
    'GET /v1/videos/youtube%3Aabc/voices',
    'GET /v1/videos/youtube%3Aabc/speakers',
    'GET /v1/voiced?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc%26t%3D5',
  ]);
});

test('signing in asks for a code and polls for the token; a refusal keeps the server\'s answer', async () => {
  const { sent, send } = fake((r) => (r.url.endsWith('/token') ? { status: 400, responseText: '{"error":"slow_down"}' } : { responseText: '{}' }));
  const api = new ServerApi(send, () => where);
  await api.deviceCode({ name: 'Firefox' });
  const refused = await api.deviceToken({ device_code: 'dev' }).catch((e: unknown) => e);
  assert.deepEqual(sent.map((r) => [r.method, r.url, r.data]), [
    ['POST', 'https://vox.test/v1/device/code', '{"name":"Firefox"}'],
    ['POST', 'https://vox.test/v1/device/token', '{"device_code":"dev"}'], // the code in the body, not the address
  ]);
  assert.ok(refused instanceof ApiError);
  assert.deepEqual([refused.status, refused.body], [400, '{"error":"slow_down"}']);
});

test('opening a video at a place names this tab, as a poll does; a POST without a place names none', async () => {
  const { sent, send } = fake(() => ({ responseText: '{}' }));
  const api = new ServerApi(send, () => where);
  await api.video({ url: 'u', page_support: true, from: 12.5 });
  await api.segments('youtube:k', 12.5, false);
  await api.video({ url: 'u', page_support: true });
  const tab = /&tab=(\w+)$/.exec(sent[1]!.url)![1];
  assert.equal(sent[0]!.data, `{"url":"u","page_support":true,"from":12.5,"tab":"${tab}"}`);
  assert.equal(sent[2]!.data, '{"url":"u","page_support":true}');
});

test('every request is told to the journal when it ends: how long it took, the server\'s own time, the size', async () => {
  const lines: string[] = [];
  let now = 1000;
  const answers: Record<string, Partial<HttpResponse> | 'error' | 'timeout'> = {
    '/v1/videos': { responseText: '{"video_key":"k"}', responseHeaders: 'content-type: application/json\r\nServer-Timing: app;dur=12.3\r\n' },
    '/v1/audio/ab.opus': { response: new ArrayBuffer(2048) },
    '/v1/voices': { status: 503, responseText: 'busy' },
    '/v1/voiced?url=u': 'timeout',
  };
  const { send } = fake((r) => {
    now += 140;
    return answers[r.url.slice('https://vox.test'.length)] ?? 'error';
  });
  const api = new ServerApi(send, () => where, (line) => lines.push(line), () => now);
  await api.video({ url: 'u', page_support: true });
  await api.bytes('/v1/audio/ab.opus');
  await api.voices().catch(() => {});
  await api.voiced('u').catch(() => {});
  await api.speakers('k').catch(() => {});
  assert.deepEqual(lines, [
    'POST /v1/videos → 200, 140 ms (server 12.3 ms), 17 B',
    'GET /v1/audio/ab.opus → 200, 140 ms, 2048 B',
    'GET /v1/voices → HTTP 503, 140 ms',
    'GET /v1/voiced?url=u → timeout, 140 ms',
    'GET /v1/videos/k/speakers → network error, 140 ms',
  ]);
});
