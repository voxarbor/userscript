// The settings window. One wide window of a fixed size with tabs (owner): «Основні» (connection and video),
// «Голоси», «Мовці»; only the tab body scrolls. Right click / long press on the button opens «Основні», the quick
// panel «Голоси».
import type { VideoVoices, Voice } from '../api/client';
import { deviceName, signIn } from '../core/signin';
import { el, overPage, shield } from './dom';
import { fmtDur, groupVoices, voicedMark } from './format';
import type { UiHost } from './host';
import { Previews } from './preview';
import { PANEL_CSS } from './styles';
import { card, grid, heading, note, playBtn, voiceSelect } from './widgets';

type TabId = 'main' | 'voices' | 'speakers';

const TABS: [TabId, string][] = [['main', 'Основні'], ['voices', 'Голоси'], ['speakers', 'Мовці']];

export class SettingsWindow {
  private win: { root: HTMLElement; show: (tab: TabId) => Promise<void> } | null = null;
  private signing = false; // «Підключити» waits for the site: one sign-in at a time, whether the window stays open or not
  private signNote: string | null = null; // what the sign-in says now (its code, or why it failed); null: nothing
  private connection: HTMLElement | null = null; // the box of the connection on «Основні», as shown last
  private readonly previews: Previews;

  /** voices(): every voice of the server. videoControls(): the video's settings as controls (the quick panel
   *  shows the same). */
  constructor(
    private readonly host: UiHost,
    private readonly voices: () => Promise<Voice[]>,
    private readonly videoControls: () => HTMLElement[],
  ) {
    this.previews = new Previews(host);
  }

  /** Opens the window on the tab, or turns the open window to it. */
  open(tab: TabId): void {
    if (this.win) return void this.win.show(tab);
    const body = el('div', { style: 'flex:1;overflow:auto;padding:0 22px 22px' });
    const bar = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' });
    const buttons: [TabId, HTMLButtonElement][] = [];
    let shown = 0; // grows with every tab shown: a tab that loads slowly does not replace the one opened after it
    const show = async (id: TabId): Promise<void> => {
      const turn = ++shown;
      for (const [tab, b] of buttons) {
        b.style.background = tab === id ? '#f1f1f1' : 'none';
        b.style.color = tab === id ? '#0f0f0f' : '#fff';
      }
      body.scrollTop = 0;
      if (id === 'main') return body.replaceChildren(...this.mainTab());
      body.replaceChildren(note('Завантаження…'));
      try {
        const [list, voiced] = await Promise.all([this.voices(), this.videoVoices()]);
        const made = await (id === 'voices' ? this.voicesTab(list, voiced) : this.speakersTab(list, voiced));
        if (turn === shown) body.replaceChildren(...made);
      } catch (e) {
        if (turn === shown) body.replaceChildren(note('Не вдалося завантажити: ' + (e as Error).message));
      }
    };
    for (const [id, name] of TABS) {
      const b = el('button', { type: 'button', textContent: name });
      b.style.cssText = 'padding:6px 16px;border:1px solid #666;border-radius:16px;font:inherit;cursor:pointer';
      b.addEventListener('click', () => show(id));
      bar.append(b);
      buttons.push([id, b]);
    }
    const close = el('button', { type: 'button', textContent: '✕', title: 'Закрити' });
    close.style.cssText = 'position:absolute;top:14px;right:16px;width:32px;height:32px;border:0;border-radius:16px;background:rgba(255,255,255,.1);' +
      'color:#fff;font-size:15px;cursor:pointer';
    close.onclick = () => this.close();
    const head = el('div', { style: 'position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:16px 60px 14px 22px' },
      el('div', { textContent: 'VoxArbor UA', style: 'font-weight:700;font-size:18px;white-space:nowrap' }), bar, close); // ✕ pinned: narrow screens wrap the tabs
    const root = el('div', {}, head, body);
    this.win = { root, show };
    root.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' + PANEL_CSS +
      ';width:min(900px,94vw);height:min(640px,88vh);display:flex;flex-direction:column;overflow:hidden';
    shield(root); // the site's hotkeys stay out of the inputs, and the player around the window gets no click made in it
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    overPage(root);
    void show(tab);
  }

  close(): void {
    if (this.win) this.win.root.remove();
    this.win = null;
    this.previews.stopClip();
    this.previews.stopOriginal();
  }

  // {total, voices: {voice: voiced count}} for the current video, or null without one.
  private videoVoices(): Promise<VideoVoices | null> {
    const key = this.host.videoKey();
    return key ? this.host.api.videoVoices(key).catch(() => null) : Promise.resolve(null);
  }

  // «Основні»: the connection to the account and the live video controls.
  private mainTab(): HTMLElement[] {
    const connection = (this.connection = el('div'));
    this.showConnection(connection);
    return [heading('Підключення'), connection, heading('Відео'), el('div', { style: 'max-width:420px' }, ...this.videoControls()),
      heading('Діагностика'), ...this.diagnostics()];
  }

