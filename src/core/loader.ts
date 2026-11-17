// The phrases' audio: downloaded and decoded ahead of the playback.
import type { Segment, ServerApi } from '../api/client';
import { nextToLoad } from './scheduler';
import type { Run } from './session';

const LOAD_MAX = 3; // parallel phrase downloads: a 60 s window used to fire them all at once
const LOAD_RETRY_MS = 5000;

export class Loader {
  constructor(private readonly api: Pick<ServerApi, 'bytes'>) {}

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
    this.api.bytes(seg.audio)
      .then((ab) => s.ctx.decodeAudioData(ab))
      .then((buf) => bufs.has(seg.i) && bufs.set(seg.i, buf))
      .catch(() => {
        bufs.delete(seg.i);
        s.failed.set(seg.i, Date.now() + LOAD_RETRY_MS);
      })
      .finally(() => {
        s.loading--;
        if (!s.stopped) this.pump(s);
      });
  }
}
