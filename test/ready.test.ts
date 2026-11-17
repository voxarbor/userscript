import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { Voice } from '../src/api/client';
import { readyOffer } from '../src/core/ready';

const voice = (id: string, label: string): Voice =>
  ({ id, label, name: label, description: '', gender: null, changed: false, sample: `/v1/voices/${id}/sample.opus` });
const VOICES = [voice('anna', 'Анна'), voice('borys', 'Борис'), voice('taras', 'Тарас')];

/** A server whose video is voiced in these shares; asked: what was asked of it. */
function server(shares: Record<string, number> | Error) {
  const asked: string[] = [];
  return {
    asked,
    async voiced(url: string) {
      asked.push('voiced ' + url);
      if (shares instanceof Error) throw shares;
      return { video_key: 'k1', voices: shares };
    },
    async voices() {
      asked.push('voices');
      return VOICES;
    },
  };
}

test('a video ready in other voices: they are offered by name with their samples, and the viewer\'s own voice is named', async () => {
  const api = server({ borys: 1, anna: 0.87, gone: 0.9, taras: 0.2 });
  assert.deepEqual(await readyOffer(api, 'https://v/1', { voice: 'taras', mode: '' }, undefined), {
    ready: [{ voice: 'borys', share: 1, label: 'Борис', sample: '/v1/voices/borys/sample.opus' },
      { voice: 'anna', share: 0.87, label: 'Анна', sample: '/v1/voices/anna/sample.opus' }], // «gone» is no voice now
    own: 'Тарас',
  });
  assert.deepEqual(api.asked, ['voiced https://v/1', 'voices']);
});

test('nothing is offered, and the voices are not asked for, when no other voice is ready or the viewer\'s own is', async () => {
  for (const shares of [{}, { anna: 0.5 }, { anna: 1, taras: 0.9 }] as Record<string, number>[]) {
    const api = server(shares);
    assert.deepEqual(await readyOffer(api, 'u', { voice: 'taras', mode: 'one' }, undefined), { ready: [], own: '' });
    assert.deepEqual(api.asked, ['voiced u']);
  }
});

test('the server is not asked at all after an answer for this video or when the speakers are to be told apart', async () => {
  const api = server({ anna: 1 });
  assert.equal((await readyOffer(api, 'u', { voice: 'taras', mode: '' }, 'anna')).ready.length, 0); // took «anna» then
  assert.equal((await readyOffer(api, 'u', { voice: 'taras', mode: '' }, '')).ready.length, 0); // chose their own then
  assert.equal((await readyOffer(api, 'u', { voice: 'taras', mode: 'two' }, undefined)).ready.length, 0);
  assert.equal((await readyOffer(api, 'u', { voice: 'taras', mode: 'each' }, undefined)).ready.length, 0);
  assert.deepEqual(api.asked, []);
});

test('a server that cannot be asked offers nothing: the voice-over starts as it would', async () => {
  assert.deepEqual(await readyOffer(server(new Error('HTTP 404')), 'u', { voice: 'taras', mode: '' }, undefined), { ready: [], own: '' });
});
