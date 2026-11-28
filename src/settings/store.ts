// VoxArbor UA settings: defaults, the pure rules of loading them, and the store that keeps them in the script
// manager (no DOM).
import type { Platform } from '../platform/gm';

const LEGACY = 'settings';
const PREFERENCES = 'preferences';
const CONNECTION = 'connection';
const CONNECTION_REFUSED = 'connectionRefused';
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
  origVolume: 0.1, // -20 dB
  voiceVolume: 1,
  waitForVoice: true, // owner: pause rather than play the original unvoiced
  duckAlways: true,
  mode: '',
  leadMale: '',
  leadFemale: '',
  debug: false,
};

/** Saved settings over defaults. */
export function loadSettings(saved?: Partial<Settings> | null): Settings {
  return Object.assign({}, DEFAULTS, saved);
}

/** Preferences and the connection are written separately because GM.* tabs can hold stale copies. */
export class SettingsStore {
  current: Settings;
  /** The settings as this tab last read or wrote them: what differs from it in `current` was changed here. */
  private base: Settings;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly platform: Pick<Platform, 'getValue' | 'setValue'>) {
    this.current = { ...this.preferences(), ...this.connection() };
    this.base = { ...this.current };
  }

  private preferences(): Omit<Settings, 'token' | 'account'> {
    const legacy = this.platform.getValue<Partial<Settings>>(LEGACY, {});
    const { token, account, ...preferences } = loadSettings(this.platform.getValue(PREFERENCES, legacy));
    return preferences;
  }

  private connection(): Pick<Settings, 'token' | 'account'> {
    const legacy = this.platform.getValue<Partial<Settings>>(LEGACY, {});
    const { token = '', account = '' } = this.platform.getValue(CONNECTION, legacy) ?? {};
    if (token && token === this.platform.getValue(CONNECTION_REFUSED, '')) return { token: '', account: '' };
    return { token, account };
  }

  /** Takes what other tabs have written since: a setting not changed here gets the kept value, one changed here
   *  stays. -> the names of the settings that are new here */
  refresh(): (keyof Settings)[] {
    return this.merge({ ...this.preferences(), ...this.connection() });
  }

  private merge<K extends keyof Settings>(kept: Pick<Settings, K>): K[] {
    const fresh: K[] = [];
    for (const key of Object.keys(kept) as K[]) {
      if (this.current[key] !== this.base[key]) continue;
      if (kept[key] !== this.current[key]) {
        this.current[key] = kept[key];
        fresh.push(key);
      }
      this.base[key] = kept[key];
    }
    return fresh;
  }

  /** Writes the settings now (a write that was waiting goes with it): what this tab changed, over what the
   *  others wrote. */
  save(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.merge(this.preferences());
    const { token, account, ...preferences } = this.current;
    this.platform.setValue(PREFERENCES, preferences);
    Object.assign(this.base, preferences);
  }

  saveConnection(): void {
    const { token, account } = this.current;
    this.platform.setValue(CONNECTION, { token, account });
    Object.assign(this.base, { token, account });
  }

  refuseConnection(token: string): void {
    if (!token || token !== this.current.token) return;
    // Record the rejected token separately: another tab may already be writing a new connection.
    this.platform.setValue(CONNECTION_REFUSED, token);
    Object.assign(this.current, { token: '', account: '' });
    Object.assign(this.base, { token: '', account: '' });
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
