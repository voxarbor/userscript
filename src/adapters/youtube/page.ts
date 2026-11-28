// What YouTube's page tells about the video: the player's response, and the caption track taken from it.
import type { PageData } from '../../api/client';
import { type AudioFormat, type AudioTrack, type CaptionTrack, extraTracks, listed, originalCaptions, originalLang, pickCaption, ukrainianDub, type WantedTrack } from './captions';

/** One more caption track for the server (`page.tracks`). */
type PageTrack = NonNullable<PageData['tracks']>[number];

/** A caption track as the page keeps it: its name is text, or runs of text. */
interface PageCaptionTrack {
  languageCode: string;
  kind?: string;
  baseUrl?: string;
  name?: { simpleText?: string; runs?: ArrayLike<{ text?: string }> };
}

/** The player's response as the page keeps it: every part may be missing. */
interface PlayerResponse {
  videoDetails?: { videoId?: string; title?: string; lengthSeconds?: string; author?: string };
  captions?: { playerCaptionsTracklistRenderer?: { audioTracks?: AudioTrack[]; captionTracks?: PageCaptionTrack[] } };
  streamingData?: { adaptiveFormats?: AudioFormat[] };
}

/** The player element, as far as the script uses it. */
export interface Player {
  getPlayerResponse?(): PlayerResponse | undefined;
}

/** The player's API the captions are switched with (www and m.youtube.com have it). */
interface PlayerApi extends Player {
  isSubtitlesOn?(): boolean;
  getOption?(module: string, option: string): unknown;
  setOption?(module: string, option: string, value: unknown): void;
}

/** Firefox: an object of the script's world made the page's, so that the page's function can read it. */
declare const cloneInto: ((value: object, target: object) => object) | undefined;

interface PlayerElement extends HTMLElement, PlayerApi {
  /** Firefox: the page's own object behind the content script's view of it. */
  wrappedJSObject?: PlayerElement;
}

/** What the script reads of the player's response, as plain data of the script's own world. */
export interface PlayerData {
  videoDetails: { videoId?: string; title?: string; lengthSeconds?: string; author?: string };
  captions: { playerCaptionsTracklistRenderer: { audioTracks: AudioTrack[]; captionTracks: CaptionTrack[] } };
  streamingData: { adaptiveFormats: AudioFormat[] };
}

/** A list of the page copied item by item: the loop is ours, so no function of ours is handed to the page. */
function copied<T, R>(items: ArrayLike<T> | null | undefined, pick: (item: T) => R): R[] {
  const out: R[] = [];
  for (let i = 0; items && i < items.length; i++) out.push(pick(items[i]!));
  return out;
}

/** The parts of the player's response the script reads, copied out of the page. Where the script manager runs
 *  the script in a world of its own (Firefox), the page's objects can be read but the page cannot call a function
 *  of ours: `formats.find(...)` on the page's own array throws «Permission denied to access object». The rules
 *  (captions.ts) therefore get a copy, never the page's arrays. Null: no player, or it has no response yet. */
export function readPlayer(player: Player | null): PlayerData | null {
  const pr = player && player.getPlayerResponse && player.getPlayerResponse();
  if (!pr) return null;
  const vd = pr.videoDetails || {};
  const cr = (pr.captions || {}).playerCaptionsTracklistRenderer || {};
  const data: PlayerData = {
    videoDetails: { videoId: vd.videoId, title: vd.title, lengthSeconds: vd.lengthSeconds, author: vd.author },
    captions: {
      playerCaptionsTracklistRenderer: {
        audioTracks: copied(cr.audioTracks, (a) => ({ audioTrackId: a.audioTrackId,
          ...(a.captionTrackIndices ? { captionTrackIndices: copied(a.captionTrackIndices, (n) => Number(n)) } : {}) })),
        captionTracks: copied(cr.captionTracks, (t) => ({ languageCode: t.languageCode, kind: t.kind, baseUrl: t.baseUrl,
          name: (t.name && (t.name.simpleText || copied(t.name.runs, (r) => r.text || '').join(''))) || undefined })),
      },
    },
    streamingData: {
      adaptiveFormats: copied((pr.streamingData || {}).adaptiveFormats, (f) =>
        f.audioTrack
          ? { audioTrack: { id: f.audioTrack.id, audioIsDefault: f.audioTrack.audioIsDefault, isAutoDubbed: f.audioTrack.isAutoDubbed } }
          : {}),
    },
  };
  return JSON.parse(JSON.stringify(data)) as PlayerData; // plain data: what the page left undefined is not there
}

