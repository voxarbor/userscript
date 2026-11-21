import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

import { ApiError, type SpeakersView, type SpeakerView, type Voice } from '../src/api/client';
import { MemoryPlatform } from '../src/platform/gm';
import { SERVER, type Settings, SettingsStore } from '../src/settings/store';
import { videoControls } from '../src/ui/controls';
import { toast } from '../src/ui/dom';
import { DubQuestion } from '../src/ui/dub';
import { Previews } from '../src/ui/preview';
import { ReadyQuestion } from '../src/ui/ready';
import type { UiHost } from '../src/ui/host';
import { Ui } from '../src/ui/ui';
import { voiceSelect } from '../src/ui/widgets';
import { installAudio } from './fake_audio';
import { fake, type FakeElement, installDom } from './fake_dom';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const voice = (id: string, gender: string | null, label: string): Voice =>
  ({ id, gender, label, name: label, description: '', sample: `/v1/voices/${id}/sample`, changed: false });
const VOICES = [voice('borys', 'male', 'Борис'), voice('anna', 'female', 'Анна'), voice('robot', null, 'Робот')];

const speaker = (id: string, over: Partial<SpeakerView> = {}): SpeakerView =>
  ({ id, gender: null, gender_confidence: null, manual: false, original: null, talk_s: null, voice: null, voiced: null, ...over });

/** A host that notes what the UI tells it; the settings live in a store over a platform in memory. */
function host(over: Partial<UiHost> = {}) {
  const platform = new MemoryPlatform();
  const store = new SettingsStore(platform);
  const told: string[] = [];
  const speakers: SpeakersView = { mode: 'each', lead_male: 'borys', lead_female: null, speakers: [] };
  const h: UiHost = {
    store,
    api: {
      voices: async () => VOICES,
      videoVoices: async () => ({ total: 10, voices: { anna: 5 } }),
      speakers: async () => speakers,
      speakerVoice: async (key, id, to) => {
        told.push(`speaker ${key} ${id} ${to}`);
        return speaker(id);
      },
      bytes: async () => new ArrayBuffer(0),
      deviceCode: async (body) => {
        told.push('device ' + body.name);
        return { device_code: 'dev', user_code: 'BCDF-GHJK', expires_in: 600, interval: 5 };
      },
      deviceToken: async () => ({ token: 'vxa_new', login: 'user', name: 'Мій телефон' }),
    },
    site: { getVideo: () => null, getPlayer: () => null, panelAtTop: () => false },
    videoKey: () => null,
    audio: () => {
      throw new Error('no sound here');
    },
    onToggle: () => told.push('toggle'),
    onVoiceVolume: () => told.push('voice volume'),
    onVoicesChanged: () => told.push('voices changed'),
    onConnectionChanged: () => told.push('connection changed'),
    onOriginal: (on) => told.push('original ' + on),
    openTab: (url) => told.push('open ' + url),
    journal: () => '',
    copy: async () => {},
    ...over,
  };
  const saved = (): Partial<Settings> => platform.getValue<Partial<Settings>>('settings', {});
  return { h, told, speakers, settings: store.current, saved };
}

/** Lets what waits on answered requests run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const options = (select: FakeElement) => select.all('option').map((o) => [o.textContent, o.value, o.selected]);
const texts = (elements: FakeElement[]) => elements.map((e) => e.textContent);
const marked = (tabs: FakeElement[]) => tabs.filter((b) => b.style.background === '#f1f1f1').map((b) => b.textContent);

/** A Ui with its buttons in the page, as the core mounts them. */
function page(over: Partial<UiHost> = {}) {
  const doc = installDom();
  const made = host(over);
  const ui = new Ui(made.h);
  const [main, tune] = ui.buttons().map(fake) as [FakeElement, FakeElement];
  doc.body.append(main, tune);
  /** What lies over the page besides the two buttons: the quick panel, the settings window. */
  const layers = () => doc.body.children.filter((e) => e !== main && e !== tune);
  const tabs = () => layers()[0]!.all('button').filter((b) => ['Основні', 'Голоси', 'Мовці'].includes(b.textContent));
  return { ...made, doc, ui, main, tune, layers, tabs };
}

test('the voice list: «auto» first, the voices by gender, the chosen one selected, a voiced one marked', () => {
  installDom();
  const picked: string[] = [];
  const select = fake(voiceSelect(VOICES, { total: 10, voices: { anna: 5 } }, 'anna', 'авто', (id) => picked.push(id)));
  assert.deepEqual(texts(select.children), ['авто', 'Борис', 'Анна ● 50%', 'Робот']);
  assert.deepEqual(select.all('optgroup').map((g) => g.label), ['Чоловічі', 'Жіночі', 'Інші']);
  assert.deepEqual(options(select), [['авто', '', false], ['Борис', 'borys', false], ['Анна ● 50%', 'anna', true], ['Робот', 'robot', false]]);
  select.value = 'borys';
  select.fire('change');
  assert.deepEqual(picked, ['borys']);
});

