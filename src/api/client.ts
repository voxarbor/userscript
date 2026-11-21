// The server's script API (/v1) as the userscript calls it: JSON in and out, audio as bytes. The shapes come from
// the server's OpenAPI (schema.d.ts, generated): a change of the API there fails this module's type check.
import { type Proposed, said } from '../core/said';
import type { HttpRequest } from '../platform/gm';
import type { components } from './schema';

type Schemas = components['schemas'];
/** The body of POST /v1/videos: the video, the voice settings and, when asked, the page's data. */
export type VideoIn = Schemas['VideoIn'];
/** What the page tells about the video (`page` of POST /v1/videos). */
export type PageData = Schemas['PageIn'];
export type VideoOut = Schemas['VideoOut'];
export type SegmentsOut = Schemas['SegmentsOut'];
/** One phrase: its place in the video, its texts and the path of its audio once voiced. */
export type Segment = Schemas['SegmentOut'];
export type Voice = Schemas['VoiceOut'];
/** How many phrases of a video each voice has voiced. */
export type VideoVoices = Schemas['VideoVoicesOut'];
/** The voices a video has audio in already, each with the share of the video's phrases voiced in it. */
export type Voiced = Schemas['VoicedOut'];
export type SpeakersView = Schemas['SpeakersViewOut'];
export type SpeakerView = Schemas['SpeakerViewOut'];
/** «Увійти»: the codes of a sign-in (the device code is the script's secret, the user code the person sees). */
export type DeviceCode = Schemas['DeviceCodeOut'];

const TIMEOUT_MS = 30000;
/** The stretch of phrases one segments request asks for: long enough that a server restart (a minute or so) passes
 *  unheard on the audio already here (ahead of the refetch margin, scheduler.ts). */
export const WINDOW_S = 150;

/** A request the server refused (its HTTP status and answer) or that got no usable answer (status 0). said: the
 *  words for the person in its answer (`message`, proposed), as safe text; null when it gave none. */
export class ApiError extends Error {
  readonly said: string | null;

  constructor(
    readonly status: number,
    message: string,
    readonly body = '',
  ) {
    super(message);
    this.name = 'ApiError';
    let answer: Proposed | null = null;
    try {
      answer = JSON.parse(body) as Proposed | null;
    } catch {}
    this.said = said(answer && answer.message);
  }
}

/** Where the server is and who asks; read at every request, so a change in the settings acts at once. */
export interface Access {
  server: string;
  token: string;
}

export class ServerApi {
  /** This tab among the viewers of a video: two tabs at other places are two viewers of the server's queue. */
  private readonly tab = Math.random().toString(36).slice(2, 10);

  /** send: how a request leaves the page (the script manager's cross-origin request). trace: gets a line for
   *  every request as it ends (the journal); now: the clock it is timed with (ms). */
  constructor(
    private readonly send: (request: HttpRequest) => void,
    private readonly access: () => Access,
    private readonly trace: (line: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  /** Opens the video for this viewer (or changes its voice settings, or brings the page's data). With the place
   *  the viewer is at (from), a server that knows of it answers with the phrases from there too (window): this
   *  tab is then named, as in a poll. */
  video(body: VideoIn): Promise<VideoOut> {
    return this.ask('POST', '/v1/videos', body.from == null ? body : { ...body, tab: this.tab }, false);
  }

  /** The phrases of the window (WINDOW_S) from `from` (seconds). paused: the viewer does not watch now, so the video gets
   *  no viewer priority. */
  segments(key: string, from: number, paused: boolean): Promise<SegmentsOut> {
    const query = `from=${from.toFixed(2)}&window=${WINDOW_S}` + (paused ? '&paused=1' : '') + `&tab=${this.tab}`;
    return this.ask('GET', `/v1/videos/${encodeURIComponent(key)}/segments?${query}`, undefined, false);
  }

  /** Every voice: the default one first, the rest by name. */
  voices(): Promise<Voice[]> {
    return this.ask('GET', '/v1/voices', undefined, false);
  }

  /** What is ready for the video at this address, before it is opened: asking starts nothing on the server. */
  voiced(url: string): Promise<Voiced> {
    return this.ask('GET', '/v1/voiced?url=' + encodeURIComponent(url), undefined, false);
  }

  videoVoices(key: string): Promise<VideoVoices> {
    return this.ask('GET', `/v1/videos/${encodeURIComponent(key)}/voices`, undefined, false);
  }

  speakers(key: string): Promise<SpeakersView> {
    return this.ask('GET', `/v1/videos/${encodeURIComponent(key)}/speakers`, undefined, false);
  }

  /** Gives a speaker of the video a voice; null: back to the server's choice. */
  speakerVoice(key: string, speaker: string, voice: string | null): Promise<SpeakerView> {
    const path = `/v1/videos/${encodeURIComponent(key)}/speakers/${encodeURIComponent(speaker)}`;
    return this.ask('PUT', path, { voice } satisfies Schemas['SpeakerVoiceIn'], false);
  }

  /** Starts signing in: a new pair of codes for this device. */
  deviceCode(body: Schemas['DeviceIn']): Promise<DeviceCode> {
    return this.ask('POST', '/v1/device/code', body, false);
  }

  /** The token once the person let the script in; until then a refusal (400) that names why in its body. */
  deviceToken(body: Schemas['DeviceTokenIn']): Promise<Schemas['DeviceTokenOut']> {
    return this.ask('POST', '/v1/device/token', body, false);
  }

  /** A phrase's audio (or a voice sample): its bytes. path: as the server gave it, or a full address. */
  bytes(path: string): Promise<ArrayBuffer> {
    return this.ask<ArrayBuffer>('GET', path, undefined, true);
  }

  private ask<T>(method: string, path: string, body: object | undefined, binary: boolean): Promise<T> {
    const { server, token } = this.access();
    const home = server.replace(/\/+$/, '');
    const url = /^https?:/.test(path) ? path : home + path;
    const ours = url === home || url.startsWith(home + '/'); // the token goes to its own server only
    const began = this.now();
    const told = (result: string, more = ''): void =>
      this.trace(`${method} ${path.length > 160 ? path.slice(0, 160) + '…' : path} → ${result}, ${Math.round(this.now() - began)} ms${more}`);
    return new Promise<T>((resolve, reject) => {
      const fail = (status: number, message: string, body = ''): void => {
        told(message);
        reject(new ApiError(status, message, body));
      };
      const request: HttpRequest = {
        method,
        url,
        headers: { ...(ours ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        timeout: TIMEOUT_MS,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) return fail(r.status, `HTTP ${r.status}`, r.responseText);
          const own = /^server-timing:.*?\bdur=([\d.]+)/im.exec(r.responseHeaders || ''); // the server's own time
          const size = binary ? (r.response as ArrayBuffer | null)?.byteLength : r.responseText.length;
          const more = `${own ? ` (server ${own[1]} ms)` : ''}, ${size ?? 0} B`;
          if (binary) {
            told(String(r.status), more);
            return resolve(r.response as T);
          }
          let parsed: T;
          try {
            parsed = JSON.parse(r.responseText) as T;
          } catch {
            return fail(0, 'bad JSON');
          }
          told(String(r.status), more);
          resolve(parsed);
        },
        onerror: () => fail(0, 'network error'),
        ontimeout: () => fail(0, 'timeout'),
      };
      if (body) request.data = JSON.stringify(body);
      if (binary) request.responseType = 'arraybuffer';
      this.send(request);
    });
  }
}
