// VoxArbor UA settings: defaults, the pure rules of loading them, and the store that keeps them in the script
// manager (no DOM).
import type { Platform } from '../platform/gm';

const KEY = 'settings';
/** The server the script was served from: it puts its public address here when it serves the script. */
export const SERVER = '__VOXARBOR_SERVER__';
const SETTLE_MS = 400; // sliders fire many input events per drag: one write once they settle

export interface Settings {
  /** The script's own token, given when it was connected («Підключити»); '' = not connected. */
  token: string;
  /** Whose account and which device the token is, as shown: «ann · Firefox · Windows». */
  account: string;
  voice: string;
  /** How loud the original stays under the voice-over (1 = untouched). */
  origVolume: number;
  voiceVolume: number;
  /** Pause rather than play the original unvoiced. */
  waitForVoice: boolean;
  /** Keep the original quiet for the whole session, not only around phrases. */
  duckAlways: boolean;
  /** How a video's speakers are voiced: one voice, two (the men's and the women's), each speaker's own;
   *  '' = as the server has it for the video (a new video: the server's default). */
  mode: '' | 'one' | 'two' | 'each';
  /** Lead voice per gender when the speakers are told apart; '' = by the server's rule. */
  leadMale: string;
  leadFemale: string;
  /** The diagnostic journal is also written to the browser's console as it grows. */
  debug: boolean;
}

export const DEFAULTS: Settings = {
  token: '',
  account: '',
  voice: 'Speaker_53', // holos "history"
  origVolume: 0.1, // -20 dB; 0.2 and then 0.12 were too loud for the owner
  voiceVolume: 1,
  waitForVoice: true, // owner: pause rather than play the original unvoiced
  duckAlways: true,
  mode: '',
  leadMale: '',
  leadFemale: '',
  debug: false,
};

/** Saved settings over defaults. 'male' was the 0.1.x default, so it is migrated to the new one. */
export function loadSettings(saved?: Partial<Settings> | null): Settings {
  const s: Settings = Object.assign({}, DEFAULTS, saved);
  if (s.voice === 'male') s.voice = DEFAULTS.voice;
  if (s.origVolume === 0.2 || s.origVolume === 0.12) s.origVolume = DEFAULTS.origVolume; // older defaults
  return s;
}

/** The user's settings as the script manager keeps them. `current` is changed in place, then saved. Every tab of
 *  the browser has a store of its own over the same kept value: a save writes only what this tab changed over what
 *  the others wrote meanwhile (an older tab's slider used to write its whole copy and with it the token of before
 *  over a connection made in another tab), and refresh() takes the others' changes without writing. */
export class SettingsStore {
  current: Settings;
  /** The settings as this tab last read or wrote them: what differs from it in `current` was changed here. */
  private base: Settings;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly platform: Pick<Platform, 'getValue' | 'setValue'>) {
    this.current = loadSettings(platform.getValue<Partial<Settings>>(KEY, {}));
    this.base = { ...this.current };
  }

  /** Takes what other tabs have written since: a setting not changed here gets the kept value, one changed here
   *  stays. -> the names of the settings that are new here */
  refresh(): (keyof Settings)[] {
    const kept = loadSettings(this.platform.getValue<Partial<Settings>>(KEY, {}));
    const fresh: (keyof Settings)[] = [];
    const set = <K extends keyof Settings>(key: K): void => {
      const mine = this.current[key] !== this.base[key];
      if (!mine && kept[key] !== this.current[key]) {
        this.current[key] = kept[key];
        fresh.push(key);
      }
      if (!mine) this.base[key] = kept[key];
    };
    (Object.keys(kept) as (keyof Settings)[]).forEach(set);
    return fresh;
  }

  /** Writes the settings now (a write that was waiting goes with it): what this tab changed, over what the
   *  others wrote. */
  save(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.refresh();
    this.platform.setValue(KEY, this.current);
    this.base = { ...this.current };
  }

  /** Writes once the changes settle: a slider being dragged does not write at every step. */
  saveSoon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), SETTLE_MS);
  }

  /** Writes what is still waiting; called when the page goes away. */
  flush(): void {
    if (this.timer !== undefined) this.save();
  }
}
