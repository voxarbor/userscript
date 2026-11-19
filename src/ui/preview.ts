// What the settings window plays on request: a voice's sample or a voiced phrase, and a speaker's own words in
// the video.
import type { UiHost } from './host';

export class Previews {
  private clip: AudioBufferSourceNode | null = null; // the sample or voiced phrase currently playing
  private turn = 0; // grows with every asking and stopping: a sample fetched for an earlier one is not started
  private original: { video: HTMLVideoElement; stopAt: () => void } | null = null;

  /** host.audio(): the audio context the samples play through. Not the voice-over's: resuming that one let a
   *  phrase frozen by a pause sound on over the sample. It runs only while a sample sounds. */
  constructor(private readonly host: Pick<UiHost, 'api' | 'site' | 'audio' | 'onOriginal'>) {}

  /** Plays a voice sample or a voiced phrase through Web Audio (fetched with the token like all audio), in place
   *  of the one that sounds. */
  async playClip(path: string): Promise<void> {
    this.stopClip();
    const turn = this.turn;
    const ctx = this.host.audio();
    await ctx.resume(); // at once, while the press still counts as the person's
    const buf = await ctx.decodeAudioData(await this.host.api.bytes(path));
    if (turn !== this.turn) return; // stopped, or another sample asked for, while this one was on its way
    const clip = (this.clip = ctx.createBufferSource());
    clip.buffer = buf;
    clip.connect(ctx.destination);
    clip.onended = () => {
      if (this.clip === clip) this.stopClip();
    };
    clip.start();
  }

  /** What sounds stops, and what is on its way will not start. */
  stopClip(): void {
    this.turn++;
    if (!this.clip) return;
    try {
      this.clip.stop();
    } catch {}
    this.clip = null;
    void this.host.audio().suspend(); // no audio thread kept running between samples
  }

  /** Seeks the video to a speaker's sample and pauses at its end; one sample at a time. The voice-over is told
   *  to stay out meanwhile (host.onOriginal): the sample is the original, at its own volume and not voiced over. */
  playOriginal(o: { start: number; end: number } | null): void {
    const v = this.host.site.getVideo();
    if (!v || !o) return;
    this.stopOriginal();
    const stopAt = (): void => {
      const over = v.currentTime >= o.end;
      if (over && v.currentTime < o.end + 1) v.pause(); // played to its end; further on, the viewer has seeked away
      if (over || v.currentTime < o.start - 1) this.stopOriginal();
    };
    this.original = { video: v, stopAt };
    this.host.onOriginal(true);
    v.currentTime = o.start;
    v.addEventListener('timeupdate', stopAt);
    v.play().catch(() => {});
  }

  stopOriginal(): void {
    if (!this.original) return;
    this.original.video.removeEventListener('timeupdate', this.original.stopAt);
    this.original = null;
    this.host.onOriginal(false);
  }
}
