// Where the script's buttons live on YouTube: the desktop player's bar, YouTube's own row of controls over the
// player's top (a phone's video, a short on a computer), or a capsule over the player (other layouts).

type Mode = 'bar' | 'top' | 'overlay' | 'float';

const isShorts = (): boolean => location.pathname.startsWith('/shorts/');
/** A short on m.youtube.com: its see-through top bar and its overlay of gestures and buttons lie over the whole
 *  player, which is a stacking context of its own, so nothing in the player takes a touch (seen 2026-11-21). */
const phoneShort = (): boolean => isShorts() && /^m\./.test(location.hostname || '');

/** YouTube's own row of controls over the player's top right corner, when the page has one: m.youtube.com's on a
 *  video (it appears once the player has started), the right half of a short's on a computer. */
function topRow(): HTMLElement | null {
  return document.querySelector<HTMLElement>(isShorts() ? 'ytd-shorts-player-controls #right-controls'
    : '#player-control-container .player-controls-top');
}

/** A button keeps only its state colour (set by the core); the rest of its look is the place's. */
function restyle(button: HTMLElement, className: string, style: Partial<CSSStyleDeclaration>): void {
  const color = button.style.color;
  button.removeAttribute('style');
  button.className = className;
  Object.assign(button.style, style, { color });
}

export class Controls {
  /** The capsule that holds the buttons; data-vot names its mode and keeps YouTube's own queries off it. */
  private group: HTMLElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  /** player(): the player element, when the page has one. */
  constructor(private readonly player: () => HTMLElement | null) {}

  mount(buttons: HTMLElement[]): void {
    const place = this.place();
    const group = this.own(place.mode);
    for (const b of buttons) {
      if (place.mode === 'bar') {
        restyle(b, 'ytp-button', {}); // YouTube's CSS styles .ytp-button
      } else if (place.mode === 'top') {
        restyle(b, '', { flex: 'none', width: '48px', height: '48px', padding: '0', border: '0',
          background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', filter: 'drop-shadow(0 0 2px rgba(0,0,0,.8))' });
      } else {
        restyle(b, '', { flex: 'none', width: '40px', height: '40px', padding: '0', border: '0', borderRadius: '20px',
          background: 'rgba(0,0,0,.6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer' });
      }
    }
    group.replaceChildren(...buttons);
    if (place.bar) place.bar.before(group);
    else if (place.mode === 'top') place.into.prepend(group);
    else place.into.append(group);
    if (place.mode === 'overlay') this.autoHide(place.into);
  }

  /** The buttons are not where they belong now. YouTube's top row renders late, after they went into a capsule;
   *  a computer's page goes between a video and a short without a load and keeps the player it left, hidden, with
   *  the buttons in it (seen on youtube.com: after a short they stayed in its player, 0 px wide). */
  wantsRemount(): boolean {
    if (!this.group) return false;
    const place = this.place();
    return this.group.dataset.vot !== place.mode || this.group.parentElement !== place.into;
  }

  /** The quick settings belong under the buttons: they are in a short's top row on a computer, and the short's
   *  name and channel lie over the player's bottom (seen on youtube.com: they took the presses meant for the
   *  panel's last rows). */
  panelAtTop(): boolean {
    return isShorts() && !!this.group && this.group.dataset.vot === 'top';
  }

  /** Where the buttons belong on the page as it is now: the capsule's mode and the element it is put into. */
  private place(): { mode: Mode; into: HTMLElement; bar?: Element } {
    // Desktop player: our buttons get their own capsule left of YouTube's right controls. The capsule carries
    // YouTube's own class, so the player's CSS gives it the same look, button sizes, hover pill and big-mode
    // sizes (other extensions looking for that class may find ours first).
    const bar = isShorts() ? null : document.querySelector('#movie_player .ytp-right-controls:not([data-vot])');
    if (bar && bar.parentElement) return { mode: 'bar', into: bar.parentElement, bar };
    // Phones (m.youtube.com) and a short on a computer: YouTube's top control row (captions, settings, full
    // screen) lives outside the player, over its top right corner. Our buttons go into that row before YouTube's
    // own, so they never overlap them and show and hide with YouTube's controls (also in full screen).
    const top = topRow();
    if (top) return { mode: 'top', into: top };
    // A short on a phone: a capsule over the page, at the top left under YouTube's top bar (its buttons are at the
    // right and at the bottom). Other layouts without either: a capsule in the player's top right corner, shown on
    // a tap like YouTube's own controls. No player: one floating capsule above YouTube's bottom bar.
    if (phoneShort()) return { mode: 'float', into: document.body };
    const player = this.player();
    return player ? { mode: 'overlay', into: player } : { mode: 'float', into: document.body };
  }

  unmount(): void {
    if (this.group) this.group.remove();
  }

  /** The capsule of the mode, made anew when the mode changes. */
  private own(mode: Mode): HTMLElement {
    if (this.group && this.group.dataset.vot === mode) return this.group;
    if (this.group) this.group.remove();
    const g = (this.group = document.createElement('div'));
    g.dataset.vot = mode;
    if (mode === 'bar') {
      g.className = 'ytp-right-controls';
      g.style.marginRight = '8px';
    } else if (mode === 'top') {
      // a short's row on a computer lets presses through to the video and only its own buttons take them
      Object.assign(g.style, { display: 'flex', flex: 'none', alignItems: 'center', pointerEvents: 'auto' });
    } else {
      Object.assign(g.style, { display: 'flex', gap: '8px', zIndex: mode === 'overlay' ? '60' : '2147483646',
        transition: 'opacity .2s', position: mode === 'overlay' ? 'absolute' : 'fixed',
        top: mode === 'overlay' ? '8px' : '', right: mode === 'overlay' ? '8px' : '12px',
        bottom: mode === 'float' ? 'calc(64px + env(safe-area-inset-bottom, 0px))' : '' });
      if (mode === 'float' && phoneShort()) {
        Object.assign(g.style, { top: 'calc(56px + env(safe-area-inset-top, 0px))', left: '12px', right: '', bottom: '' });
      }
    }
    return g;
  }

  /** In the player the capsule shows for a few seconds after a touch or a move over the video (as YouTube's own
   *  controls do) and while one of our buttons or panels is in use; hidden it lets touches through to the video. */
  private autoHide(player: HTMLElement): void {
    if (player.dataset.votHide) return;
    player.dataset.votHide = '1';
    const show = (): void => {
      const g = this.group;
      if (!g || g.dataset.vot !== 'overlay') return;
      g.style.opacity = '1';
      g.style.pointerEvents = '';
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        if (g.matches(':hover') || g.contains(document.activeElement)) return show();
        g.style.opacity = '0';
        g.style.pointerEvents = 'none';
      }, 3500);
    };
    // Taps may land on a control layer outside the player (phones): listen on the page, keep those over the player.
    const near = (e: Event): void => {
      const t = 'touches' in e ? (e as TouchEvent).touches[0] : (e as PointerEvent);
      const b = player.getBoundingClientRect();
      if (t && t.clientX >= b.left && t.clientX <= b.right && t.clientY >= b.top && t.clientY <= b.bottom) show();
    };
    for (const ev of ['pointerdown', 'pointermove', 'touchstart']) {
      document.addEventListener(ev, near, { capture: true, passive: true });
    }
    show();
  }
}