test('the voice list without a choice selects «auto»; a chosen voice the server no longer has stays in it', () => {
  installDom();
  const men = VOICES.filter((v) => v.gender === 'male');
  assert.deepEqual(options(fake(voiceSelect(men, null, '', 'авто (за правилом сервера)', () => {}))),
    [['авто (за правилом сервера)', '', true], ['Борис', 'borys', false]]);
  const gone = fake(voiceSelect(men, null, 'old', 'авто', () => {}));
  assert.deepEqual(options(gone), [['авто', '', false], ['Борис', 'borys', false], ['old', 'old', true]]);
  assert.deepEqual(gone.all('optgroup').map((g) => g.label), ['Чоловічі']); // no empty groups
});

test('the speakers\' mode: four choices, the saved one selected; a new choice is saved and told to the session', () => {
  installDom();
  const { h, told, settings, saved } = host();
  settings.mode = 'two';
  const modes = fake(videoControls(h, async () => VOICES, () => {})[5]).all('select')[0]!;
  assert.deepEqual(options(modes), [['як на сервері', '', false], ['один голос', 'one', false],
    ['два голоси (Ч/Ж)', 'two', true], ['кожен мовець свій', 'each', false]]);
  modes.value = 'each';
  modes.fire('change');
  assert.equal(settings.mode, 'each');
  assert.equal(saved().mode, 'each');
  assert.deepEqual(told, ['voices changed']);
});

test('the volume sliders apply at once and are written when they settle; only the voice\'s is told to the session', () => {
  vi.useFakeTimers();
  installDom();
  const { h, told, settings, saved } = host();
  const [original, voiceOver] = videoControls(h, async () => VOICES, () => {}).map(fake) as [FakeElement, FakeElement];
  assert.deepEqual([original.textContent, voiceOver.textContent], ['Оригінал10%', 'Озвучка100%']);
  for (const [label, value] of [[voiceOver, '40'], [original, '25']] as const) {
    const slider = label.all('input')[0]!;
    assert.deepEqual([slider.type, slider.min, slider.max], ['range', '0', '100']);
    slider.value = value;
    slider.fire('input');
  }
  assert.deepEqual([settings.voiceVolume, settings.origVolume], [0.4, 0.25]);
  assert.deepEqual([original.textContent, voiceOver.textContent], ['Оригінал25%', 'Озвучка40%']);
  assert.deepEqual(told, ['voice volume']);
  assert.deepEqual(saved(), {}); // a drag is not written at every step
  vi.advanceTimersByTime(400);
  assert.deepEqual([saved().voiceVolume, saved().origVolume], [0.4, 0.25]);
});

test('the checkboxes show the settings and write a change at once', () => {
  installDom();
  const { h, told, settings, saved } = host();
  const controls = videoControls(h, async () => VOICES, () => {}).map(fake);
  assert.deepEqual(texts(controls.slice(3, 5)), ['Приглушувати весь час', 'Пауза, поки озвучка не готова']);
  const wait = controls[4]!.all('input')[0]!;
  assert.deepEqual([wait.type, wait.checked], ['checkbox', true]);
  wait.checked = false;
  wait.fire('change');
  assert.equal(settings.waitForVoice, false);
  assert.equal(saved().waitForVoice, false);
  assert.deepEqual(told, []); // the session reads the settings itself
});

