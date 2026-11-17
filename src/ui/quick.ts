// Quick settings over the player. Built without innerHTML (Trusted Types).
import type { SiteAdapter } from '../adapters/types';
import { el } from './dom';
import { PANEL_CSS } from './styles';

export class QuickPanel {
  private panel: HTMLElement | null = null;

  /** controls(): the panel's content, built at every opening. opener(): the button that opens the panel, so a
   *  press on it does not count as a press outside. */
  constructor(
    private readonly site: Pick<SiteAdapter, 'getPlayer'>,
    private readonly controls: () => HTMLElement[],
    private readonly opener: () => HTMLElement,
  ) {}

  toggle(): void {
    this.panel ? this.close() : this.open();
  }

  close(): void {
    if (this.panel) this.panel.remove();
    this.panel = null;
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.esc, true);
  }

  private open(): void {
    const panel = (this.panel = el('div', {}, ...this.controls()));
    let player = this.site.getPlayer && this.site.getPlayer();
    // a phone's portrait player is too low: a sheet at the bottom instead, 12 px from both edges of what is seen
    // (not a width in vw: that counts a scrollbar in)
    if (player && player.clientHeight < 320) player = null;
    panel.style.cssText = (player ? 'position:absolute;bottom:64px;right:12px;width:min(340px,calc(100% - 24px));max-height:calc(100% - 76px);'
      : 'position:fixed;bottom:12px;left:12px;right:12px;max-width:420px;margin-left:auto;max-height:70vh;') +
      PANEL_CSS + ';padding:12px 14px;overflow:auto';
    // Keep keys (space, arrows) and clicks inside the panel away from the player.
    for (const ev of ['keydown', 'keyup', 'keypress', 'click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown',
      'pointerup', 'touchstart', 'touchend', 'wheel']) panel.addEventListener(ev, (e) => e.stopPropagation());
    (player || document.body).append(panel);
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.esc, true);
  }

  private readonly outside = (e: Event): void => {
    const target = e.target as Node;
    if (this.panel && !this.panel.contains(target) && !this.opener().contains(target)) this.close();
  };

  private readonly esc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
    }
  };
}
