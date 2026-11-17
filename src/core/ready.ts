// A video that is ready in other voices: what to offer the viewer before it is voiced anew in their own.
import type { ServerApi } from '../api/client';
import type { Settings } from '../settings/store';
import { readyVoices } from './scheduler';

/** A voice the video is ready in: its name, the share of the video voiced in it and the path of its sample. */
export interface ReadyVoice {
  voice: string;
  label: string;
  share: number;
  sample: string;
}

/** What to ask the viewer: the voices the video is ready in, and the name of the viewer's own voice. */
export interface ReadyOffer {
  ready: ReadyVoice[];
  own: string;
}

const NOTHING: ReadyOffer = { ready: [], own: '' };

/** The offer for the video at url. Nothing to ask when the viewer answered for this video before (kept: the voice
 *  taken then, '' for their own), when they want the speakers told apart (a ready voice is one voice for all),
 *  when their own voice is ready too, or when the server cannot be asked: the voice-over never waits for this. */
export async function readyOffer(
  api: Pick<ServerApi, 'voiced' | 'voices'>,
  url: string,
  S: Pick<Settings, 'voice' | 'mode'>,
  kept: string | undefined,
): Promise<ReadyOffer> {
  if (kept !== undefined || S.mode === 'two' || S.mode === 'each') return NOTHING;
  try {
    const ready = readyVoices((await api.voiced(url)).voices, S.voice);
    if (!ready.length) return NOTHING;
    const voices = new Map((await api.voices()).map((v) => [v.id, v]));
    const named = ready.flatMap(({ voice, share }) => {
      const v = voices.get(voice);
      return v ? [{ voice, share, label: v.label, sample: v.sample }] : []; // a voice the server no longer has
    });
    return { ready: named, own: voices.get(S.voice)?.label ?? S.voice };
  } catch {
    return NOTHING;
  }
}