test('the voice row names the voice (by its label once the voices are known) and opens the voices', async () => {
  installDom();
  const { h, settings } = host();
  settings.voice = 'anna';
  let opened = 0;
  const row = fake(videoControls(h, async () => VOICES, () => opened++)[2]);
  assert.deepEqual([row.textContent, row.title], ['Голосanna›', 'anna']);
  await settle();
  assert.deepEqual([row.textContent, row.title], ['ГолосАнна›', 'Анна']); // the tooltip has the whole name
  // one line: the name gives way and is cut with «…», the word «Голос» and the chevron keep their place
  assert.match(row.children[1]!.style.cssText!, /min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
  assert.deepEqual([row.children[0]!, row.children[2]!].map((c) => /flex:none/.test(c.style.cssText!)), [true, true]);
  assert.equal(row.fire('click').stopped, true); // the player must not take the click
  assert.equal(opened, 1);
});

test('the switch shows the state, toggles on a click and opens the settings on a right click or a long press', () => {
  vi.useFakeTimers();
  const { ui, main, told, layers } = page();
  assert.deepEqual([main.dataset.vot, main.style.color, main.title], ['main', '#fff', 'Українська озвучка (правий клік: налаштування)']);
  ui.setState('busy', 'Чекаю озвучку…');
  assert.deepEqual([main.style.color, main.title], ['#fc0', 'Чекаю озвучку…']);
  ui.setState('on');
  assert.deepEqual([main.style.color, main.title], ['#4e4', 'Українська озвучка (правий клік: налаштування)']);

  main.fire('pointerdown');
  main.fire('pointerup');
  vi.advanceTimersByTime(1000);
  main.fire('click');
  assert.deepEqual([told, layers().length], [['toggle'], 0]); // a short press

  main.fire('pointerdown');
  vi.advanceTimersByTime(600);
  assert.equal(layers().length, 1); // a long press: the settings
  main.fire('click'); // the click that ends the long press toggles nothing
  assert.deepEqual(told, ['toggle']);

  ui.closeSettings();
  assert.equal(layers().length, 0);
  main.fire('contextmenu');
  assert.equal(layers().length, 1);
  assert.deepEqual(told, ['toggle']);
});

test('the buttons are made once, at the first asking; before that there is nothing to take out or to colour', () => {
  installDom();
  const ui = new Ui(host().h);
  assert.equal(ui.removeButtons(), false);
  ui.setState('error', 'x');
  const [main, tune] = ui.buttons();
  assert.deepEqual([fake(main).style.color, fake(tune).title], ['#fff', 'VoxArbor UA: гучність і голос']); // made idle
  assert.deepEqual(ui.buttons(), [main, tune]);
  assert.equal(ui.removeButtons(), true);
});

test('the settings window: three tabs, opened on «Основні», one window however often it is opened', async () => {
  const { ui, layers, tabs } = page();
  ui.openSettings();
  ui.openSettings();
  assert.equal(layers().length, 1);
  assert.deepEqual(texts(tabs()), ['Основні', 'Голоси', 'Мовці']);
  assert.deepEqual(marked(tabs()), ['Основні']);
  const body = layers()[0]!.children[1]!;
  assert.equal(texts(body.children)[0], 'Підключення');

  tabs()[2]!.fire('click');
  assert.deepEqual(marked(tabs()), ['Мовці']);
  assert.equal(body.textContent, 'Завантаження…');
  await settle();
  assert.equal(body.textContent, 'Увімкніть озвучку на відео, щоб побачити його мовців.'); // no voice-over is on

  assert.equal(layers()[0]!.fire('keydown', { key: 'a' }).stopped, true); // the site's hotkeys stay out
  assert.equal(layers().length, 1);
  layers()[0]!.fire('keydown', { key: 'Escape' });
  assert.equal(layers().length, 0);
});

test('a video voiced in one voice says so on the speakers tab', async () => {
  const { ui, layers, tabs, speakers } = page({ videoKey: () => 'k1' });
  speakers.mode = 'one';
  ui.openSettings();
  tabs()[2]!.fire('click');
  await settle();
  assert.match(layers()[0]!.children[1]!.textContent, /^Відео озвучене одним голосом: мовці не розрізняються/);
});

test('a video whose speakers are not known yet says so; a tab that cannot be loaded says why', async () => {
  const { ui, layers, tabs } = page({ videoKey: () => 'k1' });
  ui.openSettings();
  tabs()[2]!.fire('click');
  await settle();
  assert.equal(layers()[0]!.children[1]!.textContent, 'Мовців ще не розпізнано.');
  const failing = page({ api: { ...host().h.api, voices: () => Promise.reject(new Error('HTTP 503')) } });
  failing.ui.openSettings();
  failing.tabs()[1]!.fire('click');
  await settle();
  assert.equal(failing.layers()[0]!.children[1]!.textContent, 'Не вдалося завантажити: HTTP 503');
});

test('«Підключити» shows the code, opens the site on it and keeps the token; «Відключити» forgets it', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0' });
  const { ui, layers, told, settings, saved } = page();
  ui.openSettings();
  const layer = layers()[0]!;
  assert.deepEqual(layer.all('input').filter((i) => ['text', 'password'].includes(i.type as string)), []); // nothing to type
  const button = (label: string) => layer.all('button').find((b) => b.textContent === label);
  const status = () => layer.all('div').find((d) => d.dataset.connection !== undefined)!.textContent;
  assert.match(status(), /^Підключення потрібне, щоб перекладати й озвучувати нові відео/);
  const connect = button('Підключити')!;
  connect.fire('click');
  connect.fire('click'); // pressed again while it waits: one sign-in
  await settle();
  assert.equal(button('Підключити')!.disabled, true);
  assert.match(status(), /^Код BCDF-GHJK:/);
  assert.deepEqual(told, ['device Firefox · Android', `open ${SERVER}/panel/connect?code=BCDF-GHJK`]);
  await vi.advanceTimersByTimeAsync(5000);
  assert.deepEqual([settings.token, saved().token, saved().account], ['vxa_new', 'vxa_new', 'user · Мій телефон']);
  assert.deepEqual(told.slice(2), ['connection changed']);
  assert.equal(status(), 'Підключено як user · Мій телефон');
  assert.equal(button('Підключити'), undefined);

  button('Відключити')!.fire('click');
  assert.deepEqual([settings.token, saved().token, saved().account], ['', '', '']);
  assert.deepEqual(told.slice(2), ['connection changed', 'connection changed']);
  assert.ok(button('Підключити'));
});

