import assert from 'node:assert/strict';
import { test } from 'vitest';

import { originalLang, pickCaption, ukrainianDub } from '../src/adapters/youtube/captions';
import { due, firstToHear, nextStart, roomOf, readyVoices, needFetch, bufferedAhead, ramp, shouldDuck, mustWait, isDucked, foreignVolume, nextToLoad, reusable, voiceAhead, voiceMode, windowIncomplete, voicedAfterGap, fadeStop, holdStep, outOfReach, preparedPercent, quietOutage, quietRetry } from '../src/core/scheduler';
import { groupVoices, voicedMark, fmtDur } from '../src/ui/format';

const seg = (i: number, start: number, end: number, audio: string | null = `/v1/audio/${i}.opus`) => ({ i, start, end, uk: 'x', audio });
const segs = [seg(0, 1, 3), seg(1, 5, 8), seg(2, 10, 12, null)];
const ids = (list: { i: number }[]) => list.map((s) => s.i);

test('due: nothing while paused', () => {
  assert.deepEqual(due(segs, 5, false), []);
});

test('due: starts phrase within +-150 ms', () => {
  assert.deepEqual(ids(due(segs, 4.86, true)), [1]);
  assert.deepEqual(ids(due(segs, 5, true)), [1]);
  assert.deepEqual(ids(due(segs, 5.14, true)), [1]);
});

test('due: a phrase whose audio came a little late still starts, up to 600 ms into it (not skipped)', () => {
  assert.deepEqual(ids(due(segs, 5.2, true)), [1]);
  assert.deepEqual(ids(due(segs, 5.6, true)), [1]);
  // however little of it is left to hear, as long as something is
  const short = [seg(0, 5, 6)];
  assert.deepEqual(ids(due(short, 5.5, true, null, () => 0.75)), [0]);
  assert.deepEqual(due(short, 5.5, true, null, () => 0.5), []); // its audio is over by then
});

test('due: too early phrases are not started, and neither is one that is over', () => {
  assert.deepEqual(due(segs, 4.8, true), []);
  assert.deepEqual(due(segs, 8, true), []);
  assert.deepEqual(due(segs, 9, true), []);
});

test('due: a phrase is joined in its middle (the start, a seek, another voice) while 0.7 s of it is left to hear', () => {
  const three = () => 3; // seconds of audio: phrase 1 sounds from 5 to 8
  assert.deepEqual(ids(due(segs, 5.65, true, null, three)), [1]);
  assert.deepEqual(ids(due(segs, 6.5, true, null, three)), [1]);
  assert.deepEqual(ids(due(segs, 7.25, true, null, three)), [1]);
  assert.deepEqual(due(segs, 7.4, true, null, three), []); // 0.6 s left: the next phrase is waited for
  assert.deepEqual(due(segs, 6.5, true, new Set([1]), three), []); // it sounds already
  assert.deepEqual(due(segs, 6.5, false, null, three), []);
});

test('due: what is left of a phrase is counted to the end of its audio, and no further than the next phrase', () => {
  assert.deepEqual(ids(due(segs, 5.75, true, null, () => 1.5)), [1]); // audio shorter than the slot: 0.75 s left
  assert.deepEqual(due(segs, 5.9, true, null, () => 1.5), []);
  const close = [seg(0, 1, 3), seg(1, 3, 6)];
  const long = (s: { i: number }) => (s.i === 0 ? 5 : 3); // phrase 0 runs over its slot
  assert.deepEqual(due(close, 2.5, true, null, long), []); // half a second until phrase 1: not worth starting
  assert.deepEqual(ids(due(close, 2.25, true, null, long)), [0]);
  assert.deepEqual(ids(due(close, 3.05, true, null, long)), [1]); // phrase 1 has begun: phrase 0 is not joined
});

test('firstToHear: the first voiced phrase that can still be heard: not begun yet, or with 0.7 s of its slot left', () => {
  const list = [seg(0, 1, 3), seg(1, 5, 8), seg(2, 10, 12, null), seg(3, 14, 16)];
  assert.equal(firstToHear(list, 0)!.i, 0);
  assert.equal(firstToHear(list, 2.25)!.i, 0); // 0.75 s of it left
  assert.equal(firstToHear(list, 2.5)!.i, 1); // half a second left: the one after it is the first to be heard
  assert.equal(firstToHear(list, 8)!.i, 3); // the unvoiced one is passed over
  assert.equal(firstToHear(list, 15.5), null);
  assert.equal(firstToHear([seg(0, 1, 9), seg(1, 3, 6)], 2.5)!.i, 1); // its slot ends where the next phrase starts
});

