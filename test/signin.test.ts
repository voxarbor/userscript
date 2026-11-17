import assert from 'node:assert/strict';
import { test } from 'vitest';

import { ApiError } from '../src/api/client';
import { deviceName, signIn, type SignInHost } from '../src/core/signin';
import { SERVER } from '../src/settings/store';

const CODE = { device_code: 'dev-secret', user_code: 'BCDF-GHJK', expires_in: 20, interval: 5 };
const wait = (error: string) => new ApiError(400, 'HTTP 400', JSON.stringify({ error }));

/** A server that answers the polls in turn (a token string, or an error); what was asked and waited is noted. */
function host(answers: (string | ApiError)[]) {
  const asked: string[] = [];
  const waited: number[] = [];
  const opened: string[] = [];
  const h: SignInHost = {
    api: {
      deviceCode: async (body) => (asked.push('code ' + body.name), CODE),
      deviceToken: async (body) => {
        asked.push('token ' + body.device_code);
        const next = answers.shift();
        if (next === undefined) throw new Error('asked once too often');
        if (next instanceof ApiError) throw next;
        return { token: next, login: 'ann', name: 'Firefox' };
      },
    },
    openTab: (url) => opened.push(url),
    wait: async (ms) => void waited.push(ms),
  };
  return { h, asked, waited, opened };
}

test('the script shows the code, opens the site on it and polls until the person lets it in', async () => {
  const { h, asked, waited, opened } = host([wait('authorization_pending'), 'vxa_tok']);
  const shown: string[] = [];
  assert.deepEqual(await signIn(h, 'Firefox · Windows', (code) => shown.push(code)), { token: 'vxa_tok', login: 'ann', name: 'Firefox' });
  assert.deepEqual(shown, ['BCDF-GHJK']);
  assert.deepEqual(opened, [`${SERVER}/panel/connect?code=BCDF-GHJK`]); // no secret in it
  assert.deepEqual(asked, ['code Firefox · Windows', 'token dev-secret', 'token dev-secret']);
  assert.deepEqual(waited, [5000, 5000]); // the first poll waits too: the person needs a moment
});

test('asked to slow down, the script waits five seconds longer', async () => {
  const { h, waited } = host([wait('slow_down'), wait('authorization_pending'), 'vxa_tok']);
  assert.equal((await signIn(h, 'x', () => {})).token, 'vxa_tok');
  assert.deepEqual(waited, [5000, 10000, 10000]);
});

test('a lost answer is polled again; a refusal, an expired code and a refused request end it in words', async () => {
  assert.equal((await signIn(host([new ApiError(0, 'timeout'), 'vxa_tok']).h, 'x', () => {})).token, 'vxa_tok');
  const failed = async (answers: (string | ApiError)[]): Promise<string> => {
    try {
      await signIn(host(answers).h, 'x', () => {});
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('did not fail');
  };
  assert.equal(await failed([wait('access_denied')]), 'На сайті відмовлено');
  assert.equal(await failed([wait('expired_token')]), 'Код застарів: натисніть «Увійти» ще раз');
  assert.equal(await failed([new ApiError(429, 'HTTP 429')]), 'Не вдалося: HTTP 429');
  // the code's time runs out while nobody answers: 20 s, polls every 5 s
  assert.equal(await failed(Array(4).fill(wait('authorization_pending'))), 'Код застарів: натисніть «Увійти» ще раз');
});

test('the device is named by its browser and system', () => {
  const ua = {
    firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    android: 'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    chrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
  assert.equal(deviceName(ua.firefox), 'Firefox · Windows');
  assert.equal(deviceName(ua.edge), 'Edge · Windows');
  assert.equal(deviceName(ua.android), 'Firefox · Android');
  assert.equal(deviceName(ua.mac), 'Safari · macOS');
  assert.equal(deviceName(ua.chrome), 'Chrome · Linux');
  assert.equal(deviceName('curl/8'), 'Браузер');
});