test('a script connected before it named its account says only that it is connected', () => {
  const { ui, layers, settings } = page();
  settings.token = 'vxa_old';
  ui.openSettings();
  assert.equal(layers()[0]!.all('div').find((d) => d.dataset.connection !== undefined)!.textContent, 'Підключено');
});

test('the voices tab: a card per voice by gender; a click picks the voice, ▶ only plays its sample', async () => {
  const { ui, layers, tabs, told, settings, saved } = page({ videoKey: () => 'k1' });
  settings.voice = 'borys';
  ui.openSettings();
  tabs()[1]!.fire('click');
  await settle();
  const body = layers()[0]!.children[1]!;
  assert.deepEqual(texts(body.children).slice(1, 7), ['Чоловічі', 'Борис▶', 'Жіночі', 'Анна● 50%▶', 'Інші', 'Робот▶']);
  const card = (label: string) => body.all('span').find((s) => s.textContent === label)!.parentNode!;
  const chosen = () => ['Борис', 'Анна', 'Робот'].filter((label) => card(label).style.background === 'rgba(255,255,255,.16)');
  assert.deepEqual(chosen(), ['Борис']);
  assert.equal(card('Анна').style.boxShadow, 'inset 0 0 0 1px #4e4'); // already voiced for this video

  const play = card('Анна').all('button')[0]!;
  play.fire('click');
  await settle();
  assert.deepEqual([play.textContent, play.title], ['!', 'Зразок голосу: no sound here']); // a failure is shown
  assert.deepEqual([settings.voice, told], ['borys', []]);

  card('Анна').fire('click');
  assert.deepEqual([settings.voice, saved().voice, told], ['anna', 'anna', ['voices changed']]);
  assert.deepEqual(chosen(), ['Анна']);
  card('Анна').fire('click'); // the chosen one again: nothing to do
  assert.deepEqual(told, ['voices changed']);

  const leads = body.all('select');
  assert.deepEqual(leads.map(options), [[['авто (за правилом сервера)', '', true], ['Борис', 'borys', false]],
    [['авто (за правилом сервера)', '', true], ['Анна ● 50%', 'anna', false]]]);
  leads[1]!.value = 'anna';
  leads[1]!.fire('change');
  assert.deepEqual([settings.leadFemale, saved().leadFemale, told], ['anna', 'anna', ['voices changed', 'voices changed']]);
});

test('the speakers tab: the video\'s speakers; a voice for one goes to the server, then to the session', async () => {
  const { ui, layers, tabs, told, speakers } = page({ videoKey: () => 'k1' });
  speakers.speakers = [
    speaker('S1', { gender: 'male', gender_confidence: 0.93, talk_s: 75, voice: 'borys' }),
    speaker('S2', { gender: 'female', voice: 'anna', manual: true }),
  ];
  ui.openSettings();
  tabs()[2]!.fire('click');
  await settle();
  const cards = layers()[0]!.children[1]!.children[0]!.children;
  assert.deepEqual(texts(cards.map((c) => c.children[0]!)), ['S1 ♂ 93%говорить 1:15▶▶', 'S2 ♀▶▶']);
  const [first, second] = cards.map((c) => c.all('select')[0]!) as [FakeElement, FakeElement];
  assert.deepEqual(options(first).filter((o) => o[2]), [['авто (Борис)', '', true]]);
  assert.deepEqual(options(second).filter((o) => o[2]), [['Анна ● 50%', 'anna', true]]);
  assert.match(cards[0]!.textContent, /Головний мовець: його голос задає «Головний чоловічий голос»/); // lead_male is set
  assert.doesNotMatch(cards[1]!.textContent, /Головний мовець/);

  first.value = 'robot';
  first.fire('change');
  second.value = '';
  second.fire('change');
  await settle();
  assert.deepEqual(told, ['speaker k1 S1 robot', 'speaker k1 S2 null', 'voices changed', 'voices changed']);
});