test('due: a phrase whose audio is not here yet is not due', () => {
  assert.deepEqual(due(segs, 5, true, null, () => undefined), []);
  assert.deepEqual(due(segs, 6.5, true, null, () => undefined), []);
});

test('due: already handled phrases are excluded', () => {
  assert.deepEqual(due(segs, 5, true, new Set([1])), []);
});

test('nextStart: no previous phrase or it already ended', () => {
  assert.equal(nextStart(null, seg(1, 5, 8), 1), 5);
  assert.equal(nextStart(4.2, seg(1, 5, 8), 1), 5);
});

test('nextStart: a phrase waits for the one before it as far as its own slot has room', () => {
  assert.equal(nextStart(5.4, seg(1, 5, 8), 1), 5.4); // the whole lag fits: nothing is cut, nothing passes on
  assert.equal(nextStart(6, seg(1, 5, 8), 1), 6);
  assert.equal(nextStart(5.6, seg(1, 5, 8), 0.25), 5.25); // room for a part of it: the rest is cut off the one before
  assert.equal(nextStart(5.6, seg(1, 5, 8), 0), 5); // no room: on time
});

test('nextStart: lag over 1 s is dropped', () => {
  assert.equal(nextStart(6.3, seg(1, 5, 8), 5), 5);
});

test('roomOf: the slot runs to the next phrase, the last one\'s to its own end; audio over the slot leaves none', () => {
  const list = [seg(1, 5, 7), seg(2, 8, 10)];
  assert.equal(roomOf(list[0]!, 1.5, list), 1.5); // 3 s to the next phrase, the pause between them counts
  assert.equal(roomOf(list[1]!, 1.5, list), 0.5);
  assert.equal(roomOf(list[0]!, 4, list), 0);
});

test('needFetch: no window yet, or less than 100 s of it left (a server restart passes on what is here)', () => {
  assert.equal(needFetch(0, null), true);
  assert.equal(needFetch(10, 150), false);
  assert.equal(needFetch(49, 150), false);
  assert.equal(needFetch(51, 150), true);
  assert.equal(needFetch(170, 150), true);
});

test('bufferedAhead: up to the first phrase without audio', () => {
  assert.equal(bufferedAhead(segs, 0), 10);
  assert.equal(bufferedAhead(segs, 9), 1);
  assert.equal(bufferedAhead(segs, 10.5), 0);
});

test('bufferedAhead: all ready -> end of last phrase, or the known horizon', () => {
  const ready = [seg(0, 1, 3), seg(1, 5, 8)];
  assert.equal(bufferedAhead(ready, 2), 6);
  assert.equal(bufferedAhead(ready, 2, 60), 58);
  assert.equal(bufferedAhead([], 2), 0);
});

test('bufferedAhead: ignores order of input', () => {
  assert.equal(bufferedAhead([seg(2, 10, 12, null), seg(1, 5, 8), seg(0, 1, 3)], 0), 10);
});

test('ramp: moves toward target by speed*dt without overshoot', () => {
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  assert.equal(r(ramp(1, 0.2, 3.2, 0.125)), 0.6);
  assert.equal(ramp(0.3, 0.2, 3.2, 0.125), 0.2);
  assert.equal(r(ramp(0.2, 1, 3.2, 0.125)), 0.6);
  assert.equal(ramp(0.5, 0.5, 3.2, 0.1), 0.5);
});

test('shouldDuck: covers the original phrase, leads it and holds across short gaps', () => {
  const segs = [{ start: 10, end: 12 }, { start: 12.5, end: 14 }, { start: 30, end: 31 }];
  assert.equal(shouldDuck(segs, [], 9.5), false);
  assert.equal(shouldDuck(segs, [], 9.8), true); // lead before the phrase
  assert.equal(shouldDuck(segs, [], 12.2), true); // gap shorter than hold
  assert.equal(shouldDuck(segs, [], 14.5), true); // hold after the phrase
  assert.equal(shouldDuck(segs, [], 14.7), false);
  assert.equal(shouldDuck(segs, [{ start: 30, end: 33 }], 32.9), true); // voice longer than the original
});

const st = (o: object) => Object.assign({ status: 'voicing', offline: false, startHold: false, waitForVoice: false, known: true }, o);

test('mustWait: UK click on a paused video waits even before the first answer', () => {
  assert.equal(mustWait(st({ startHold: true, status: null, known: false })), true);
});

