// The script's two buttons in the player: the voice-over switch, whose colour tells the state, and «tune», which
// opens the quick settings.
import type { SessionState } from '../core/types';
import { el, icon, ICON_TRANSLATE, ICON_TUNE } from './dom';

const COLORS: Record<SessionState, string> = { idle: '#fff', busy: '#fc0', on: '#4e4', offline: '#f66', error: '#f66' };
const BTN_CSS = 'border:0;cursor:pointer;background:none;color:#fff;' +
  'display:inline-flex;align-items:center;justify-content:center;width:48px;padding:0 12px;';

/** The voice-over switch: a click toggles; a right click or a long press opens the settings. */
export function mainButton(onToggle: () => void, openSettings: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button' }, icon(ICON_TRANSLATE));
  b.dataset.vot = 'main';
  b.style.cssText = BTN_CSS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let long = false;
  b.addEventListener('pointerdown', () => {
    long = false;
    timer = setTimeout(() => {
      long = true;
      openSettings();
    }, 600);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
  onPress(b, () => {
    if (!long) onToggle();
  });
  b.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSettings();
  });
  return b;
}

export function tuneButton(onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', title: 'VoxArbor UA: гучність і голос' }, icon(ICON_TUNE));
  b.style.cssText = BTN_CSS;
  onPress(b, onClick);
  return b;
}

/** A press: a click, or a touch that ends on the button. m.youtube.com on an iPhone takes the touches over its
 *  player and their click never comes (its touchstart is cancelled, seen 2026-11-21): the touch's own pointerup
 *  presses then, and a click that still follows it is not a second press. */
function onPress(b: HTMLElement, run: () => void): void {
  let touched = -Infinity;
  b.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    touched = Date.now();
    run();
  });
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - touched > 1000) run();
  });
}

/** The switch tells the state by its colour; text is its tooltip (the usual hint without one). */
export function showState(button: HTMLElement, state: SessionState, text?: string): void {
  button.style.color = COLORS[state];
  button.title = text || 'Українська озвучка (правий клік: налаштування)';
}
