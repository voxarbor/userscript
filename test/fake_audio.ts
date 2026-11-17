// Web Audio as far as the voice-over uses it (the tests run in Node): the nodes remember what they were connected
// to and what they were told; nothing sounds and the clock stands still unless a test moves it. A clip's bytes
// stand for its length: a thousand bytes decode into a second of sound.

/** An audio parameter: its value, and the changes scheduled on it. */
class FakeParam {
  readonly scheduled: string[] = [];

  constructor(public value: number) {}

  cancelScheduledValues(at: number): void {
    this.scheduled.push(`cancel at ${at}`);
  }

  setValueAtTime(value: number, at: number): void {
    this.scheduled.push(`${value} at ${at}`);
  }

  linearRampToValueAtTime(value: number, at: number): void {
    this.scheduled.push(`ramp to ${value} at ${at}`);
  }
}

class FakeNode {
  /** The node this one plays into. */
  to: FakeNode | null = null;

  connect(to: FakeNode): void {
    this.to = to;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  readonly playbackRate = { value: 1 };
  /** Set by the code that plays the source; a test calls it when the clip has played to its end. */
  onended: (() => void) | null = null;
  /** when: the audio time the clip starts at; offset: how far into the clip. */
  started: { when: number; offset: number } | null = null;
  /** The audio time the clip was cut at; 'now': at once. */
  stopped: number | 'now' | null = null;

  start(when: number, offset: number): void {
    this.started = { when, offset };
  }

  stop(at?: number): void {
    this.stopped = at ?? 'now';
  }

  /** The gain nodes the clip goes through on its way to the context's destination. */
  get gains(): FakeGain[] {
    const path: FakeGain[] = [];
    for (let node = this.to; node; node = node.to) if (node instanceof FakeGain) path.push(node);
    return path;
  }
}

class FakeAudioContext {
  currentTime = 0;
  state: 'running' | 'suspended' = 'running';
  readonly destination = new FakeNode();
  /** Every source made, in the order of making. */
  readonly sources: FakeSource[] = [];

  createGain(): FakeGain {
    return new FakeGain();
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  async decodeAudioData(bytes: ArrayBuffer): Promise<{ duration: number }> {
    return { duration: bytes.byteLength / 1000 };
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
}

/** Puts the fake `AudioContext` where the code looks for it. -> the contexts made since, in the order of making */
export function installAudio(): FakeAudioContext[] {
  const made: FakeAudioContext[] = [];
  class AudioContext extends FakeAudioContext {
    constructor() {
      super();
      made.push(this);
    }
  }
  Object.assign(globalThis, { AudioContext });
  return made;
}