test('the quick settings open by «tune» over a tall player, else at the page\'s bottom, and close by it', () => {
  let player: FakeElement | null = null;
  let atTop = false;
  const { doc, tune, layers } = page({ site: { getVideo: () => null, getPlayer: () => player as unknown as HTMLElement, panelAtTop: () => atTop } });
  tune.fire('click');
  assert.match(layers()[0]!.style.cssText!, /^position:fixed;bottom:12px;left:12px;right:12px;max-width:420px;margin-left:auto;/);
  assert.equal(layers()[0]!.children.length, 6);
  tune.fire('click');
  assert.equal(layers().length, 0);

  player = Object.assign(doc.createElement('div'), { clientHeight: 400 });
  doc.body.append(player);
  tune.fire('click');
  // never wider than the player
  assert.match(player.children[0]!.style.cssText!, /^position:absolute;bottom:64px;right:12px;width:min\(340px,calc\(100% - 24px\)\);/);
  tune.fire('click');
  assert.equal(player.children.length, 0);

  // a short on a computer: the buttons are at the player's top and YouTube's own things lie over its bottom
  atTop = true;
  tune.fire('click');
  assert.match(player.children[0]!.style.cssText!, /^position:absolute;top:72px;right:12px;width:min\(340px,calc\(100% - 24px\)\);max-height:calc\(100% - 184px\);/);
  tune.fire('click');
  atTop = false;

  player.clientHeight = 200; // a phone's portrait player
  tune.fire('click');
  assert.equal(player.children.length, 0);
  assert.match(doc.body.children.at(-1)!.style.cssText!, /^position:fixed;/);
});

test('the quick settings close on Escape and on a press outside, not on one inside or on «tune»', () => {
  const { doc, main, tune, layers } = page();
  const open = () => layers().length === 1;
  tune.fire('click');
  assert.equal(layers()[0]!.fire('pointerdown').stopped, true); // the player sees no press made in the panel
  tune.fire('pointerdown');
  assert.equal(open(), true);
  main.fire('pointerdown');
  assert.equal(open(), false);

  tune.fire('click');
  assert.equal(doc.body.fire('keydown', { key: 'a' }).stopped, false);
  assert.equal(open(), true);
  assert.equal(doc.body.fire('keydown', { key: 'Escape' }).stopped, true);
  assert.equal(open(), false);
  assert.equal(doc.body.fire('keydown', { key: 'Escape' }).stopped, false); // closed: the page gets its keys again
});

test('the voice row of the quick settings closes them and opens the settings window on «Голоси»', async () => {
  const { tune, layers, tabs } = page();
  tune.fire('click');
  layers()[0]!.children[2]!.fire('click');
  assert.equal(layers().length, 1);
  assert.deepEqual(marked(tabs()), ['Голоси']);
  await settle();
  layers()[0]!.all('button').find((b) => b.title === 'Закрити')!.fire('click');
  assert.equal(layers().length, 0);
});

test('the question about a Ukrainian track: «Озвучити» and «Скасувати» answer it, Escape cancels, one answer each', () => {
  const doc = installDom();
  const question = new DubQuestion();
  const answers: boolean[] = [];
  const ask = () => question.ask((go) => answers.push(go));
  const dialog = () => doc.body.children[0]!;
  assert.equal(question.asked, false);

  ask();
  assert.deepEqual([question.asked, dialog().role, dialog().children[0]!.textContent],
    [true, 'dialog', 'У цього відео вже є українська доріжка від YouTube. Все одно озвучити?']);
  assert.deepEqual(texts(dialog().all('button')), ['Скасувати', 'Озвучити']);
  assert.equal(doc.activeElement!.textContent, 'Озвучити');
  doc.activeElement!.fire('click');
  assert.deepEqual([answers, question.asked, doc.body.children.length], [[true], false, 0]);

  ask();
  dialog().all('button')[0]!.fire('click');
  ask();
  assert.equal(dialog().fire('keydown', { key: ' ' }).stopped, true); // space must not pause the video
  dialog().fire('keydown', { key: 'Escape' });
  assert.deepEqual([answers, doc.body.children.length], [[true, false, false], 0]);

  ask();
  question.drop(); // the page went to another video
  assert.deepEqual([answers, question.asked, doc.body.children.length], [[true, false, false], false, 0]);
});

