// Small builders of the settings window: texts, the card grid, the ▶ button and the voice list.
import type { VideoVoices, Voice } from '../api/client';
import { type Child, el } from './dom';
import { groupVoices, voicedMark } from './format';
import { FIELD_CSS } from './styles';

export const note = (text: string): HTMLElement => el('div', { textContent: text, style: 'opacity:.7;font-size:13px;margin:6px 0' });
export const heading = (text: string): HTMLElement => el('div', { textContent: text, style: 'font-weight:600;margin:18px 0 8px' });
export const grid = (min: number, items: Child[]): HTMLElement =>
  el('div', { style: `display:grid;grid-template-columns:repeat(auto-fill,minmax(${min}px,1fr));gap:8px` }, ...items);
export const card = (style: string, ...kids: Child[]): HTMLElement => el('div', { style: 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;' +
  'background:rgba(255,255,255,.06);' + style }, ...kids);

/** Round ▶ button; shows «!» with the reason instead of failing silently (a sample may take seconds the first time). */
export function playBtn(title: string, run: () => Promise<void>): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: '▶', title });
  b.style.cssText = 'flex:none;width:32px;height:32px;border:0;border-radius:16px;background:rgba(255,255,255,.12);' +
    'color:#fff;cursor:pointer;font-size:12px';
  b.addEventListener('click', async () => {
    b.textContent = '…';
    try {
      await run();
      b.textContent = '▶';
    } catch (e) {
      b.textContent = '!';
      b.title = title + ': ' + (e as Error).message;
    }
  });
  return b;
}

/** <select> of voices grouped by gender; the first option is «auto» ('' value) when auto is given.
 *  voiced: which voices already have audio for the video (marked in the list). current: the chosen voice's id. */
export function voiceSelect(list: Voice[], voiced: VideoVoices | null, current: string | null, auto: string,
  onChange: (id: string) => void): HTMLSelectElement {
  const sel = el('select');
  sel.style.cssText = FIELD_CSS;
  const opt = (v: Voice): HTMLOptionElement => new Option(v.label + voicedMark(voiced, v.id), v.id, false, v.id === current);
  const g = groupVoices(list);
  const kids: HTMLElement[] = auto ? [new Option(auto, '', false, !current)] : [];
  const groups: [string, Voice[]][] = [['Чоловічі', g.male], ['Жіночі', g.female], ['Інші', g.other]];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    const og = el('optgroup', { label });
    og.append(...items.map(opt));
    kids.push(og);
  }
  if (current && !list.some((v) => v.id === current)) kids.push(new Option(current, current, false, true));
  sel.replaceChildren(...kids);
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
