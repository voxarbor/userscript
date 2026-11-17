// What sounds: the phrases started at their times, the original's volume under them, and the video held back
// while too little is voiced.
import type { Segment } from '../api/client';
import { due, fadeStop, foreignVolume, holdStep, isDucked, mustWait, nextStart, ramp, roomOf, shouldDuck, voiceAhead } from './scheduler';
import type { Run, SessionHost } from './session';

const DUCK_TIME = 0.25;

export class Playback {
  constructor(private readonly host: Pick<SessionHost, 'settings' | 'site' | 'setState'>) {}

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
      for (const seg of due(s.list, t, !v.paused, s.done)) {
        const buf = s.bufs.get(seg.i);
        if (!buf) continue; // not ready in time: skipped once its window passes
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

  private play(s: Run, seg: Segment, buf: AudioBuffer, t: number): void {
    const prev = s.sources[s.sources.length - 1];
    const at = nextStart(prev ? prev.end : null, seg, roomOf(seg, buf.duration, s.list));
    const rate = s.video.playbackRate;
    const when = s.ctx.currentTime + Math.max(0, at - t) / rate;
    if (prev && prev.end > at) this.fadeSources(s, when, at); // seg cannot wait that long: faded out, not cut mid-word
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
    } else if (step === 'release') this.release(s);
  }
}