/** The id of the video the address is of (watch, shorts, live); null: not a video's page. */
export function pageVideoId(loc: Pick<Location, 'search' | 'pathname'>): string | null {
  return new URLSearchParams(loc.search).get('v') || (loc.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/) || [])[1] || null;
}

/** Why a page has no captions for the server (PageIn.subs_missing, docs/contract-proposal.md): no player of the
 *  page's video, the video has no caption tracks, the player made no caption request to reuse and the track's own
 *  address gave nothing, or the player's request was there but the tracks asked over it came back empty. */
export type SubsMissing = 'no_player' | 'no_tracks' | 'no_url' | 'fetch_failed';
/** The page as it is sent: PageIn and, while the server does not list it, why it has no captions. */
export type PageSent = PageData & { subs_missing?: SubsMissing };
/** What was collected; via: where the captions came from (the journal). */
export interface Collected {
  page: PageSent;
  via?: 'player' | 'base_url' | 'button';
  captionsTooLarge?: boolean;
}

/** The player of the page's video with what it tells, read through the page's own object (Firefox: behind the
 *  content script's view of it). A short on a computer has a player of its own (#shorts-player), while
 *  #movie_player keeps the video watched before; on m.youtube.com #movie_player is the short's. */
function player(): { api: PlayerApi; data: PlayerData } | null {
  const id = pageVideoId(location);
  for (const name of ['shorts-player', 'movie_player']) {
    const el = document.getElementById(name) as PlayerElement | null;
    const api = el && (el.wrappedJSObject || el);
    const data = readPlayer(api);
    if (api && data && data.videoDetails.videoId === id) return { api, data };
  }
  return null;
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Json3 = Record<string, unknown>;

/** A json3 caption file with events in it; null for anything else. */
async function json3At(url: string): Promise<Json3 | null> {
  try {
    const r = await fetch(url, { credentials: 'include' });
    const j = JSON.parse(r.ok ? await r.text() : '') as Json3 | null;
    return j && Array.isArray(j.events) && j.events.length ? j : null;
  } catch {
    return null;
  }
}

const ASK_MS = 8000; // how long the player is given to ask for captions once they are switched on

/** The player's own timedtext request for the video: it carries the player's PO token (pot), without which
 *  YouTube answers a web page's timedtext with nothing. One made before is taken; else `ask` makes the player ask
 *  (captions on) and the request is watched for (YouTube clears the resource-timing buffer, an observer sees
 *  entries as they are added). '' when none came. */
async function ownRequest(videoId: string, ask: (() => Promise<() => void>) | null): Promise<string> {
  const ours = (u: string): boolean => u.includes('/api/timedtext') && u.includes('pot=') && u.includes('v=' + videoId);
  let url = performance.getEntriesByType('resource').map((e) => e.name).filter(ours).pop() || '';
  if (url || !ask) return url;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (ours(e.name)) url = e.name;
  });
  obs.observe({ type: 'resource' });
  let back = (): void => {};
  try {
    back = await ask();
    for (let waited = 0; !url && waited < ASK_MS; waited += 200) await pause(200);
  } finally {
    obs.disconnect();
    back(); // the viewer's captions as they were
  }
  return url;
}

/** Captions of the track on through the player's API (setOption: every player tried on www and m.youtube.com in
 *  2026-11 asked for the track at once; m.youtube.com's toggleSubtitlesOn did nothing for a track of YouTube's
 *  recognition), off first when they were on, so that the player asks anew. -> what puts the viewer's captions
 *  back as they were: the track they had, or none */