test('mustWait: waitForVoice waits only once the window is known', () => {
  assert.equal(mustWait(st({ waitForVoice: true })), true);
  assert.equal(mustWait(st({ waitForVoice: true, known: false })), false);
});

test('mustWait: never waits when ready, failed, offline or not asked to', () => {
  assert.equal(mustWait(st({ startHold: true, status: 'ready' })), false);
  assert.equal(mustWait(st({ startHold: true, status: 'error' })), false);
  assert.equal(mustWait(st({ startHold: true, offline: true })), false);
  assert.equal(mustWait(st({})), false);
});


test('isDucked: duckAlways keeps the original quiet between phrases, but not while offline', () => {
  assert.equal(isDucked({ always: true, offline: false, near: false }), true);
  assert.equal(isDucked({ always: true, offline: true, near: false }), false);
});

test('isDucked: without duckAlways only around phrases', () => {
  assert.equal(isDucked({ always: false, offline: false, near: true }), true);
  assert.equal(isDucked({ always: false, offline: false, near: false }), false);
});


test('foreignVolume: a volume we did not set becomes the base and snaps straight back down while ducked', () => {
  assert.deepEqual(foreignVolume(0.92, true, 0.1), { base: 0.92, set: 0.092 });
});

test('foreignVolume: not ducked -> keep the new volume as is', () => {
  assert.deepEqual(foreignVolume(0.6, false, 0.1), { base: 0.6, set: 0.6 });
});


test('nextToLoad: nearest voiced phrase that has not ended, is not loaded/loading and not in a retry pause', () => {
  const list = [seg(0, 1, 3), seg(1, 5, 8), seg(2, 10, 12, null), seg(3, 13, 15), seg(4, 16, 18)];
  const bufs = new Map([[1, null]]); // 1 is loading
  const failed = new Map([[3, 2000]]); // 3 failed, retry after t=2000
  assert.equal(nextToLoad(list, 4, bufs, failed, 1000)?.i, 4); // 0 ended, 1 loading, 2 unvoiced, 3 paused
  assert.equal(nextToLoad(list, 4, bufs, failed, 2500)?.i, 3); // pause over
  assert.equal(nextToLoad(list, 20, bufs, failed, 2500), null);
});


test('reusable: a session switched off is resumed for the same video and voice within its time', () => {
  const p = { url: 'https://www.youtube.com/watch?v=a', voice: 'Speaker_53', until: 2000 };
  assert.equal(reusable(p, p.url, 'Speaker_53', 1000), true);
  assert.equal(reusable(p, p.url, 'Speaker_53', 2000), false); // expired
  assert.equal(reusable(p, 'https://www.youtube.com/watch?v=b', 'Speaker_53', 1000), false);
  assert.equal(reusable(p, p.url, 'Speaker_1', 1000), false);
  assert.equal(reusable(null, p.url, 'Speaker_53', 1000), false);
});


test('voiceAhead: the server voiced_until wins when present, else the local estimate', () => {
  const list = [seg(0, 1, 3), seg(1, 5, 8), seg(2, 10, 12, null)];
  assert.equal(voiceAhead(40, list, 25, null), 15);
  assert.equal(voiceAhead(20, list, 25, null), 0); // already past it
  assert.equal(voiceAhead(null, list, 2, null), bufferedAhead(list, 2, null));
  assert.equal(voiceAhead(undefined, list, 2, null), bufferedAhead(list, 2, null)); // older server
});


test('voiceMode: a parked session is reused only for the same voice and speakers mode', () => {
  assert.notEqual(voiceMode('Speaker_53', 'each'), voiceMode('Speaker_53', ''));
  assert.notEqual(voiceMode('Speaker_53', 'each'), voiceMode('Speaker_53', 'two'));
  assert.equal(voiceMode('Speaker_53', ''), voiceMode('Speaker_53', undefined));
  const p = { url: 'u', voice: voiceMode('Speaker_53', 'each'), until: 2000 };
  assert.equal(reusable(p, 'u', voiceMode('Speaker_53', 'each'), 1000), true);
  assert.equal(reusable(p, 'u', voiceMode('Speaker_53', 'two'), 1000), false);
});


test('groupVoices: male / female / other, server order kept', () => {
  const list = [{ id: 'a', gender: 'male' }, { id: 'b', gender: 'female' }, { id: 'c', gender: null }, { id: 'd', gender: 'male' }];
  const g = groupVoices(list);
  assert.deepEqual(g.male.map((v) => v.id), ['a', 'd']);
  assert.deepEqual(g.female.map((v) => v.id), ['b']);
  assert.deepEqual(g.other.map((v) => v.id), ['c']);
});

