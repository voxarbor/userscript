// A stand-in VoxArbor UA server for the browser tests, made from the server's script API (api/script-openapi.json,
// the copy of its golden contract): every request the script makes and every answer given here is checked against
// that contract, and a mismatch is a test failure (FakeServer.broken). The script reaches it through the GM stub
// (e2e/page.ts), as it reaches the real one through the script manager.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const contract = JSON.parse(readFileSync(process.env.VOXARBOR_CONTRACT || fileURLToPath(new URL('../api/script-openapi.json', import.meta.url)), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(contract, 'api');

/** A request as the GM stub hands it over. */
export interface Asked {
  method: string;
  url: string;
  headers: Record<string, string>;
  data: string | null;
}

/** The answer for the GM stub: status 0 is a request that got no answer (onerror). */
export interface Answer {
  status: number;
  text: string;
  b64?: string;
  headers: string;
}

/** A phrase of the video: v grows when it is voiced anew (its audio gets another address); voiced false: no
 *  audio yet. */
export interface Phrase {
  i: number;
  start: number;
  end: number;
  v: number;
  voiced: boolean;
}

/** A request as it was made, with when (Date.now()) and its body read. */
export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
  auth: string;
  status: number;
  at: number;
}

/** A WAV of a tone, seconds long (decodeAudioData takes it as the phrases' Opus would be taken). */
export function wav(seconds: number, hz = 440, rate = 8000): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let k = 0; k < n; k++) b.writeInt16LE(hz ? Math.round(3000 * Math.sin((2 * Math.PI * hz * k) / rate)) : 0, 44 + k * 2);
  return b;
}

const VOICES = [
  { id: 'Speaker_53', label: 'Історик', name: 'Speaker_53', description: '', gender: 'male', sample: '/v1/voices/Speaker_53/sample.opus', changed: false },
  { id: 'anna', label: 'Анна', name: 'anna', description: '', gender: 'female', sample: '/v1/voices/anna/sample.opus', changed: false },
];

export class FakeServer {
  readonly calls: Call[] = [];
  /** What broke the contract: requests or answers that are not what script_openapi.json says. */
  readonly broken: string[] = [];
  /** The pages the script posted (POST /v1/videos with page). */
  readonly pages: Record<string, unknown>[] = [];
  status: string | null = 'ready';
  progress = 1;
  /** The answers ask for the page's captions until a page comes. */
  pageNeeded = false;
  /** Every request is answered so: a proxy's HTML page (503), or none at all (0); null: served. */
  down: 503 | 0 | null = null;
  /** The token the server wants; null: a script that is not connected may read too. */
  token: string | null = null;
  /** The sign-in is let in after this many asks for the token. */
  approveAfter = 2;
  phrases: Phrase[] = [];
  private tokenAsks = 0;

  constructor() {
    for (let k = 0; k < 150; k++) this.phrases.push({ i: k, start: 1 + 4 * k, end: 3.5 + 4 * k, v: 1, voiced: true });
  }

  /** The script's GM_xmlhttpRequest, answered. */
  handle(asked: Asked): Answer {
    const url = new URL(asked.url);
    const body = asked.data ? (JSON.parse(asked.data) as Record<string, unknown>) : null;
    const call: Call = { method: asked.method, path: url.pathname, query: url.searchParams, body, auth: asked.headers.Authorization || '',
      status: 0, at: Date.now() };
    this.calls.push(call);
    const answer = this.answer(call);
    call.status = answer.status;
    return answer;
  }

  /** The calls to a path (a regular expression over METHOD path). */
  made(pattern: RegExp): Call[] {
    return this.calls.filter((c) => pattern.test(`${c.method} ${c.path}`));
  }

  private check(schema: string, data: unknown, what: string): void {
    const valid = ajv.getSchema(`api#/components/schemas/${schema}`)!;
    if (!valid(data)) this.broken.push(`${what} is not ${schema}: ${ajv.errorsText(valid.errors)}`);
  }

  private json(status: number, schema: string | null, data: unknown, what: string): Answer {
    if (schema) this.check(schema, data, what);
    return { status, text: JSON.stringify(data), headers: 'content-type: application/json\r\nserver-timing: app;dur=1.0\r\n' };
  }

