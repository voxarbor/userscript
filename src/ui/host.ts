// What the UI needs of the rest of the script. The core implements it and hands it to the UI, so no UI module
// reaches into the session.
import type { SiteAdapter } from '../adapters/types';
import type { ServerApi } from '../api/client';
import type { SettingsStore } from '../settings/store';

export interface UiHost {
  /** The user's settings. The controls change `current` in place (the session reads the same object every
   *  frame) and then save it. */
  readonly store: Readonly<Pick<SettingsStore, 'current' | 'save' | 'saveSoon'>>;
  readonly api: Pick<ServerApi, 'voices' | 'videoVoices' | 'speakers' | 'speakerVoice' | 'bytes' | 'deviceCode' | 'deviceToken'>;
  readonly site: Pick<SiteAdapter, 'getVideo' | 'getPlayer' | 'panelAtTop'>;
  /** The server's key of the video being voiced; null while the voice-over is off or the server has not
   *  opened the video yet. */
  videoKey(): string | null;
  /** The page's one audio context, made when first asked for: samples play through it. */
  audio(): AudioContext;
  /** The main button was pressed: the voice-over goes on or off. */
  onToggle(): void;
  /** The voice-over's volume was changed. */
  onVoiceVolume(): void;
  /** Who voices the video was changed: the voice, the speakers' mode, a lead voice or one speaker's voice. */
  onVoicesChanged(): void;
  /** A speaker's own words are played from the video (on), or no longer: the voice-over stays out of them. */
  onOriginal(on: boolean): void;
  /** The script was connected or disconnected (another token, or none). */
  onConnectionChanged(): void;
  /** The diagnostic journal as text, for «Копіювати журнал». */
  journal(): string;
  /** Puts the text on the clipboard; it fails when the browser does not let it. */
  copy(text: string): Promise<void>;
  /** Opens a page of the site in a new tab («Увійти»). */
  openTab(url: string): void;
}
