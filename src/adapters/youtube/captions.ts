// YouTube's player response: which audio the video has and which caption track to send. Pure rules, no DOM.

/** A format of the player response's streamingData.adaptiveFormats: only its audio track matters here. */
export interface AudioFormat {
  audioTrack?: { id?: string; audioIsDefault?: boolean; isAutoDubbed?: boolean } | null;
  [other: string]: unknown;
}

export interface AudioTrack {
  audioTrackId?: string;
}

export interface CaptionTrack {
  languageCode: string;
  kind?: string;
}

/** Original audio language: the original track (id suffix «.4»), else the default one that is no dub. YouTube's
 *  AI dubs («.10», isAutoDubbed) are never the original, even when YouTube makes one the default for a viewer in
 *  its language (a Ukrainian viewer gets the «uk.10» dub by default). */
export function originalLang(formats?: AudioFormat[] | null, audioTracks?: AudioTrack[] | null): string | null {
  const tracks = (formats || []).map((x) => x.audioTrack).filter((t) => !!t);
  const original = (id?: string): boolean => /\.4$/.test(id || '');
  const dub = (t: NonNullable<AudioFormat['audioTrack']>): boolean => !!t.isAutoDubbed || /\.10$/.test(t.id || '');
  const id = (tracks.find((t) => original(t.id)) || tracks.find((t) => t.audioIsDefault && !dub(t)) || {}).id ||
    ((audioTracks || []).find((a) => original(a.audioTrackId)) || {}).audioTrackId;
  return id ? id.split('.')[0]! : null;
}

/** YouTube already has a Ukrainian audio track (its own dub, or a creator's track) besides a non-Ukrainian
 *  original. */
export function ukrainianDub(formats?: AudioFormat[] | null, audioTracks?: AudioTrack[] | null): boolean {
  const base = (id?: string | null): string => (id || '').split('.')[0]!.split('-')[0]!.toLowerCase();
  const ids = (formats || []).map((x) => x.audioTrack && x.audioTrack.id)
    .concat((audioTracks || []).map((a) => a.audioTrackId));
  return base(originalLang(formats, audioTracks)) !== 'uk' && ids.some((id) => base(id) === 'uk');
}

/** Caption track to send: manual in the original language, then its auto (asr) track, then any manual, then
 *  the first. */
export function pickCaption<T extends CaptionTrack>(tracks: T[], lang?: string | null): { track: T; subs: 'asr' | 'manual' } | null {
  const base = (lang || '').split('-')[0];
  const same = (t: T): boolean => !!base && t.languageCode.split('-')[0] === base;
  const track = tracks.find((t) => same(t) && t.kind !== 'asr') || tracks.find((t) => same(t)) ||
    tracks.find((t) => t.kind !== 'asr') || tracks[0];
  return track ? { track, subs: track.kind === 'asr' ? 'asr' : 'manual' } : null;
}