  // «Діагностика»: the journal of what the script did and when (kept in memory all the time), to send when the
  // voice-over misbehaves; its copy in the browser's console is a setting (?vxdebug=1 in the address sets it too).
  private diagnostics(): HTMLElement[] {
    const settings = this.host.store.current;
    const copy = el('button', { type: 'button', textContent: 'Копіювати журнал' });
    copy.style.cssText = 'margin-top:4px;padding:8px 16px;border:0;border-radius:18px;background:rgba(255,255,255,.12);color:#fff;' +
      'font:500 14px Roboto,Arial,sans-serif;cursor:pointer';
    copy.addEventListener('click', () => {
      this.host.copy(this.host.journal()).then(() => (copy.textContent = 'Скопійовано'), () => (copy.textContent = 'Не вдалося скопіювати'));
    });
    const box = el('input', { type: 'checkbox', checked: settings.debug });
    box.style.cssText = 'margin:0 8px 0 0;accent-color:#f33;vertical-align:middle;width:16px;height:16px';
    box.addEventListener('change', () => {
      settings.debug = box.checked;
      this.host.store.save();
    });
    return [note('Якщо озвучка мовчить або запізнюється: відтворіть проблему, натисніть «Копіювати журнал» і надішліть його. ' +
      'У журналі час кожного кроку запуску; токена в ньому немає.'), copy,
      el('label', { style: 'display:flex;align-items:center;min-height:32px;margin-top:6px;cursor:pointer' }, box, 'Писати журнал у консоль браузера')];
  }

  // Connected: whose account it is and «Відключити» (the token is forgotten here; the profile can revoke it).
  // Not connected: «Підключити», which signs in through the site (core/signin.ts).
  private showConnection(box: HTMLElement): void {
    const settings = this.host.store.current;
    const status = note(settings.token ? (settings.account ? `Підключено як ${settings.account}` : 'Підключено')
      : this.signNote ?? 'Підключення потрібне, щоб перекладати й озвучувати нові відео: натисніть «Підключити», увійдіть на сайті й підтвердьте код.');
    status.dataset.connection = '';
    const button = el('button', { type: 'button', textContent: settings.token ? 'Відключити' : 'Підключити', disabled: this.signing });
    button.style.cssText = 'margin-top:4px;padding:8px 16px;border:0;border-radius:18px;background:#f1f1f1;color:#0f0f0f;' +
      'font:500 14px Roboto,Arial,sans-serif;cursor:pointer';
    button.onclick = settings.token
      ? () => {
        settings.token = settings.account = '';
        this.host.store.save();
        this.host.onConnectionChanged();
        this.showConnection(box);
      }
      : () => void this.connect();
    box.replaceChildren(status, button);
  }

  // The sign-in outlives the tab it was started on: what it says is kept here and shown in the box «Основні» has
  // now (the one it was started in may be gone: another tab was looked at, or the window closed and opened again).
  private async connect(): Promise<void> {
    if (this.signing) return;
    const show = (say: string | null): void => {
      this.signNote = say;
      if (this.connection) this.showConnection(this.connection);
    };
    this.signing = true;
    show(null);
    const site = {
      api: this.host.api,
      openTab: (url: string) => this.host.openTab(url),
      wait: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
      now: () => Date.now(),
    };
    try {
      const got = await signIn(site, deviceName(navigator.userAgent), (code) =>
        show(`Код ${code}: перевірте, що на сайті той самий, і натисніть там «Підключити».`));
      Object.assign(this.host.store.current, { token: got.token, account: `${got.login} · ${got.name}` });
      this.host.store.save();
      this.signing = false;
      this.host.onConnectionChanged();
      show(null);
    } catch (e) {
      this.signing = false;
      show((e as Error).message);
    }
  }

