// The userscript's UI as the core uses it: the two buttons in the player, the quick settings over the player and
// the settings window.
import type { Voice } from '../api/client';
import type { SessionState } from '../core/types';
import { mainButton, showState, tuneButton } from './buttons';
import { videoControls } from './controls';
import type { UiHost } from './host';
import { Previews } from './preview';
import { QuickPanel } from './quick';
import { SettingsWindow } from './settings';

export class Ui {
  private made: { main: HTMLButtonElement; tune: HTMLButtonElement } | null = null;
  private readonly quick: QuickPanel;
  private readonly settings: SettingsWindow;
  /** Samples and a speaker's own words: one player for the whole page (a new ▶ stops the one before). */
  readonly previews: Previews;
  // All voices change rarely: one request per connection (they are the server's answer to that token: another
  // account may have other voices), retried after a failure.
  private voicesReq: { token: string; list: Promise<Voice[]> } | null = null;

  constructor(private readonly host: UiHost) {
    const voices = (): Promise<Voice[]> => this.voices();
    const controls = (): HTMLElement[] => videoControls(host, voices, () => {
      this.quick.close();
      this.settings.open('voices');
    });
    this.quick = new QuickPanel(host.site, controls, () => this.buttons()[1]);
    this.previews = new Previews(host);
    this.settings = new SettingsWindow(host, voices, controls, this.previews);
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

  /** Every voice of the server, asked for once for the connection the script has now. */
  voices(): Promise<Voice[]> {
    const { token } = this.host.store.current;
    if (this.voicesReq && this.voicesReq.token === token) return this.voicesReq.list;
    const asked = { token, list: this.host.api.voices() };
    asked.list.catch(() => {
      if (this.voicesReq === asked) this.voicesReq = null;
    });
    this.voicesReq = asked;
    return asked.list;
  }
}
