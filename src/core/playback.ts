// What sounds: the phrases started at their times, the original's volume under them, and the video held back
// while too little is voiced.
import type { Segment } from '../api/client';
import { due, fadeStop, foreignVolume, holdStep, isDucked, mustWait, nextStart, ramp, roomOf, shouldDuck, voiceAhead } from './scheduler';
import type { Run, SessionHost } from './session';

const DUCK_TIME = 0.25;
const PREP_MS = 1500; // the longest a ready video is held back at the switching on for its first audio (owner)
const PREP_NEAR = 1.5; // s: a first phrase further ahead than this is not waited for, its audio comes in time

export class Playback {
  constructor(private readonly host: Pick<SessionHost, 'settings' | 'site' | 'setState' | 'note'>) {}

  /** A volume we didn't set (see foreignVolume). tick() checks too: a frame can run before the volumechange
   *  event, and its ramp would start from the foreign value and hide it (the ~1/min blips seen in 0.2.11). */
  adoptVolume(s: Run): void {
    const v = s.video;
    if (Math.abs(v.volume - s.setVol) <= 0.01) return; // our own change
    const r = foreignVolume(v.volume, s.ducked, this.host.settings.origVolume);
    s.base = r.base;
    s.setVol = r.set;
    if (r.set !== v.volume) v.volume = r.set; // its volumechange equals setVol, so it is ignored
  }

