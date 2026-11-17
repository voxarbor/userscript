// The userscript's UI as the core uses it: the two buttons in the player, the quick settings over the player and
// the settings window.
import type { Voice } from '../api/client';
import type { SessionState } from '../core/types';
import { mainButton, showState, tuneButton } from './buttons';
import { videoControls } from './controls';
import type { UiHost } from './host';
import { QuickPanel } from './quick';
import { SettingsWindow } from './settings';

export class Ui {
  private made: { main: HTMLButtonElement; tune: HTMLButtonElement } | null = null;
  private readonly quick: QuickPanel;
  private readonly settings: SettingsWindow;
  private voicesReq: Promise<Voice[]> | null = null; // all voices change rarely: one request per page, retried after a failure

  constructor(private readonly host: UiHost) {
    const voices = (): Promise<Voice[]> => this.voices();
    const controls = (): HTMLElement[] => videoControls(host, voices, () => {
      this.quick.close();
      this.settings.open('voices');
    });
    this.quick = new QuickPanel(host.site, controls, () => this.buttons()[1]);
    this.settings = new SettingsWindow(host, voices, controls);
  }

  /** The buttons for the player, made when first asked for: the voice-over switch (idle), then «tune». */
  buttons(): [HTMLButtonElement, HTMLButtonElement] {
    if (!this.made) {
      this.made = {
        main: mainButton(() => this.host.onToggle(), () => this.openSettings()),
        tune: tuneButton(() => this.quick.toggle()),
      };
      this.setState('idle');
    }
    return [this.made.main, this.made.tune];
  }

  /** Takes the buttons out of the page. -> there were buttons to take out */
  removeButtons(): boolean {
    if (!this.made) return false;
    this.made.main.remove();
    this.made.tune.remove();
    return true;
  }

  /** What the voice-over does now, on the switch: its colour, and text as its tooltip. */
  setState(state: SessionState, text?: string): void {
    if (this.made) showState(this.made.main, state, text);
  }

  openSettings(): void {
    this.settings.open('main');
  }

  closeSettings(): void {
    this.settings.close();
  }

  closeQuick(): void {
    this.quick.close();
  }

  /** Every voice of the server, asked for once per page. */
  voices(): Promise<Voice[]> {
    return this.voicesReq || (this.voicesReq = this.host.api.voices().catch((e) => {
      this.voicesReq = null;
      throw e;
    }));
  }
}
