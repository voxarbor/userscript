// Where the script's buttons live on YouTube: the desktop player's bar, the phone's top control row, or a capsule
// over the player (shorts and other layouts).

type Mode = 'bar' | 'mtop' | 'overlay' | 'float';

const isShorts = (): boolean => location.pathname.startsWith('/shorts/');

/** m.youtube.com's top control row, when the page has it (it appears once the player has started). */
function mobileTop(): HTMLElement | null {
  return isShorts() ? null : document.querySelector<HTMLElement>('#player-control-container .player-controls-top');
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
    // Desktop player: our buttons get their own capsule left of YouTube's right controls. The capsule carries
    // YouTube's own class, so the player's CSS gives it the same look, button sizes, hover pill and big-mode
    // sizes (other extensions looking for that class may find ours first).
    const bar = !isShorts() && document.querySelector('#movie_player .ytp-right-controls:not([data-vot])');
    if (bar) {
      const group = this.own('bar');
      for (const b of buttons) restyle(b, 'ytp-button', {}); // YouTube's CSS styles .ytp-button
      group.replaceChildren(...buttons);
      bar.before(group);
      return;
    }
    // Phones (m.youtube.com): YouTube's top control row (autoplay, captions, settings) lives outside the player,
    // over its top right corner. Our buttons go into that row before YouTube's own, so they never overlap them
    // and show and hide with YouTube's controls (also in full screen).
    const top = mobileTop();
    if (top) {
      const group = this.own('mtop');
      for (const b of buttons) {
        restyle(b, '', { flex: 'none', width: '48px', height: '48px', padding: '0', border: '0',
          background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', filter: 'drop-shadow(0 0 2px rgba(0,0,0,.8))' });
      }
      group.replaceChildren(...buttons);
      top.prepend(group);
      return;
    }
    // Shorts and other layouts without either bar: a capsule in the player's top right corner, shown on a tap
    // like YouTube's own controls. No player: one floating capsule above YouTube's bottom bar.
    const player = this.player();
    const group = this.own(player ? 'overlay' : 'float');
    for (const b of buttons) {
      restyle(b, '', { flex: 'none', width: '40px', height: '40px', padding: '0', border: '0', borderRadius: '20px',
        background: 'rgba(0,0,0,.6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer' });
    }
    group.replaceChildren(...buttons);
    (player || document.body).append(group);
    if (player) this.autoHide(player);
  }

  /** The buttons should move: the phone's top row renders late, after they went into a capsule. */
  wantsRemount(): boolean {
    const mode = this.group && this.group.dataset.vot;
    return !!this.group && mode !== 'mtop' && mode !== 'bar' && !!mobileTop();
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
    } else if (mode === 'mtop') {
      Object.assign(g.style, { display: 'flex', flex: 'none', alignItems: 'center' });
    } else {
      Object.assign(g.style, { display: 'flex', gap: '8px', zIndex: mode === 'overlay' ? '60' : '2147483646',
        transition: 'opacity .2s', position: mode === 'overlay' ? 'absolute' : 'fixed',
        top: mode === 'overlay' ? '8px' : '', right: mode === 'overlay' ? '8px' : '12px',
        bottom: mode === 'float' ? 'calc(64px + env(safe-area-inset-bottom, 0px))' : '' });
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
