// Small pure helpers of the voices window and the status text.

export interface Voice {
  id: string;
  gender?: string | null;
}

export function groupVoices<T extends Voice>(list?: T[] | null): { male: T[]; female: T[]; other: T[] } {
  const g: { male: T[]; female: T[]; other: T[] } = { male: [], female: [], other: [] };
  for (const v of list || []) (v.gender === 'male' ? g.male : v.gender === 'female' ? g.female : g.other).push(v);
  return g;
}

/** « ● 37%» after a voice that already has audio for this video (switching to it is instant). */
export function voicedMark(videoVoices: { voices?: Record<string, number>; total?: number } | null | undefined, id: string): string {
  const n = videoVoices && videoVoices.voices && videoVoices.voices[id];
  return n ? ` ● ${Math.round((100 * n) / ((videoVoices && videoVoices.total) || n))}%` : '';
}

export function fmtDur(sec?: number | null): string {
  if (sec == null) return '';
  const s = Math.round(sec);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