test('the question about ready voices: a voice is taken or the viewer\'s own asked for; leaving it answers nothing', async () => {
  const doc = installDom();
  const played: string[] = [];
  const question = new ReadyQuestion(async (path) => void played.push(path));
  const answers: string[] = [];
  const offer = { own: 'Тарас — низький спокійний', ready: [
    { voice: 'borys', label: 'Борис', share: 1, sample: '/v1/voices/borys/sample.opus' },
    { voice: 'anna', label: 'Анна', share: 0.874, sample: '/v1/voices/anna/sample.opus' }] };
  const ask = () => question.ask(offer, (voice) => answers.push(voice));
  const dialog = () => doc.body.children[0]!;

  ask();
  assert.deepEqual([question.asked, dialog().role, dialog().children[0]!.textContent], [true, 'dialog', 'Уже озвучено цими голосами:']);
  assert.deepEqual(texts(dialog().all('button')),
    ['Борис · 100 %', '▶', 'Анна · 87 %', '▶', 'Скасувати', 'Озвучити новим: Тарас — низький спокійний']);
  assert.equal(doc.activeElement!.textContent, 'Борис · 100 %'); // the fullest one is a press of Enter away
  dialog().all('button')[3]!.fire('click'); // a sample: the question stays
  await settle();
  assert.deepEqual([played, question.asked], [['/v1/voices/anna/sample.opus'], true]);
  dialog().all('button')[2]!.fire('click');
  assert.deepEqual([answers, question.asked, doc.body.children.length], [['anna'], false, 0]);

  ask();
  dialog().all('button')[5]!.fire('click');
  assert.deepEqual(answers, ['anna', '']);

  ask();
  dialog().all('button')[4]!.fire('click'); // «Скасувати»
  ask();
  assert.equal(dialog().fire('keydown', { key: ' ' }).stopped, true); // space must not pause the video
  dialog().fire('keydown', { key: 'Escape' });
  ask();
  question.drop(); // the page went to another video
  assert.deepEqual([answers, question.asked, doc.body.children.length], [['anna', ''], false, 0]);
});

test('«Діагностика» on «Основні»: «Копіювати журнал» copies the journal and says so; its copy in the console is a setting', async () => {
  const copied: string[] = [];
  let refuse = false;
  const { ui, layers, settings, saved } = page({
    journal: () => 'the journal',
    copy: async (text) => {
      if (refuse) throw new Error('no clipboard');
      copied.push(text);
    },
  });
  ui.openSettings();
  const body = layers()[0]!.children[1]!;
  assert.ok(texts(body.children).includes('Діагностика'));
  const copy = body.all('button').find((b) => b.textContent === 'Копіювати журнал')!;
  copy.fire('click');
  await settle();
  assert.deepEqual([copied, copy.textContent], [['the journal'], 'Скопійовано']);
  refuse = true;
  copy.fire('click');
  await settle();
  assert.deepEqual([copied.length, copy.textContent], [1, 'Не вдалося скопіювати']);

  const label = body.all('label').find((l) => l.textContent === 'Писати журнал у консоль браузера')!;
  const box = label.all('input')[0]!;
  assert.deepEqual([box.type, box.checked], ['checkbox', false]);
  box.checked = true;
  box.fire('change');
  assert.deepEqual([settings.debug, saved().debug], [true, true]);
});

test('a sample plays in place of the one before; stopped while it was on its way, it never starts; no sound is kept running', async () => {
  const contexts = installAudio();
  const waiting: (() => void)[] = [];
  const previews = new Previews({
    api: { bytes: () => new Promise<ArrayBuffer>((give) => waiting.push(() => give(new ArrayBuffer(1000)))) } as unknown as UiHost['api'],
    site: { getVideo: () => null, getPlayer: () => null, panelAtTop: () => false },
    audio: () => (contexts[0] as unknown as AudioContext | undefined) ?? new AudioContext(),
    onOriginal: () => {},
  });
  const first = previews.playClip('/a');
  await settle();
  assert.equal(contexts[0]!.state, 'running');
  const second = previews.playClip('/b'); // another ▶ before the first sample has come
  await settle();
  waiting[0]!();
  waiting[1]!();
  await Promise.all([first, second]);
  assert.equal(contexts[0]!.sources.length, 1); // only the one asked for last

  const third = previews.playClip('/c');
  assert.equal(contexts[0]!.sources[0]!.stopped, 'now');
  await settle();
  previews.stopClip(); // the window closes while the sample is on its way
  waiting[2]!();
  await third;
  assert.deepEqual([contexts[0]!.sources.length, contexts[0]!.state], [1, 'running']); // nothing new was started

  const fourth = previews.playClip('/d');
  await settle();
  waiting[3]!();
  await fourth;
  contexts[0]!.sources[1]!.onended!(); // played to its end
  assert.equal(contexts[0]!.state, 'suspended');
});

