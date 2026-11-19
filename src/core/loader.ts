// The phrases' audio: downloaded and decoded ahead of the playback.
import type { Segment, ServerApi } from '../api/client';
import { nextToLoad } from './scheduler';
import type { Run } from './session';

const LOAD_MAX = 3; // parallel phrase downloads: a 60 s window used to fire them all at once
const LOAD_RETRY_MS = 5000;

export class Loader {
  /** loaded(run): a phrase's audio has come, or failed to (the playback may be waiting for it); note: the journal. */
  constructor(
    private readonly api: Pick<ServerApi, 'bytes'>,
    private readonly loaded: (s: Run) => void = () => {},
    private readonly note: (what: string) => void = () => {},
  ) {}

  /** Download voiced phrases nearest-first, a few at a time; a failed one is retried after a pause. */
  pump(s: Run): void {
    while (s.loading < LOAD_MAX) {
      const seg = nextToLoad(s.list, s.video.currentTime, s.bufs, s.failed, Date.now());
      if (!seg) return;
      this.load(s, seg);
    }
  }

  private load(s: Run, seg: Segment & { audio: string }): void {
    const bufs = s.bufs; // replaced on a voice switch, so late loads of the old voice are dropped
    bufs.set(seg.i, null); // loading
    s.loading++;
    const began = Date.now();
    const name = `phrase ${seg.i} [${seg.start.toFixed(2)}–${seg.end.toFixed(2)}]`;
    this.api.bytes(seg.audio)
      .then((ab) => s.ctx.decodeAudioData(ab))
      .then((buf) => {
        if (bufs.has(seg.i)) bufs.set(seg.i, buf);
        this.note(`${name}: ${buf.duration.toFixed(2)} s of audio here ${Date.now() - began} ms after it was asked for`);
      })
      .catch((e: unknown) => {
        bufs.delete(seg.i);
        s.failed.set(seg.i, Date.now() + LOAD_RETRY_MS);
        this.note(`${name}: its audio failed (${(e as Error).message}), again in ${LOAD_RETRY_MS / 1000} s`);
      })
      .finally(() => {
        s.loading--;
        if (s.stopped) return;
        this.pump(s);
        this.loaded(s);
      });
  }
}
