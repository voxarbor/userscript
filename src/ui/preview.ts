// What the settings window plays on request: a voice's sample or a voiced phrase, and a speaker's own words in
// the video.
import type { UiHost } from './host';

export class Previews {
  private clip: AudioBufferSourceNode | null = null; // the sample or voiced phrase currently playing
  private original: { video: HTMLVideoElement; stopAt: () => void } | null = null;

  constructor(private readonly host: Pick<UiHost, 'api' | 'site' | 'audio'>) {}

  /** Plays a voice sample or a voiced phrase through Web Audio (fetched with the token like all audio). */
  async playClip(path: string): Promise<void> {
    const ctx = this.host.audio();
    await ctx.resume();
    const buf = await ctx.decodeAudioData(await this.host.api.bytes(path));
    this.stopClip();
    this.clip = ctx.createBufferSource();
    this.clip.buffer = buf;
    this.clip.connect(ctx.destination);
    this.clip.start();
  }

  stopClip(): void {
    if (!this.clip) return;
    try {
      this.clip.stop();
    } catch {}
    this.clip = null;
  }

  /** Seeks the video to a speaker's sample and pauses at its end; one sample at a time. */
  playOriginal(o: { start: number; end: number } | null): void {
    const v = this.host.site.getVideo();
    if (!v || !o) return;
    this.stopOriginal();
    const stopAt = (): void => {
      if (v.currentTime >= o.end) v.pause();
      if (v.currentTime >= o.end || v.currentTime < o.start - 1) this.stopOriginal();
    };
    this.original = { video: v, stopAt };
    v.currentTime = o.start;
    v.addEventListener('timeupdate', stopAt);
    v.play().catch(() => {});
  }

  stopOriginal(): void {
    if (this.original) this.original.video.removeEventListener('timeupdate', this.original.stopAt);
    this.original = null;
  }
}
