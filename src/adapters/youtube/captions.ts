// YouTube's player response: which audio the video has and which caption track to send. Pure rules, no DOM.

/** A format of the player response's streamingData.adaptiveFormats: only its audio track matters here. */
export interface AudioFormat {
  audioTrack?: { id?: string; audioIsDefault?: boolean } | null;
  [other: string]: unknown;
}

export interface AudioTrack {
  audioTrackId?: string;
}

export interface CaptionTrack {
  languageCode: string;
  kind?: string;
}

/** Original audio language: the default audio track (id suffix «.4»); AI dubs end in «.10». */
export function originalLang(formats?: AudioFormat[] | null, audioTracks?: AudioTrack[] | null): string | null {
  const f = (formats || []).find((x) => x.audioTrack && x.audioTrack.audioIsDefault);
  const id = (f && f.audioTrack && f.audioTrack.id) ||
    ((audioTracks || []).find((a) => /\.4$/.test(a.audioTrackId || '')) || {}).audioTrackId;
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