test('voicedMark: share of phrases already voiced in this voice, empty when none', () => {
  assert.equal(voicedMark({ total: 200, voices: { a: 200, b: 37 } }, 'a'), ' ● 100%');
  assert.equal(voicedMark({ total: 200, voices: { a: 200, b: 37 } }, 'b'), ' ● 19%');
  assert.equal(voicedMark({ total: 200, voices: { a: 200 } }, 'c'), '');
  assert.equal(voicedMark(null, 'a'), '');
});

test('fmtDur: m:ss, h:mm:ss for long videos, empty for unknown', () => {
  assert.equal(fmtDur(65), '1:05');
  assert.equal(fmtDur(3725), '1:02:05');
  assert.equal(fmtDur(null), '');
});


test('windowIncomplete: phrases ahead in the window still without audio (e.g. after a voice change on a ready video)', () => {
  const list = [seg(0, 1, 3), seg(1, 5, 8, null), seg(2, 70, 72, null)];
  assert.equal(windowIncomplete(list, 4, 60), true); // phrase 1 not voiced yet
  assert.equal(windowIncomplete(list, 9, 60), false); // only phrase 2 lacks audio and it is past the window
  assert.equal(windowIncomplete([], 0, 60), false);
});

test('voiceMode: leads are part of the mode, so changing them re-posts the settings', () => {
  assert.notEqual(voiceMode('Speaker_53', 'each', 'A', ''), voiceMode('Speaker_53', 'each', 'B', ''));
  assert.equal(voiceMode('Speaker_53', '', '', ''), voiceMode('Speaker_53', ''));
});


test('originalLang: the default audio track (".4") is the original; AI dubs (".10") are not', () => {
  const formats = [{ audioTrack: { id: 'de-DE.10' } }, { audioTrack: { id: 'en-US.4', audioIsDefault: true } }, {}];
  assert.equal(originalLang(formats, []), 'en-US');
  assert.equal(originalLang([], [{ audioTrackId: 'fr-FR.10' }, { audioTrackId: 'uk.4' }]), 'uk');
  assert.equal(originalLang([], []), null);
});

test('pickCaption: manual in the original language first, then its auto track, then any manual, then the first', () => {
  const t = (languageCode: string, kind?: string) => ({ languageCode, kind });
  assert.deepEqual(pickCaption([t('en', 'asr'), t('en'), t('de')], 'en-US'), { track: t('en'), subs: 'manual' });
  assert.deepEqual(pickCaption([t('de'), t('en', 'asr')], 'en'), { track: t('en', 'asr'), subs: 'asr' });
  assert.deepEqual(pickCaption([t('fr', 'asr'), t('de')], 'en'), { track: t('de'), subs: 'manual' });
  assert.deepEqual(pickCaption([t('fr', 'asr')], null), { track: t('fr', 'asr'), subs: 'asr' });
  assert.equal(pickCaption([], 'en'), null);
});


test('voicedAfterGap: voiced run that starts at the first voiced phrase after t (a stuck unvoiced phrase is skipped)', () => {
  const list = [seg(0, 0, 8, null), seg(1, 8, 12), seg(2, 12, 30), seg(3, 31, 40, null)];
  assert.equal(voicedAfterGap(list, 1), 31 - 1); // run 8..30 is voiced up to the next unvoiced phrase (31), from t
  assert.equal(voicedAfterGap([seg(0, 0, 8, null)], 1), 0);
  assert.equal(voicedAfterGap([], 0), 0);
});

test('fadeStop: the phrase fades out over 80 ms and stops at the end of the fade', () => {
  const calls: unknown[][] = [];
  const param = {
    value: 0.7,
    cancelScheduledValues: (t: number) => calls.push(['cancel', t]),
    setValueAtTime: (v: number, t: number) => calls.push(['set', v, t]),
    linearRampToValueAtTime: (v: number, t: number) => calls.push(['ramp', v, t]),
  };
  const src = { stop: (t?: number) => calls.push(['stop', t]) };
  fadeStop({ src, g: { gain: param } }, 10);
  assert.deepEqual(calls, [['cancel', 10], ['set', 0.7, 10], ['ramp', 0, 10.08], ['stop', 10.08]]);
});

test('fadeStop: a phrase without its own gain node stops at once', () => {
  let at = null;
  fadeStop({ src: { stop: (t) => (at = t) } }, 10);
  assert.equal(at, 10);
});