  /** Frame loop only while playing (exact phrase starts and smooth ramps); while paused the poller ticks instead. */
  loop(s: Run): void {
    if (s.raf || s.stopped || s.video.paused) return;
    const frame = (): void => {
      s.raf = 0;
      if (s.stopped || s.video.paused) return;
      this.tick(s);
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
  }

  tick(s: Run): void {
    if (s.stopped) return;
    this.prepStep(s);
    const S = this.host.settings;
    const site = this.host.site;
    const v = s.video;
    this.adoptVolume(s);
    const t = v.currentTime;
    const now = performance.now();
    const dt = Math.min(DUCK_TIME, (now - s.lastTick) / 1000);
    s.lastTick = now;
    const ad = site.inAd ? site.inAd(v) : false;
    if (ad && s.sources.length) this.stopSources(s);
    if (!v.seeking && !ad) {
      for (const seg of due(s.list, t, !v.paused, s.done, (x) => s.bufs.get(x.i)?.duration)) {
        const buf = s.bufs.get(seg.i);
        if (!buf) continue; // not here yet: joined in its middle if it comes while enough of it is left
        s.done.add(seg.i);
        this.play(s, seg, buf, t);
      }
    }
    const always = S.duckAlways && !s.offline; // then the per-frame phrase scan is not needed
    const speaking = s.ducked = !ad && isDucked({ always: S.duckAlways, offline: s.offline,
      near: !always && shouldDuck(s.list.filter((x) => s.bufs.get(x.i)), s.sources, t) });
    const target = speaking ? s.base * S.origVolume : s.base;
    if (Math.abs(v.volume - target) > 0.001) {
      const speed = Math.max(s.base * (1 - S.origVolume), 0.05) / DUCK_TIME;
      v.volume = s.setVol = ramp(v.volume, target, speed, dt);
    }
    if (!ad) this.hold(s, t);
  }

  /** What sounds stops at once (seek, off, ad). */
  stopSources(s: Run): void {
    for (const x of s.sources) {
      try {
        x.src.stop();
      } catch {}
    }
    s.sources = [];
  }

  /** What sounds fades out at the audio time `when`, the video's time `at`: a phrase cut short by the next one.
   *  It stays among the sources until it ends, so a seek before that still stops it. */
  private fadeSources(s: Run, when: number, at: number): void {
    for (const x of s.sources) {
      try {
        fadeStop(x, when);
        x.end = Math.min(x.end, at);
      } catch {}
    }
  }

  /** The video goes on, if it was us who paused it. */
  release(s: Run): void {
    s.startHold = false;
    if (!s.held) return;
    s.held = false;
    s.video.play().catch(() => {});
  }

  /** A ready video as its phrases first come (owner): held back, for PREP_MS at most, while the audio of the phrase
   *  at its place is on its way, so the voice-over starts with the picture and not seconds into it. Once a run, and
   *  a state of its own: hold() never keeps a ready video. A video that was paused when switched on stays so until
   *  then. Nothing to wait for (no phrase near, its audio here already, an ad): nothing happens. */
  prepare(s: Run): void {
    if (s.prepped) return;
    s.prepped = true;
    const v = s.video;
    const t = v.currentTime;
    const first = s.list.find((x) => !!x.audio && x.end > t);
    if (s.status !== 'ready' || !first || first.start - t > PREP_NEAR || s.bufs.get(first.i)) return;
    if (this.host.site.inAd && this.host.site.inAd(v)) return;
    s.prep = { i: first.i, since: Date.now() };
    if (!v.paused) {
      s.held = true;
      s.heldAt = Date.now();
      v.pause();
    }
    s.prepTimer = setTimeout(() => this.tick(s), PREP_MS); // it goes on then whatever has come
    this.host.setState('busy', 'Готуємо озвучку…');
    this.host.note(`prep: the video waits for the audio of phrase ${first.i} (it starts at ${first.start.toFixed(2)}, the video is at ${t.toFixed(2)})`);
  }

  /** The end of prepare()'s wait: the audio is here, cannot be had, or the time is up. */
  private prepStep(s: Run): void {
    const p = s.prep;
    if (!p) return;
    const waited = Date.now() - p.since;
    const why = s.bufs.get(p.i) ? 'its audio is here'
      : !s.bufs.has(p.i) ? 'its audio is not coming'
        : waited >= PREP_MS ? 'the time is up'
          : s.offline || s.status !== 'ready' ? 'the video is not ready any more' : null;
    if (!why) return;
    clearTimeout(s.prepTimer);
    s.prep = null;
    this.host.note(`prep: the video goes on after ${waited} ms: ${why}`);
    if (s.status === 'ready' && !s.offline) this.host.setState('on', '100%');
    this.release(s);
  }

  private play(s: Run, seg: Segment, buf: AudioBuffer, t: number): void {
    const prev = s.sources[s.sources.length - 1];
    const at = nextStart(prev ? prev.end : null, seg, roomOf(seg, buf.duration, s.list));
    const rate = s.video.playbackRate;
    const when = s.ctx.currentTime + Math.max(0, at - t) / rate;
    if (prev && prev.end > at) this.fadeSources(s, when, at); // seg cannot wait that long: faded out, not cut mid-word
    this.host.note(`phrase ${seg.i} [${seg.start.toFixed(2)}–${seg.end.toFixed(2)}] sounds` +
      (t > at ? ` from ${(t - at).toFixed(2)} s into its ${buf.duration.toFixed(2)} s` : ` in ${(at - t).toFixed(2)} s`) + `, the video is at ${t.toFixed(2)}`);
    const src = s.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = s.ctx.createGain(); // the phrase's own gain, for its fade-out; the voice volume stays on the shared one
    src.connect(g);
    g.connect(s.gain);
    src.start(when, Math.max(0, t - at));
    const item = { src, g, start: at, end: at + buf.duration };
    s.sources.push(item);
    src.onended = () => {
      const k = s.sources.indexOf(item);
      if (k >= 0) s.sources.splice(k, 1);
    };
  }

  /** waitForVoice (or a UK click on a paused video): keep the video paused until ~10 s of voiced audio is ready. */
  private hold(s: Run, t: number): void {
    if (s.prep) return; // prepare() keeps the video for now
    const waiting = mustWait({ status: s.status, offline: s.offline, startHold: s.startHold,
      waitForVoice: this.host.settings.waitForVoice, known: !!s.key && s.windowEnd != null });
    if (!waiting) return this.release(s);
    const ahead = voiceAhead(s.voicedUntil, s.list, t, s.status === 'voicing' ? s.windowEnd : null);
    const step = holdStep({ held: s.held, paused: s.video.paused, ahead, heldMs: Date.now() - s.heldAt }, s.list, t);
    if (step === 'pause') {
      s.held = true;
      s.heldAt = Date.now();
      s.video.pause();
      this.host.setState('busy', 'Чекаю озвучку…');
      this.host.note(`hold: the video waits for the voice-over at ${t.toFixed(2)}, ${ahead.toFixed(1)} s are voiced ahead`);
    } else if (step === 'release') {
      this.host.note(`hold: the video goes on after ${Date.now() - s.heldAt} ms, ${ahead.toFixed(1)} s are voiced ahead`);
      this.release(s);
    }
  }
}