  // «Голоси»: voice cards (click picks the voice, ▶ plays a sample; voices with audio for this video in green)
  // and the lead voice per gender for a video whose speakers are told apart.
  private voicesTab(list: Voice[], voiced: VideoVoices | null): HTMLElement[] {
    const { host } = this;
    const settings = host.store.current;
    const lead = (key: 'leadMale' | 'leadFemale', label: string, gender: string): HTMLElement => el('label', { style: 'display:block' }, label,
      voiceSelect(list.filter((v) => v.gender === gender), voiced, settings[key], 'авто (за правилом сервера)', (id) => {
        settings[key] = id;
        host.store.save();
        host.onVoicesChanged(); // the server re-voices the first speaker of that gender
      }));
    const shown: [Voice, HTMLElement][] = []; // [voice, card] for restyling when the choice changes
    const look = (v: Voice, c: HTMLElement): void => {
      const ring = v.id === settings.voice ? '0 0 0 2px #f1f1f1' : voicedMark(voiced, v.id) ? '0 0 0 1px #4e4' : 'none';
      c.style.boxShadow = ring.replace(/^0/, 'inset 0');
      c.style.background = v.id === settings.voice ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.06)';
    };
    const cards = (items: Voice[]): HTMLElement => grid(220, items.map((v) => {
      const mark = voicedMark(voiced, v.id);
      const c = card('cursor:pointer',
        el('span', { textContent: v.label, style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: v.label }),
        mark ? el('span', { textContent: mark.trim(), style: 'color:#8f8;font-size:13px' }) : '',
        playBtn('Зразок голосу', () => this.previews.playClip(v.sample)));
      c.addEventListener('click', (e) => {
        if ((e.target as Element).closest('button') || v.id === settings.voice) return; // ▶ only plays the sample
        settings.voice = v.id;
        host.store.save();
        host.onVoicesChanged();
        for (const [x, y] of shown) look(x, y);
      });
      shown.push([v, c]);
      look(v, c);
      return c;
    }));
    const section = (title: string, items: Voice[]): HTMLElement[] => (items.length ? [heading(title), cards(items)] : []);
    const g = groupVoices(list);
    return [note('Натисніть на голос, щоб озвучувати ним; ▶ — зразок. Зеленим позначено голоси, якими це відео вже озвучено: перемикання на них миттєве.'),
      ...section('Чоловічі', g.male), ...section('Жіночі', g.female), ...section('Інші', g.other),
      heading('Головний голос для кожної статі'),
      note('Діє, коли на вкладці «Основні» в «Голоси мовців» обрано два голоси або свій голос кожному мовцю. ' +
        'Два голоси: усі чоловіки звучать чоловічим, усі жінки жіночим. Кожен мовець свій: цей голос отримує перший мовець своєї статі, інші — свої.'),
      grid(260, [lead('leadMale', 'Чоловічий', 'male'), lead('leadFemale', 'Жіночий', 'female')])];
  }

  // «Мовці»: who speaks in the current video, their voices, samples of the original and of the voice-over.
  private async speakersTab(list: Voice[], voiced: VideoVoices | null): Promise<HTMLElement[]> {
    const { host, previews } = this;
    const key = host.videoKey();
    if (!key) return [note('Увімкніть озвучку на відео, щоб побачити його мовців.')];
    const r = await host.api.speakers(key);
    const label = (id: string): string => (list.find((v) => v.id === id) || { label: id }).label;
    const out: HTMLElement[] = [];
    if (r.mode === 'one') out.push(note('Відео озвучене одним голосом: мовці не розрізняються («Голоси мовців» на вкладці «Основні»).'));
    if (!r.speakers.length) out.push(note('Мовців ще не розпізнано.'));
    out.push(grid(300, r.speakers.map((sp, n) => {
      const sex = sp.gender === 'male' ? '♂' : sp.gender === 'female' ? '♀' : '?';
      const conf = sp.gender_confidence == null ? '' : ` ${Math.round(sp.gender_confidence * 100)}%`;
      const talk = sp.talk_s == null ? '' : `говорить ${fmtDur(sp.talk_s)}`;
      const leadSet = n === 0 && (sp.gender === 'male' ? r.lead_male : sp.gender === 'female' ? r.lead_female : null);
      let chosen = (sp.manual && sp.voice) || ''; // the voice the server has for the speaker; '': its own choice
      const problem = el('div', { style: 'color:#f88;font-size:13px;margin-top:4px' });
      const sel = voiceSelect(list, voiced, chosen, 'авто' + (sp.voice ? ` (${label(sp.voice)})` : ''), (id) => {
        problem.textContent = '';
        host.api.speakerVoice(key, sp.id, id || null).then(() => {
          chosen = id;
          host.onVoicesChanged(); // re-voiced from the viewer's position: refetch the window
        }, (e: Error) => {
          sel.value = chosen; // the server kept the voice before: the list says so again
          problem.textContent = 'Не вдалося змінити голос: ' + e.message;
        });
      });
      return el('div', { style: 'padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.06)' },
        el('div', { style: 'display:flex;align-items:center;gap:8px' },
          el('b', { textContent: `${sp.id} ${sex}${conf}`, style: 'flex:1' }),
          el('span', { textContent: talk, style: 'opacity:.8;font-size:13px' }),
          playBtn('Оригінал', async () => previews.playOriginal(sp.original)),
          playBtn('Озвучка', () => (sp.voiced ? previews.playClip(sp.voiced) : Promise.reject(new Error('ще не озвучено'))))),
        sel, problem,
        leadSet ? note('Головний мовець: його голос задає «Головний ' + (sp.gender === 'male' ? 'чоловічий' : 'жіночий') +
          ' голос» на вкладці «Голоси».') : '');
    })));
    return out;
  }
}