async function captionsOn(p: PlayerApi, track: { languageCode: string; kind?: string }): Promise<() => void> {
  const set = (value: object): void =>
    p.setOption!('captions', 'track', typeof cloneInto === 'function' ? cloneInto(value, window) : value);
  const now = p.getOption!('captions', 'track') as { languageCode?: string } | null | undefined;
  const wasOn = p.isSubtitlesOn ? !!p.isSubtitlesOn() : !!(now && now.languageCode);
  const had = (wasOn && now ? JSON.parse(JSON.stringify(now)) : {}) as object;
  if (wasOn) {
    set({});
    await pause(150);
  }
  set(track);
  return () => set(had);
}

/** Captions on with the player's CC button (a computer's player without the API): pressed twice when they were
 *  on. -> what presses it back */
async function pressCC(btn: HTMLElement): Promise<() => void> {
  const on = (): boolean => btn.getAttribute('aria-pressed') === 'true';
  const wasOn = on();
  if (wasOn) {
    btn.click();
    await pause(150);
  }
  btn.click();
  return () => {
    if (on() !== wasOn) btn.click();
  };
}

const CAPTIONS_MAX = 5 * 1024 * 1024;
const EXTRA_TRACKS_MAX = 4;

/** How much of the server's limit a caption file takes: its JSON as the server writes it, where a letter outside
 *  ASCII is six characters. */
export function weight(json3: Json3): number {
  let exponentPadding = 0;
  const text = JSON.stringify(json3, (_key, value: unknown) => {
    // Python uses two digits in the exponent: 1e-07, 1e-08, 1e-09.
    if (typeof value === 'number' && Math.abs(value) >= 1e-9 && Math.abs(value) < 1e-6) exponentPadding++;
    return value;
  });
  return text.length + 5 * text.replace(/[\x00-\x7e]+/g, '').length + exponentPadding;
}

/** The address of a track's json3: a timedtext address (the player's own request, which carries its token, or a
 *  track's baseUrl) with the language, the kind and the translation changed. */
export function trackUrl(own: string, track: WantedTrack): string {
  const url = new URL(own);
  url.searchParams.set('fmt', 'json3');
  url.searchParams.set('lang', track.translatedFrom ?? track.lang);
  if (track.kind === 'asr') url.searchParams.set('kind', 'asr');
  else url.searchParams.delete('kind');
  if (track.translatedFrom) url.searchParams.set('tlang', track.lang);
  else url.searchParams.delete('tlang');
  return url.toString();
}

/** The track the player's own timedtext request is of, in its own language (not the one it is translated into). */
export function playerTrack(own: string): WantedTrack {
  const q = new URL(own).searchParams;
  return { lang: q.get('lang') || '', kind: q.get('kind') === 'asr' ? 'asr' : 'manual' };
}

/** The wanted tracks, fetched together over the timedtext address `own`; one that cannot be had is left out,
 *  and so is one that no longer fits in `room` (weight) after those before it. */
export async function moreTracks(own: string, wanted: WantedTrack[], get: (url: string) => Promise<Json3 | null>, room: number): Promise<PageTrack[]> {
  const files = await Promise.all(wanted.map((w) => get(trackUrl(own, w)).catch(() => null)));
  const tracks: PageTrack[] = [];
  for (const [n, w] of wanted.entries()) {
    const json3 = files[n];
    if (!json3) continue;
    const size = weight(json3);
    if (size > room) continue;
    room -= size;
    tracks.push({ lang: w.lang, kind: w.kind, ...(w.translatedFrom ? { translated_from: w.translatedFrom } : {}), json3 });
    if (tracks.length === EXTRA_TRACKS_MAX) break;
  }
  return tracks;
}

/** The main track over a timedtext address (the player's own request, or a track's baseUrl), never YouTube's
 *  translation (tlang: the player asks for one for a viewer who listens to a dub or chose translated captions, and
 *  the words would be in that language under the track's own label). Over the player's request the token may be
 *  tied to the track the player chose: then that one, in its own language. */
