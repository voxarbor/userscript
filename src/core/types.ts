// What the core knows of a video's phrase (a row of GET /v1/videos/{key}/segments). Times are media seconds.
export interface Phrase {
  i: number;
  start: number;
  end: number;
  /** The address of its audio; null while it is not voiced. */
  audio: string | null;
}

/** What the voice-over does now, as the switch shows it: off, getting ready (or waiting), sounding, without its
 *  server, given up. */
export type SessionState = 'idle' | 'busy' | 'on' | 'offline' | 'error';