test('the question about ready voices silences its sample when it goes', () => {
  installDom();
  let stopped = 0;
  const question = new ReadyQuestion(async () => {}, () => stopped++);
  question.drop();
  assert.equal(stopped, 0); // no question, nothing to silence
  question.ask({ ready: [{ voice: 'anna', label: 'Анна', share: 1, sample: '/s' }], own: 'Борис' }, () => {});
  question.drop();
  assert.equal(stopped, 1);
});

test('a sign-in goes on while another tab of the window is looked at: back on «Основні» its code, its end or its failure is there', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0' });
  let refuse = true;
  const made = host();
  const api = { ...made.h.api, deviceToken: async () => {
    if (refuse) throw new ApiError(400, 'HTTP 400', '{"error":"access_denied"}');
    return { token: 'vxa_new', login: 'user', name: 'Мій телефон' };
  } };
  const { ui, layers, tabs, settings } = page({ api });
  ui.openSettings();
  const layer = layers()[0]!;
  const button = (label: string) => layer.all('button').find((b) => b.textContent === label);
  const status = () => layer.all('div').find((d) => d.dataset.connection !== undefined)!.textContent;
  button('Підключити')!.fire('click');
  await settle();
  tabs()[1]!.fire('click'); // «Голоси», while the site is being asked
  await settle();
  tabs()[0]!.fire('click');
  assert.match(status(), /^Код BCDF-GHJK:/); // the code is still shown
  assert.equal(button('Підключити')!.disabled, true);

  tabs()[1]!.fire('click');
  await vi.advanceTimersByTimeAsync(5000); // refused on the site, while «Голоси» is shown
  tabs()[0]!.fire('click');
  assert.deepEqual([status(), button('Підключити')!.disabled], ['На сайті відмовлено', false]); // said, and it can be tried again

  refuse = false;
  button('Підключити')!.fire('click');
  await settle();
  tabs()[2]!.fire('click');
  await vi.advanceTimersByTimeAsync(5000);
  tabs()[0]!.fire('click');
  assert.deepEqual([settings.token, status()], ['vxa_new', 'Підключено як user · Мій телефон']);
  assert.ok(button('Відключити'));
});

test('a voice for a speaker that the server refuses: the list goes back to the voice before and says why', async () => {
  const made = host();
  let down = true;
  const api = { ...made.h.api, speakerVoice: async (key: string, id: string) => {
    if (down) throw new ApiError(403, 'HTTP 403');
    return speaker(id);
  } };
  const { ui, layers, tabs, told } = page({ videoKey: () => 'k1', api });
  made.speakers.speakers = [speaker('S2', { gender: 'female', voice: 'anna', manual: true })]; // the server api is asked for
  ui.openSettings();
  tabs()[2]!.fire('click');
  await settle();
  const card = layers()[0]!.children[1]!.children[0]!.children[0]!;
  const list = card.all('select')[0]!;
  list.value = 'robot';
  list.fire('change');
  await settle();
  assert.equal(list.value, 'anna');
  assert.match(card.textContent, /Не вдалося змінити голос: HTTP 403/);
  assert.deepEqual(told, []); // the session is told of nothing

  down = false;
  list.value = 'robot';
  list.fire('change');
  await settle();
  assert.equal(list.value, 'robot');
  assert.doesNotMatch(card.textContent, /Не вдалося/);
  assert.deepEqual(told, ['voices changed']);
  down = true;
  list.value = 'borys';
  list.fire('change');
  await settle();
  assert.equal(list.value, 'robot'); // back to the voice the server has, not to the first one
});

test('a speaker\'s own words: the video goes to them and plays, the voice-over is told to stay out, and it stops at their end', () => {
  const doc = installDom();
  const video = Object.assign(doc.createElement('video'), { currentTime: 50, paused: true,
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } });
  const told: string[] = [];
  const previews = new Previews({ api: {} as UiHost['api'], site: { getVideo: () => video as unknown as HTMLVideoElement, getPlayer: () => null, panelAtTop: () => false },
    audio: () => { throw new Error('no sound here'); }, onOriginal: (on) => told.push('original ' + on) });
  previews.playOriginal({ start: 120, end: 125 });
  assert.deepEqual([told, video.currentTime, video.paused], [['original true'], 120, false]);
  video.currentTime = 123;
  video.fire('timeupdate');
  assert.deepEqual([told.length, video.paused], [1, false]);
  video.currentTime = 125.1;
  video.fire('timeupdate');
  assert.deepEqual([told, video.paused], [['original true', 'original false'], true]);
  video.paused = false;
  video.fire('timeupdate'); // the listener is gone: the viewer's own playing is left alone
  assert.equal(video.paused, false);

  previews.playOriginal({ start: 120, end: 125 });
  video.currentTime = 300; // the viewer seeks far away meanwhile: not paused there, the sample is just over
  video.fire('timeupdate');
  assert.deepEqual([told.slice(2), video.paused], [['original true', 'original false'], false]);
  previews.stopOriginal(); // nothing plays: nothing to tell
  assert.equal(told.length, 4);
});

