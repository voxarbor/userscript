// The userscript builds its UI with DOM calls only: YouTube's pages enforce Trusted Types, so HTML from a string
// is refused there (check.sh holds this).

/** What an element takes as a child: a node, or text. */
export type Child = Node | string;
/** Properties to set on a new element; style is its inline CSS as text (an element takes that as style.cssText). */
type Props<E> = Partial<Omit<E, 'style'>> & { style?: string };

/** An element of the tag with the properties set and the children appended. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props<HTMLElementTagNameMap[K]> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/** Where a window of the script is seen: the page, or the element shown full screen when that is not the whole
 *  page (a player shown full screen hides everything outside it; a <video> takes no children). */
function stage(): HTMLElement {
  const full = document.fullscreenElement;
  return full && full.tagName !== 'VIDEO' && !full.contains(document.body) ? (full as HTMLElement) : document.body;
}

/** Puts a window of the script (the settings, a question, a toast) where it is seen, and moves it there again
 *  whenever full screen begins or ends, for as long as it is in the page. */
export function overPage(node: HTMLElement): void {
  const follow = (): void => {
    if (!node.isConnected) return document.removeEventListener('fullscreenchange', follow);
    if (node.parentNode !== stage()) stage().append(node);
  };
  document.addEventListener('fullscreenchange', follow);
  stage().append(node);
}

/** Keeps keys (space, arrows) and presses made in a window of the script away from the player, which may be
 *  around it: it would pause, seek or leave full screen on them. */
export function shield(node: HTMLElement): void {
  for (const ev of ['keydown', 'keyup', 'keypress', 'click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown',
    'pointerup', 'touchstart', 'touchend', 'wheel']) node.addEventListener(ev, (e) => e.stopPropagation());
}

// Material icons (Apache 2.0): translate for the voice-over button, tune for its quick settings (not a gear, so
// it isn't confused with YouTube's settings button next to it).
export const ICON_TRANSLATE = 'M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17' +
  'C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 ' +
  '3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z';
export const ICON_TUNE = 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10z' +
  'm-6-4h2V7h4V5h-4V3h-2v6z';

/** An icon of one path (24 x 24 Material glyph); currentColor follows the button's state colour. */
export function icon(d: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '-2 -2 28 28'); // ~86%: filled Material glyphs look heavier than YouTube's outline icons
  svg.setAttribute('width', '24'); // YouTube's .ytp-button svg rules size it in the player; attributes cover fallbacks
  svg.setAttribute('height', '24');
  svg.style.pointerEvents = 'none';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

/** What a line for the user offers to do: a button with its label. */
export interface ToastAction {
  label: string;
  run: () => void;
}

/** A line at the bottom of the page for six seconds; with an action, a button too and twelve seconds. */
export function toast(message: string, action?: ToastAction): void {
  const d = el('div', { textContent: 'VoxArbor UA: ' + message });
  d.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:2147483647;' +
    'background:#222;color:#fff;padding:8px 14px;border-radius:6px;font:14px sans-serif;max-width:90vw;' +
    'display:flex;gap:12px;align-items:center';
  if (action) {
    const b = el('button', { type: 'button', textContent: action.label });
    b.style.cssText = 'background:#ff8a00;color:#111;border:0;border-radius:4px;padding:6px 10px;font:600 13px sans-serif;' +
      'cursor:pointer;white-space:nowrap';
    b.addEventListener('click', () => {
      d.remove();
      action.run();
    });
    d.append(b);
  }
  shield(d);
  overPage(d);
  setTimeout(() => d.remove(), action ? 12000 : 6000);
}
