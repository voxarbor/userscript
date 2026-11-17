// The video's settings as controls: the two volumes, the voice, ducking, waiting and the speakers' voices.
import type { Voice } from '../api/client';
import type { Settings } from '../settings/store';
import { el } from './dom';
import type { UiHost } from './host';
import { FIELD_CSS } from './styles';

// how the speakers of a video are voiced (settings.mode), as the quick settings offer it
const MODES: [Settings['mode'], string][] = [['', 'як на сервері'], ['one', 'один голос'], ['two', 'два голоси (Ч/Ж)'], ['each', 'кожен мовець свій']];

/** The quick panel's row that names the voice and opens the voices: «Голос», the name in one line (a long one is
 *  cut with «…» and shown whole in the tooltip), a chevron. name(text) writes the name. */
function voiceRow(onClick: () => void): { row: HTMLButtonElement; name: (text: string) => void } {
  const label = el('span', { textContent: 'Голос', style: 'flex:none;opacity:.7' });
  const value = el('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left' });
  const b = el('button', { type: 'button' }, label, value, el('span', { textContent: '›', style: 'flex:none;font-size:20px;line-height:1' }));
  b.style.cssText = 'display:flex;gap:8px;align-items:center;width:100%;margin-top:12px;' +
    'padding:8px 12px;border:0;border-radius:8px;background:rgba(255,255,255,.1);color:#fff;font:inherit;cursor:pointer';
  b.addEventListener('pointerenter', () => (b.style.background = 'rgba(255,255,255,.18)'));
  b.addEventListener('pointerleave', () => (b.style.background = 'rgba(255,255,255,.1)'));
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return { row: b, name: (text) => (value.textContent = b.title = text) };
}

/** Video settings shared by the quick panel and the settings window; every control applies live (the session
 *  reads the settings every frame; unchecking waitForVoice also resumes a held video).
 *  voices(): every voice of the server. openVoices(): shows the «Голоси» tab. */
export function videoControls(host: UiHost, voices: () => Promise<Voice[]>, openVoices: () => void): HTMLElement[] {
  const settings = host.store.current;
  const slider = (key: 'origVolume' | 'voiceVolume', label: string): HTMLElement => {
    const out = el('span', { textContent: Math.round(settings[key] * 100) + '%', style: 'float:right;opacity:.8' });
    const i = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(settings[key] * 100)) });
    i.style.cssText = 'display:block;width:100%;margin:4px 0 10px;accent-color:#f33';
    i.addEventListener('input', () => {
      settings[key] = Number(i.value) / 100;
      out.textContent = i.value + '%';
      if (key === 'voiceVolume') host.onVoiceVolume();
      host.store.saveSoon(); // a slider fires many input events per drag
    });
    return el('label', { style: 'display:block' }, label, out, i);
  };
  // The voice is chosen on the «Голоси» tab (cards with samples); here only its name, which opens that tab.
  const voice = voiceRow(openVoices);
  voice.name(settings.voice);
  voices().then((list) => {
    const v = list.find((x) => x.id === settings.voice);
    if (v) voice.name(v.label);
  }, () => {});
  const toggle = (key: 'duckAlways' | 'waitForVoice', label: string): HTMLElement => {
    const i = el('input', { type: 'checkbox', checked: settings[key] });
    i.style.cssText = 'margin:0 8px 0 0;accent-color:#f33;vertical-align:middle;width:16px;height:16px';
    i.addEventListener('change', () => {
      settings[key] = i.checked;
      host.store.save();
    });
    return el('label', { style: 'display:flex;align-items:center;min-height:32px;margin-top:6px;cursor:pointer', title: '' }, i, label);
  };
  // how the speakers are voiced; '' leaves the video as the server has it. Telling speakers apart is still
  // rough (owner): one narrator over music may be split in several, so two voices is the steadier choice
  const modes = el('select', { title: 'Розпізнавання мовців ще неточне: один голос на фоні музики може ' +
    'розбитись на кількох мовців. «Два голоси» надійніші: усі чоловіки одним голосом, усі жінки іншим. Старт ~2 хв' });
  modes.style.cssText = FIELD_CSS + ';margin-top:6px';
  modes.append(...MODES.map(([value, label]) => new Option(label, value, false, value === settings.mode)));
  modes.addEventListener('change', () => {
    settings.mode = modes.value as Settings['mode'];
    host.store.save();
    host.onVoicesChanged();
  });
  return [slider('origVolume', 'Оригінал'), slider('voiceVolume', 'Озвучка'), voice.row,
    toggle('duckAlways', 'Приглушувати весь час'), toggle('waitForVoice', 'Пауза, поки озвучка не готова'),
    el('label', { style: 'display:block;margin-top:6px' }, 'Голоси мовців', modes)];
}