test('ukrainianDub: a Ukrainian audio track that is not the original', () => {
  const f = (id: string, def?: boolean) => ({ audioTrack: { id, displayName: id, audioIsDefault: !!def } });
  // YouTube dub to uk next to an English original (formats and the captions renderer's audioTracks)
  assert.equal(ukrainianDub([f('en-US.4', true), f('uk.10'), {}], []), true);
  assert.equal(ukrainianDub([], [{ audioTrackId: 'en.4' }, { audioTrackId: 'uk-UA.3' }]), true);
  // only the original, or other languages
  assert.equal(ukrainianDub([f('en-US.4', true), f('de-DE.10')], [{ audioTrackId: 'de-DE.10' }]), false);
  assert.equal(ukrainianDub([{ itag: 140 }], undefined), false);
  assert.equal(ukrainianDub(undefined, undefined), false);
  // the original itself is Ukrainian: nothing to warn about
  assert.equal(ukrainianDub([f('uk.4', true), f('en-US.10')], []), false);
  assert.equal(ukrainianDub([], [{ audioTrackId: 'uk.4' }, { audioTrackId: 'en.10' }]), false);
});

test('holdStep: a playing video is paused with under a second voiced ahead', () => {
  const playing = { held: false, paused: false, heldMs: 0 };
  assert.equal(holdStep({ ...playing, ahead: 0.9 }, [], 0), 'pause');
  assert.equal(holdStep({ ...playing, ahead: 1 }, [], 0), null);
  assert.equal(holdStep({ ...playing, paused: true, ahead: 0 }, [], 0), null); // the viewer's own pause is left alone
});

test('holdStep: a held video goes on with ten seconds voiced ahead', () => {
  const held = { held: true, paused: true, heldMs: 1000 };
  assert.equal(holdStep({ ...held, ahead: 9.9 }, [], 0), null);
  assert.equal(holdStep({ ...held, ahead: 10 }, [], 0), 'release');
});

test('holdStep: held over 8 s, a video goes on when ten seconds are voiced past the phrase without audio', () => {
  const stuck = [seg(0, 0, 4, null), seg(1, 4, 9), seg(2, 9, 15)];
  const held = { held: true, paused: true, ahead: 0 };
  assert.equal(holdStep({ ...held, heldMs: 8000 }, stuck, 0), null);
  assert.deepEqual(holdStep({ ...held, heldMs: 8001 }, stuck, 0), { skipUntil: 15 });
  assert.equal(holdStep({ ...held, heldMs: 8001 }, stuck.slice(0, 2), 0), null); // only 9 s from here
});

test('outOfReach: phrases ended over 30 s behind the position or starting over 160 s ahead of it', () => {
  assert.equal(outOfReach(seg(0, 60, 69.9), 100), true);
  assert.equal(outOfReach(seg(0, 60, 70), 100), false);
  assert.equal(outOfReach(seg(1, 260, 265), 100), false);
  assert.equal(outOfReach(seg(1, 260.1, 265), 100), true);
});

test('quietOutage: a server away is asked again without a word while 15 s are here ahead, for three minutes', () => {
  assert.equal(quietOutage(15, 0), true);
  assert.equal(quietOutage(14.9, 0), false);
  assert.equal(quietOutage(60, 179_999), true);
  assert.equal(quietOutage(60, 180_000), false);
  assert.deepEqual([0, 1, 2, 3, 9].map((n) => quietRetry(n, 10_000)), [2000, 4000, 8000, 10_000, 10_000]);
});

test('preparedPercent: a ready video is whole; progress is a share of 1 or a percentage', () => {
  assert.equal(preparedPercent('ready', 0.3), 100);
  assert.equal(preparedPercent('translating', 0.356), 36);
  assert.equal(preparedPercent('voicing', 1), 100);
  assert.equal(preparedPercent('voicing', 35.4), 35);
  assert.equal(preparedPercent(null, null), 0); // nothing heard from the server yet
});

test('readyVoices: the voices a video is nearly all voiced in, the fullest first; none when the viewer\'s own is one', () => {
  const shares = { anna: 0.87, borys: 1, taras: 0.5, olena: 0.8 };
  assert.deepEqual(readyVoices(shares, 'taras'), [{ voice: 'borys', share: 1 }, { voice: 'anna', share: 0.87 }, { voice: 'olena', share: 0.8 }]);
  assert.deepEqual(readyVoices(shares, 'anna'), []); // the viewer's own voice is ready: nothing to offer
  assert.deepEqual(readyVoices({ taras: 0.5 }, 'anna'), []);
  assert.deepEqual(readyVoices({}, 'anna'), []);
});