async function mainTrack(url: string, pick: { lang: string; subs: 'manual' | 'asr' }, own: boolean):
  Promise<{ json3: Json3; lang: string; subs: 'manual' | 'asr' } | null> {
  const json3 = await json3At(trackUrl(url, { lang: pick.lang, kind: pick.subs }));
  if (json3) return { json3, ...pick };
  if (!own) return null;
  const theirs = playerTrack(url);
  const again = theirs.lang ? await json3At(trackUrl(url, theirs)) : null;
  return again && { json3: again, lang: theirs.lang, subs: theirs.kind };
}

/** Page data for the server: metadata, the caption track as raw json3 and more tracks, or why there are none
 *  (subs_missing). The captions are asked for over the player's own timedtext request (its PO token): one made
 *  before, else one the player makes when the track is switched on through its API for a moment (www and
 *  m.youtube.com, no button pressed); else over the track's own address (baseUrl: YouTube answers it with nothing
 *  without a token, as far as seen in 2026-11, but a player may not need one); else, on a player without the API,
 *  CC is pressed for a moment. */
export async function collectPage(): Promise<Collected> {
  const found = player();
  const videoId = pageVideoId(location);
  if (!found) return { page: { video_id: videoId, subs: null, subs_missing: 'no_player' } };
  const { api, data: pr } = found;
  const vd = pr.videoDetails;
  const cr = pr.captions.playerCaptionsTracklistRenderer;
  const lang = originalLang(pr.streamingData.adaptiveFormats, cr.audioTracks);
  const page: PageSent = {
    video_id: vd.videoId,
    title: (vd.title || '').slice(0, 500),
    duration: Number(vd.lengthSeconds) || null,
    channel: (vd.author || '').slice(0, 200),
    lang,
    subs: null,
    caption_tracks: listed(cr.captionTracks), // every track the page has, whichever of them are sent
  };
  const pick = pickCaption(originalCaptions(cr.captionTracks, cr.audioTracks), lang);
  if (!pick) return { page: { ...page, subs_missing: 'no_tracks' } };
  const wanted = { lang: pick.track.languageCode, subs: pick.subs };
  const hasApi = typeof api.setOption === 'function' && typeof api.getOption === 'function';
  const track = { languageCode: pick.track.languageCode, ...(pick.subs === 'asr' ? { kind: 'asr' } : {}) };
  const btn = hasApi ? null : document.querySelector<HTMLElement>('#movie_player .ytp-subtitles-button');
  let hadOwn = false; // a request of the player's was had: its token did not do
  const ways: [NonNullable<Collected['via']>, () => Promise<string>][] = [
    ['player', () => ownRequest(vd.videoId!, hasApi ? () => captionsOn(api, track) : null)], // or one it made before
    ['base_url', async () => (pick.track.baseUrl ? new URL(pick.track.baseUrl, location.href).href : '')], // m.: relative
    ['button', () => (btn ? ownRequest(vd.videoId!, () => pressCC(btn)) : Promise.resolve(''))],
  ];
  for (const [via, way] of ways) {
    const url = await way();
    if (!url) continue;
    const own = via !== 'base_url';
    hadOwn ||= own;
    const main = await mainTrack(url, wanted, own);
    if (!main) continue;
    const room = CAPTIONS_MAX - weight(main.json3);
    if (room < 0) return { page: { ...page, subs_missing: 'fetch_failed' }, captionsTooLarge: true };
    // besides the main track: the speech's own tracks, English and Ukrainian (extraTracks), as far as the server's
    // limit goes
    const tracks = room ? await moreTracks(url, extraTracks(cr.captionTracks, { lang: main.lang, subs: main.subs }), json3At, room) : [];
    return { page: { ...page, subs: main.subs, subs_lang: main.lang, json3: main.json3, ...(tracks.length ? { tracks } : {}) }, via };
  }
  return { page: { ...page, subs_missing: hadOwn ? 'fetch_failed' : 'no_url' } };
}

/** YouTube itself offers a Ukrainian audio track for this video (multi-language audio / dubbing). */
export function hasUkrainianDub(): boolean {
  const pr = player()?.data;
  return !!pr && ukrainianDub(pr.streamingData.adaptiveFormats, pr.captions.playerCaptionsTracklistRenderer.audioTracks);
}
