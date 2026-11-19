// A question over the page: a small window in the middle that keeps keys and clicks away from the player.
import { type Child, el, overPage, shield } from './dom';
import { PANEL_CSS } from './styles';

/** Puts a dialog with these children on the page. onEscape(): Escape was pressed in it. */
export function openDialog(kids: Child[], onEscape: () => void): HTMLElement {
  const dialog = el('div', { role: 'dialog' }, ...kids);
  dialog.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' + PANEL_CSS +
    ';width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:18px 20px';
  shield(dialog);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onEscape();
  });
  overPage(dialog);
  return dialog;
}

/** A button of a dialog; primary: the answer the dialog suggests. */
export function choice(text: string, onClick: () => void, primary?: boolean): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: text });
  b.style.cssText = 'padding:8px 18px;border:0;border-radius:18px;font:500 14px Roboto,Arial,sans-serif;cursor:pointer;' +
    (primary ? 'background:#f1f1f1;color:#0f0f0f' : 'background:rgba(255,255,255,.1);color:#fff');
  b.addEventListener('click', onClick);
  return b;
}