test('the voices are the server\'s answer to a connection: asked once, and again once the script is connected otherwise', async () => {
  const { h, ui, settings, layers, tabs } = page();
  let asked = 0;
  h.api.voices = async () => (++asked === 1 ? VOICES : [voice('olha', 'female', 'Ольга')]);
  assert.deepEqual((await ui.voices()).map((v) => v.id), ['borys', 'anna', 'robot']);
  await ui.voices();
  assert.equal(asked, 1);
  settings.token = 'vxa_other'; // connected in the settings, in another tab, or the token was refused and forgotten
  assert.deepEqual((await ui.voices()).map((v) => v.id), ['olha']);
  await ui.voices();
  assert.equal(asked, 2);
  ui.openSettings();
  tabs()[1]!.fire('click');
  await settle();
  assert.deepEqual(texts(layers()[0]!.all('span')).filter((t) => ['Борис', 'Ольга'].includes(t)), ['Ольга']); // no reload of the page needed
});

test('a failed asking for the voices is not kept; an answer that comes after the connection changed is not either', async () => {
  const { h, ui, settings } = page();
  const answers: ((list: Voice[] | null) => void)[] = [];
  h.api.voices = () => new Promise((done, fail) => answers.push((list) => (list ? done(list) : fail(new Error('lost')))));
  const first = ui.voices();
  settings.token = 'vxa_other';
  const second = ui.voices();
  assert.equal(answers.length, 2);
  answers[0]!(null); // the old connection's asking fails late: the new one's is kept
  await assert.rejects(first, /lost/);
  assert.equal(ui.voices(), second);
  answers[1]!(null);
  await assert.rejects(second, /lost/);
  void ui.voices().catch(() => {});
  assert.equal(answers.length, 3); // asked again
});

/** A player shown full screen: what is outside it is not seen. */
function fullScreen(doc: ReturnType<typeof installDom>): FakeElement {
  const player = doc.createElement('div');
  doc.body.append(player);
  doc.fullscreenElement = player;
  return player;
}

test('a player shown full screen: the questions, the settings window, the quick settings and the toasts go into it', async () => {
  vi.useFakeTimers();
  const { doc, ui, tune, layers } = page();
  const player = fullScreen(doc);
  const question = new DubQuestion();
  question.ask(() => {});
  assert.deepEqual(player.children.map((e) => e.role), ['dialog']);
  question.drop();
  ui.openSettings();
  assert.match(player.children[0]!.textContent, /^VoxArbor UA/);
  // the player takes clicks for pause and full screen: one made in the window is not its business
  assert.deepEqual(['click', 'dblclick', 'pointerdown', 'wheel'].map((type) => player.children[0]!.fire(type).stopped), [true, true, true, true]);
  ui.closeSettings();
  tune.fire('click');
  assert.match(player.children[0]!.style.cssText!, /^position:fixed;bottom:12px/);
  tune.fire('click');
  toast('Відео не знайдено');
  assert.equal(player.children[0]!.textContent, 'VoxArbor UA: Відео не знайдено');
  assert.equal(player.children[0]!.fire('click').stopped, true);
  await vi.advanceTimersByTimeAsync(6000);
  assert.deepEqual([player.children.length, layers().filter((e) => e !== player).length], [0, 0]);
});

test('full screen begins or ends while a window of the script is open: the window follows', async () => {
  const { doc, ui, layers } = page();
  ui.openSettings();
  const win = layers()[0]!;
  const player = fullScreen(doc);
  doc.fire('fullscreenchange');
  assert.equal(win.parentNode, player);
  doc.fullscreenElement = null;
  doc.fire('fullscreenchange');
  assert.equal(win.parentNode, doc.body);
  ui.closeSettings();
  fullScreen(doc);
  doc.fire('fullscreenchange'); // a window that was closed is not brought back
  assert.equal(win.parentNode, null);
});

test('the whole page shown full screen (YouTube on a computer) or a bare <video>: the windows stay in the page', () => {
  const { doc, ui, layers } = page();
  const html = doc.createElement('html');
  html.append(doc.body);
  doc.fullscreenElement = html;
  ui.openSettings();
  assert.equal(layers().length, 1);
  ui.closeSettings();
  const video = doc.createElement('VIDEO'); // an element names its tag in capitals
  doc.body.append(video);
  doc.fullscreenElement = video; // nothing can be put into a <video>
  ui.openSettings();
  assert.deepEqual([video.children.length, layers().filter((e) => e !== video).length], [0, 1]);
});
