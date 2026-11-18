// VoxArbor UA scheduler: pure functions (no DOM) of playback timing. Times are media seconds.
import type { Phrase } from './types';

const TOLERANCE = 0.15; // start window around a phrase's start
const LATE = 0.6; // a phrase whose audio came late still starts this far into it, rather than being skipped
const MAX_SHIFT = 1; // the longest a phrase waits for the one before it
const REFETCH_MARGIN = 20; // refetch when this close to the window end
const FADE = 0.08; // s: a phrase cut short fades out this long instead of ending mid-word
const KEEP_BEHIND = 30; // phrases (and their audio) are kept this far behind the position
const KEEP_AHEAD = 120; // ... and this far ahead of it
const HOLD_LOW = 1; // waitForVoice: pause when less voiced audio is ahead
const HOLD_HIGH = 10; // ... and resume once this much is ready (owner: 20 s made the start too slow)
const READY_SHARE = 0.8; // a video with this share of its phrases voiced in a voice is ready in it
const STUCK_MS = 8000; // held this long with a voiced run further on: skip the phrase without audio

/** Phrases to start now: from 150 ms before their start to 600 ms into it (audio that came a little late is heard
 *  from there rather than skipped), not handled yet. */
export function due<T extends Phrase>(segments: T[], t: number, playing: boolean, done?: { has(i: number): boolean } | null): T[] {
  if (!playing) return [];
  return segments.filter((s) => !(done && done.has(s.i)) && t >= s.start - TOLERANCE && t <= s.start + LATE);
}

/** The free time of seg's slot: from its start to the phrase after it in segments (sorted by start; to its own end
 *  when it is the last), less its audio of `duration` seconds. 0 when the audio fills the slot or runs over it. */
export function roomOf<T extends Phrase>(seg: T, duration: number, segments: T[]): number {
  const after = segments[segments.indexOf(seg) + 1];
  return Math.max(0, (after ? after.start : seg.end) - seg.start - duration);
}

/** Start time for seg when the phrase before it ends at prevEnd, after seg's start (it ran over its slot): seg
 *  waits for it as far as seg has room (roomOf), so the delay is taken up in seg's own slot and does not pass on
 *  to the phrases after it (owner, 2026-11-15); what the room does not cover is cut off the phrase before, which
 *  fades out. A lag over 1 s is not waited for at all. */
export function nextStart(prevEnd: number | null | undefined, seg: { start: number }, room: number): number {
  const lag = prevEnd == null ? 0 : prevEnd - seg.start;
  return lag > 0 && lag <= MAX_SHIFT ? seg.start + Math.min(lag, room) : seg.start;
}

/** The part of an audio parameter fadeStop uses (an AudioParam, or a fake in tests). */
export interface FadingParam {
  value: number;
  cancelScheduledValues(at: number): unknown;
  setValueAtTime(value: number, at: number): unknown;
  linearRampToValueAtTime(value: number, at: number): unknown;
}

/** A playing phrase: its source and, when it has one, its own gain node. */
export interface Sounding {
  src: { stop(at?: number): void };
  g?: { gain: FadingParam } | null;
}

/** Cut a playing phrase short at audio time now: its gain ramps to 0 over FADE and the source stops at the end
 *  of the ramp (a hard stop ended the sound mid-word with a click). */
export function fadeStop(item: Sounding, now: number, fade: number = FADE): void {
  if (!item.g) {
    item.src.stop(now);
    return;
  }
  const p = item.g.gain;
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.linearRampToValueAtTime(0, now + fade);
  item.src.stop(now + fade);
}

export function needFetch(t: number, windowEnd: number | null | undefined): boolean {
  return windowEnd == null || t >= windowEnd - REFETCH_MARGIN;
}

/** Seconds of voiced audio ahead of t: until the first phrase without audio, otherwise until the last known
 *  phrase end (or horizon, if the list is complete up to it). */
export function bufferedAhead(segments: Phrase[], t: number, horizon?: number | null): number {
  let end = t;
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    if (s.end <= t) continue;
    if (!s.audio) return Math.max(0, s.start - t);
    end = Math.max(end, s.end);
  }
  return Math.max(end, horizon == null ? t : horizon) - t;
}

