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
  /** 'asr': YouTube's own recognition of the speech. */
  kind?: string;
  /** As the player names it: «English (auto-generated)». */
  name?: string;
}

/** A caption track to ask YouTube for. translatedFrom: YouTube's machine translation into `lang` of its own
 *  recognition in that language. */
export interface WantedTrack {
  lang: string;
  kind: 'manual' | 'asr';
  translatedFrom?: string;
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

/** The tracks the server gets besides the main one (`used`: the track that went as the main one, null: none did):
 *  the speech's own (the author's, then YouTube's recognition: the language of that one is the speech's) and
 *  English (the author's, then YouTube's translation of its recognition), each when the page has it. The server
 *  keeps translating what it did; the speech's own words are shown under the phrase and fill the author's gaps. */
export function extraTracks(tracks: CaptionTrack[], used: { lang: string | null; subs: 'manual' | 'asr' } | null): WantedTrack[] {
  const base = (lang: string): string => lang.split('-')[0]!.toLowerCase();
  const own = tracks.find((x) => x.kind === 'asr');
  const speech = own ? base(own.languageCode) : null;
  const authors = (lang: string | null): CaptionTrack | undefined =>
    (lang ? tracks.find((x) => x.kind !== 'asr' && base(x.languageCode) === lang) : undefined);
  const wanted: WantedTrack[] = [];
  const manual = authors(speech);
  if (manual) wanted.push({ lang: manual.languageCode, kind: 'manual' });
  if (own) wanted.push({ lang: own.languageCode, kind: 'asr' });
  if (speech !== 'en') {
    const english = authors('en');
    if (english) wanted.push({ lang: english.languageCode, kind: 'manual' });
    if (own) wanted.push({ lang: 'en', kind: 'asr', translatedFrom: own.languageCode });
  }
  return wanted.filter((w) => !(used && !w.translatedFrom && w.lang === used.lang && w.kind === used.subs));
}

/** Every track the player lists, as the server is told of them. */
export function listed(tracks: CaptionTrack[]): { lang: string; kind: string | null; name: string | null }[] {
  return tracks.slice(0, 300).map((x) => ({ lang: x.languageCode.slice(0, 40), kind: x.kind ? x.kind.slice(0, 20) : null,
    name: x.name ? x.name.slice(0, 200) : null }));
}