  private window(from: number, span: number, paused: boolean): Record<string, unknown> {
    const segments = this.phrases.filter((p) => p.end > from - 30 && p.start < from + span).map((p) => ({
      i: p.i, start: p.start, end: p.end, src: `phrase ${p.i}`, uk: `фраза ${p.i}`, speaker: null, voice: 'Speaker_53',
      audio: p.voiced ? `/v1/audio/p${p.i}v${p.v}.opus` : null,
    }));
    const voiced = segments.filter((s) => s.audio).map((s) => s.end);
    void paused;
    return { status: this.status, progress: this.progress, error: null, refused: null, page_needed: this.pageNeeded,
      voiced_until: voiced.length ? Math.max(...voiced) : 0, segments, voice: 'Speaker_53' };
  }

  private answer(c: Call): Answer {
    const what = `${c.method} ${c.path}`;
    if (this.down === 0) return { status: 0, text: '', headers: '' };
    if (this.down === 503) return { status: 503, text: '<html><body>503 Service Unavailable</body></html>', headers: 'content-type: text/html\r\n' };
    const audio = /^\/v1\/audio\/p(\d+)v(\d+)\.opus$/.exec(c.path);
    if (this.token !== null && !c.path.startsWith('/v1/device/') && c.auth !== `Bearer ${this.token}`) {
      return this.json(401, null, { detail: 'invalid token' }, what);
    }
    if (c.method === 'POST' && c.path === '/v1/videos') {
      this.check('VideoIn', c.body, 'the body of ' + what);
      const id = new URL(String(c.body!.url)).searchParams.get('v');
      if (c.body!.page) {
        this.pages.push(c.body!.page as Record<string, unknown>);
        this.pageNeeded = false;
      }
      const from = c.body!.from as number | undefined;
      const out = { video_key: `youtube:${id}`, status: this.status, source_lang: 'en', duration: 600, error: null,
        page_needed: this.pageNeeded, refused: null, voice: 'Speaker_53',
        ...(from != null && this.status !== null ? { window: this.window(from, 150, !!c.body!.paused) } : {}) };
      return this.json(200, 'VideoOut', out, what);
    }
    if (c.method === 'GET' && /^\/v1\/videos\/[^/]+\/segments$/.test(c.path)) {
      const from = Number(c.query.get('from'));
      return this.json(200, 'SegmentsOut', this.window(from, Number(c.query.get('window')), c.query.get('paused') === '1'), what);
    }
    if (c.method === 'GET' && audio) {
      const p = this.phrases.find((x) => x.i === Number(audio[1]));
      if (!p) return this.json(404, null, { detail: 'no such audio' }, what);
      return { status: 200, text: '', b64: wav(p.end - p.start - 0.2, 300 + 20 * p.v).toString('base64'), headers: 'content-type: audio/ogg\r\n' };
    }
    if (c.method === 'GET' && c.path === '/v1/voiced') return this.json(200, 'VoicedOut', { video_key: 'youtube:x', voices: {} }, what);
    if (c.method === 'GET' && c.path === '/v1/voices') {
      for (const v of VOICES) this.check('VoiceOut', v, what);
      return this.json(200, null, VOICES, what);
    }
    if (c.method === 'GET' && /^\/v1\/videos\/[^/]+\/voices$/.test(c.path)) return this.json(200, 'VideoVoicesOut', { total: 150, voices: { Speaker_53: 150 } }, what);
    if (c.method === 'GET' && /^\/v1\/videos\/[^/]+\/speakers$/.test(c.path)) {
      return this.json(200, 'SpeakersViewOut', { mode: 'one', lead_male: null, lead_female: null, speakers: [] }, what);
    }
    if (c.method === 'GET' && /^\/v1\/voices\/[^/]+\/sample\.opus$/.test(c.path)) return { status: 200, text: '', b64: wav(1).toString('base64'), headers: '' };
    if (c.method === 'POST' && c.path === '/v1/device/code') {
      this.check('DeviceIn', c.body, 'the body of ' + what);
      return this.json(200, 'DeviceCodeOut', { device_code: 'e2e-device', user_code: 'BCDF-GHJK', expires_in: 600, interval: 1 }, what);
    }
    if (c.method === 'POST' && c.path === '/v1/device/token') {
      this.check('DeviceTokenIn', c.body, 'the body of ' + what);
      if (++this.tokenAsks <= this.approveAfter) return this.json(400, 'DeviceWaitOut', { error: 'authorization_pending' }, what);
      return this.json(200, 'DeviceTokenOut', { token: this.token || 'vxa_e2e', login: 'tester', name: 'Chrome' }, what);
    }
    this.broken.push(`no such route in the fake: ${what}`);
    return this.json(404, null, { detail: 'Not Found' }, what);
  }
}