/** One step of a linear volume ramp. */
export function ramp(v: number, target: number, speed: number, dt: number): number {
  const step = speed * dt;
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

interface Span {
  start: number;
  end: number;
}

/** Duck the original from just before a voiced phrase until a bit after both it and its voice end, so the
 *  original's tail stays quiet and the volume doesn't pump between close phrases. */
export function shouldDuck(segs: Span[], items: Span[], t: number, lead = 0.25, hold = 0.6): boolean {
  return segs.some((x) => t >= x.start - lead && t < x.end + hold) ||
    items.some((x) => t >= x.start - lead && t < x.end + hold);
}

/** Whether playback must wait for voiced audio: never once ready, failed or offline; a UK click on a paused
 *  video (startHold) waits from the start, waitForVoice once the window is known. */
export function mustWait(now: {
  status?: string | null;
  offline?: boolean;
  startHold?: boolean;
  waitForVoice?: boolean;
  known?: boolean;
}): boolean {
  if (now.offline || now.status === 'ready' || now.status === 'error') return false;
  return !!now.startHold || (!!now.waitForVoice && !!now.known);
}

/** Duck the original: the whole session with duckAlways (unless the server is offline), otherwise near phrases. */
export function isDucked(now: { always?: boolean; offline?: boolean; near?: boolean }): boolean {
  return (!!now.always && !now.offline) || !!now.near;
}

/** A volume we didn't set (the user, or YouTube re-applying its own volume ~every minute and after resume) is
 *  the new base; while ducked it goes straight back down, since a 0.25 s ramp let the original blare for a
 *  moment. */
export function foreignVolume(vol: number, ducked: boolean, orig: number): { base: number; set: number } {
  return { base: vol, set: ducked ? Math.round(vol * orig * 1000) / 1000 : vol };
}

/** Next phrase audio to download (list sorted by start): the earliest voiced one not ended at t, not loaded or
 *  loading (bufs has it) and not waiting out a retry pause after a failure. */
export function nextToLoad<T extends Phrase>(
  list: T[],
  t: number,
  bufs: { has(i: number): boolean },
  failed: { get(i: number): number | undefined },
  now: number,
): (T & { audio: string }) | null {
  return list.find((s): s is T & { audio: string } =>
    !!s.audio && s.end > t && !bufs.has(s.i) && !((failed.get(s.i) || 0) > now)) || null;
}

/** A session switched off is kept for a while (parked); switching on again for the same video and voice resumes
 *  it instead of fetching and downloading everything anew. */
export function reusable<T extends { url: string; voice: string; until: number }>(
  parked: T | null | undefined,
  url: string,
  voice: string,
  now: number,
): parked is T {
  return !!parked && parked.url === url && parked.voice === voice && now < parked.until;
}

/** Voiced audio ahead of t: the server's voiced_until (end of the unbroken voiced run from the fetched window)
 *  when known, otherwise (after a seek or voice switch, until the next refetch) the estimate from the segments
 *  we hold. */
export function voiceAhead(
  voicedUntil: number | null | undefined,
  segments: Phrase[],
  t: number,
  horizon?: number | null,
): number {
  return voicedUntil == null ? bufferedAhead(segments, t, horizon) : Math.max(0, voicedUntil - t);
}

/** The voices to offer a viewer who switches the voice-over on, in place of voicing the video anew in their own:
 *  those the video is (nearly) all voiced in, the fullest first. None when the viewer's own voice is one of them.
 *  shares: voice -> the share of the video's phrases that have audio in it. */
export function readyVoices(shares: Record<string, number>, own: string): { voice: string; share: number }[] {
  const ready = Object.entries(shares).filter(([, share]) => share >= READY_SHARE);
  if (ready.some(([voice]) => voice === own)) return [];
  return ready.map(([voice, share]) => ({ voice, share })).sort((a, b) => b.share - a.share || a.voice.localeCompare(b.voice));
}

/** What the audio depends on besides the video: the chosen voice and how the speakers are voiced. */
export function voiceMode(
  voice: string,
  mode?: string | null,
  leadMale?: string | null,
  leadFemale?: string | null,
): string {
  return [voice, mode || '', leadMale || '', leadFemale || ''].join('|');
}

/** Phrases ahead in the fetched window still without audio: keep polling even on a ready video (after a voice
 *  or speaker voice change new audio arrives over ~60 s). */
export function windowIncomplete(list: Phrase[], t: number, windowEnd: number): boolean {
  return list.some((s) => !s.audio && s.end > t && s.start < windowEnd);
}

/** Voiced audio from the first voiced phrase after t on (skipping unvoiced phrases before it), counted from t:
 *  lets a long hold go on past one phrase the server got stuck on. */
export function voicedAfterGap(segments: Phrase[], t: number): number {
  const first = [...segments].sort((a, b) => a.start - b.start).find((s) => s.audio && s.end > t);
  return first ? Math.max(first.start, t) - t + bufferedAhead(segments, Math.max(first.start, t), null) : 0;
}

/** What a video that must wait for the voice does at t: 'pause' while it plays with too little voiced audio
 *  ahead; 'release' once it is held and enough is ready, or it is held for long and enough is voiced past the
 *  phrase the server got stuck on; null: stay as it is. heldMs: how long it has been held. */
export function holdStep(
  now: { held: boolean; paused: boolean; ahead: number; heldMs: number },
  segments: Phrase[],
  t: number,
): 'pause' | 'release' | null {
  if (!now.held) return !now.paused && now.ahead < HOLD_LOW ? 'pause' : null;
  const enough = now.ahead >= HOLD_HIGH || (now.heldMs > STUCK_MS && voicedAfterGap(segments, t) >= HOLD_HIGH);
  return enough ? 'release' : null;
}

/** A phrase too far from the position `from` to keep: it ended over 30 s before it or starts over 120 s after. */
export function outOfReach(seg: Span, from: number): boolean {
  return seg.end < from - KEEP_BEHIND || seg.start > from + KEEP_AHEAD;
}

/** How much of the video is prepared, in percent: all of a ready one; else the server's progress, which is a
 *  share of 1 or already a percentage. */
export function preparedPercent(status: string | null, progress: number | null): number {
  if (status === 'ready') return 100;
  const p = progress ?? 0;
  return Math.round(p <= 1 ? p * 100 : p) || 0;
}
