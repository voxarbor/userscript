// The settings window. One wide window of a fixed size with tabs (owner): «Основні» (connection and video),
// «Голоси», «Мовці»; only the tab body scrolls. Right click / long press on the button opens «Основні», the quick
// panel «Голоси».
import type { VideoVoices, Voice } from '../api/client';
import { deviceName, signIn } from '../core/signin';
import { el } from './dom';
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
    const show = async (id: TabId): Promise<void> => {
      for (const [tab, b] of buttons) {
        b.style.background = tab === id ? '#f1f1f1' : 'none';
        b.style.color = tab === id ? '#0f0f0f' : '#fff';
      }
      body.scrollTop = 0;
      if (id === 'main') return body.replaceChildren(...this.mainTab());
      body.replaceChildren(note('Завантаження…'));
      try {
        const [list, voiced] = await Promise.all([this.voices(), this.videoVoices()]);
        body.replaceChildren(...(await (id === 'voices' ? this.voicesTab(list, voiced) : this.speakersTab(list, voiced))));
      } catch (e) {
        body.replaceChildren(note('Не вдалося завантажити: ' + (e as Error).message));
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
    root.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep site hotkeys out of the inputs
      if (e.key === 'Escape') this.close();
    });
    document.body.append(root);
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
    const connection = el('div');
    this.showConnection(connection);
    return [heading('Підключення'), connection, heading('Відео'), el('div', { style: 'max-width:420px' }, ...this.videoControls())];
  }

  // Connected: whose account it is and «Відключити» (the token is forgotten here; the profile can revoke it).
  // Not connected: «Підключити», which signs in through the site (core/signin.ts).
  private showConnection(box: HTMLElement): void {
    const settings = this.host.store.current;
    const status = note(settings.token ? (settings.account ? `Підключено як ${settings.account}` : 'Підключено')
      : 'Підключення потрібне, щоб перекладати й озвучувати нові відео: натисніть «Підключити», увійдіть на сайті й підтвердьте код.');
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
      : () => void this.connect(box, button, status);
    box.replaceChildren(status, button);
  }

  private async connect(box: HTMLElement, button: HTMLButtonElement, status: HTMLElement): Promise<void> {
    if (this.signing) return;
    this.signing = button.disabled = true;
    const site = {
      api: this.host.api,
      openTab: (url: string) => this.host.openTab(url),
      wait: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
    };
    try {
      const got = await signIn(site, deviceName(navigator.userAgent), (code) => {
        status.textContent = `Код ${code}: перевірте, що на сайті той самий, і натисніть там «Підключити».`;
      });
      Object.assign(this.host.store.current, { token: got.token, account: `${got.login} · ${got.name}` });
      this.host.store.save();
      this.signing = false;
      this.host.onConnectionChanged();
      this.showConnection(box);
    } catch (e) {
      status.textContent = (e as Error).message;
    } finally {
      this.signing = button.disabled = false;
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
      const sel = voiceSelect(list, voiced, sp.manual ? sp.voice : '', 'авто' + (sp.voice ? ` (${label(sp.voice)})` : ''), async (id) => {
        await host.api.speakerVoice(key, sp.id, id || null);
        host.onVoicesChanged(); // re-voiced from the viewer's position: refetch the window
      });
      return el('div', { style: 'padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.06)' },
        el('div', { style: 'display:flex;align-items:center;gap:8px' },
          el('b', { textContent: `${sp.id} ${sex}${conf}`, style: 'flex:1' }),
          el('span', { textContent: talk, style: 'opacity:.8;font-size:13px' }),
          playBtn('Оригінал', async () => previews.playOriginal(sp.original)),
          playBtn('Озвучка', () => (sp.voiced ? previews.playClip(sp.voiced) : Promise.reject(new Error('ще не озвучено'))))),
        sel,
        leadSet ? note('Головний мовець: його голос задає «Головний ' + (sp.gender === 'male' ? 'чоловічий' : 'жіночий') +
          ' голос» на вкладці «Голоси».') : '');
    })));
    return out;
  }
}
