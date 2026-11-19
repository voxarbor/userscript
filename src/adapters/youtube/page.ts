// What YouTube's page tells about the video: the player's response, and the caption track taken from it.
import type { PageData } from '../../api/client';
import { type AudioFormat, type AudioTrack, type CaptionTrack, extraTracks, listed, originalLang, pickCaption, ukrainianDub, type WantedTrack } from './captions';

/** One more caption track for the server (`page.tracks`). */
type PageTrack = NonNullable<PageData['tracks']>[number];

/** A caption track as the page keeps it: its name is text, or runs of text. */
interface PageCaptionTrack {
  languageCode: string;
  kind?: string;
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

interface PlayerElement extends HTMLElement, Player {
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
        audioTracks: copied(cr.audioTracks, (a) => ({ audioTrackId: a.audioTrackId })),
        captionTracks: copied(cr.captionTracks, (t) => ({ languageCode: t.languageCode, kind: t.kind,
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

/** The response of the page's player, when it is of the video the address names: on a short's page
 *  #movie_player is the hidden player of the video watched before, and its data are that video's. */
function playerResponse(): PlayerData | null {
  const mp = document.getElementById('movie_player') as PlayerElement | null;
  const pr = readPlayer(mp && (mp.wrappedJSObject || mp));
  return pr && pr.videoDetails.videoId === pageVideoId(location) ? pr : null;
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

const TRACKS_ROOM = 4_500_000; // the server takes 5 MB of caption files in one page, by its own count (weight)

/** How much of the server's limit a caption file takes: its JSON as the server writes it, where a letter outside
 *  ASCII is six characters. */
export function weight(json3: Json3): number {
  const text = JSON.stringify(json3);
  return text.length + 5 * text.replace(/[\x00-\x7f]+/g, '').length;
}

/** The address of a track's json3: the player's own timedtext request (it carries the player's token) with the
 *  language, the kind and the translation changed. */
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

/** The wanted tracks, fetched together over the player's own request `own`; one that cannot be had is left out,
 *  and so is one that no longer fits in `room` (weight) after those before it. */
export async function moreTracks(own: string, wanted: WantedTrack[], get: (url: string) => Promise<Json3 | null>, room: number): Promise<PageTrack[]> {
  const files = await Promise.all(wanted.map((w) => get(trackUrl(own, w)).catch(() => null)));
  const tracks: PageTrack[] = [];
  wanted.forEach((w, n) => {
    const json3 = files[n];
    if (!json3 || (room -= weight(json3)) < 0) return;
    tracks.push({ lang: w.lang, kind: w.kind, ...(w.translatedFrom ? { translated_from: w.translatedFrom } : {}), json3 });
  });
  return tracks;
}

/** Page data for the server: metadata and the caption track as raw json3. timedtext needs the player's PO token,
 *  so captions are switched on for a moment, the player's own request (with pot) is reused for the chosen track,
 *  and CC is put back as it was. Null when the page has no video data. */
export async function collectPage(): Promise<PageData | null> {
  const pr = playerResponse();
  const vd = pr && pr.videoDetails;
  if (!pr || !vd || !vd.videoId) return null;
  const cr = pr.captions.playerCaptionsTracklistRenderer;
  const lang = originalLang(pr.streamingData.adaptiveFormats, cr.audioTracks);
  const page: PageData = {
    video_id: vd.videoId,
    title: (vd.title || '').slice(0, 500),
    duration: Number(vd.lengthSeconds) || null,
    channel: (vd.author || '').slice(0, 200),
    lang,
    subs: null,
    caption_tracks: listed(cr.captionTracks), // every track the page has, whichever of them are sent
  };
  const pick = pickCaption(cr.captionTracks, lang);
  if (!pick) return page;
  const btn = document.querySelector<HTMLElement>('#movie_player .ytp-subtitles-button');
  const wasOn = !!btn && btn.getAttribute('aria-pressed') === 'true';
  const ours = (u: string): boolean => u.includes('/api/timedtext') && u.includes('pot=') && u.includes('v=' + vd.videoId);
  // YouTube clears the resource-timing buffer, so watch new requests with an observer (it sees entries as they
  // are added) and make the player request the track now: CC on (or off and on again when it was already on).
  let url = performance.getEntriesByType('resource').map((e) => e.name).filter(ours).pop();
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (ours(e.name)) url = e.name;
  });
  obs.observe({ type: 'resource' });
  try {
    if (!url && btn) {
      if (wasOn) {
        btn.click();
        await pause(150);
      }
      btn.click();
    }
    for (let i = 0; !url && i < 20; i++) await pause(400);
  } finally {
    obs.disconnect();
    if (btn && (btn.getAttribute('aria-pressed') === 'true') !== wasOn) btn.click(); // CC back as it was
  }
  if (!url) return page;
  const want = new URL(url);
  want.searchParams.set('fmt', 'json3');
  want.searchParams.set('lang', pick.track.languageCode);
  if (pick.subs === 'asr') want.searchParams.set('kind', 'asr');
  else want.searchParams.delete('kind');
  let json3 = await json3At(want.toString());
  let used: { lang: string | null; subs: 'manual' | 'asr' } = { lang: pick.track.languageCode, subs: pick.subs };
  if (!json3) {
    // the token may be tied to the track the player chose: take that one as it is
    const own = new URL(url);
    own.searchParams.set('fmt', 'json3');
    json3 = await json3At(own.toString());
    used = { lang: own.searchParams.get('lang'), subs: own.searchParams.get('kind') === 'asr' ? 'asr' : 'manual' };
  }
  if (!json3) return page;
  // besides the main track: the speech's own tracks and English (extraTracks), as far as the server's limit goes
  const tracks = await moreTracks(url, extraTracks(cr.captionTracks, used.lang ? { lang: used.lang, subs: used.subs } : null),
    json3At, TRACKS_ROOM - weight(json3));
  return { ...page, subs: used.subs, subs_lang: used.lang, json3, ...(tracks.length ? { tracks } : {}) };
}

/** YouTube itself offers a Ukrainian audio track for this video (multi-language audio / dubbing). */
export function hasUkrainianDub(): boolean {
  const pr = playerResponse();
  return !!pr && ukrainianDub(pr.streamingData.adaptiveFormats, pr.captions.playerCaptionsTracklistRenderer.audioTracks);
}
