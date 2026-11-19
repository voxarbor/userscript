// The userscript's entry: picks the site's adapter, puts the settings, the server's API, the voice-over session
// and the UI together, and follows the page (the buttons' place, navigation to another video).
import { adapterFor } from './adapters/registry';
import type { SiteAdapter } from './adapters/types';
import { ServerApi, type Voice } from './api/client';
import { autoLink, onPanel, type LinkBox } from './core/autolink';
import { Journal } from './core/journal';
import { readyOffer } from './core/ready';
import { VoiceoverSession } from './core/session';
import { VERSION } from './meta';
import { scriptManager } from './platform/gm';
import { SERVER, SettingsStore } from './settings/store';
import { toast } from './ui/dom';
import { DubQuestion } from './ui/dub';
import { Previews } from './ui/preview';
import { ReadyQuestion } from './ui/ready';
import { Ui } from './ui/ui';

const DUB_OK_MAX = 300;
const TAKEN_MAX = 300;

const platform = scriptManager;
const store = new SettingsStore(platform);

// The diagnostic journal is always kept (in memory, for «Копіювати журнал»); ?vxdebug=1 in a page's address, or
// the setting, also writes it to the console as it grows (?vxdebug=0 stops that).
const journal = new Journal(Date.now, (line) => {
  if (store.current.debug) console.debug('VoxArbor UA', line);
});
const asked = new URLSearchParams(location.search).get('vxdebug');
if ((asked === '1' || asked === '0') && store.current.debug !== (asked === '1')) {
  store.current.debug = asked === '1';
  store.save();
}

// A slider's changes are written once they settle: write what still waits when the page goes away.
window.addEventListener('pagehide', () => store.flush());

function wire(adapter: SiteAdapter): void {
  const S = store.current; // one object for the page's life: the UI changes it in place
  const server = new ServerApi((request) => platform.request(request), () => ({ server: SERVER, token: S.token }), (line) => journal.mark(line));
  let unmount: (() => void) | null = null; // takes the buttons out of the page

  // the voices once a page (the settings' list): a name to show for an id
  let voicesReq: Promise<Voice[]> | null = null;
  const voiceList = (): Promise<Voice[]> => (voicesReq ??= server.voices().catch((e) => { voicesReq = null; throw e; }));

  // The voice-over on again with the connection as it is now (another token, or none).
  const reconnect = (): void => {
    voicesReq = null; // the voices are the server's answer to that connection
    if (!session.on) return;
    session.stop();
    session.start(kept(adapter.getVideoUrl()) || null);
  };
  // Samples (the settings, the question about ready voices) sound through a context of their own, made at the
  // first one: through the voice-over's, a sample let a phrase frozen by a pause sound on.
  let samplesOut: AudioContext | null = null;
  const samples = (): AudioContext => (samplesOut ??= new AudioContext());

  const session = new VoiceoverSession({
    settings: S,
    api: server,
    site: adapter,
    setState: (state, text) => ui.setState(state, text),
    toast,
    voiceName: async (id: string): Promise<string> => (await voiceList().catch(() => [])).find((v) => v.id === id)?.label || id,
    openSettings: () => ui.openSettings(),
    note: (what) => journal.mark(what),
    tokenRefused() {
      // another tab may have connected the script since this one read its settings: then on again with that token
      if (store.refresh().includes('token') && S.token) {
        journal.mark('the token was refused; another tab has connected the script since: on again with its token');
        voicesReq = null;
        session.start(kept(adapter.getVideoUrl()) || null);
        return true;
      }
      // the token is good no more: forgotten, so that the settings offer «Підключити» (they said «Підключено»)
      if (S.token) {
        S.token = S.account = '';
        store.save();
      }
      return false;
    },
  });

  const ui = new Ui({
    store,
    api: server,
    site: adapter,
    videoKey: () => session.key,
    audio: samples,
    onToggle: () => (session.on ? session.stop() : startChecked()),
    onVoiceVolume: () => session.voiceVolumeChanged(),
    onOriginal: (on) => session.original(on),
    onVoicesChanged() {
      const url = adapter.getVideoUrl();
      if (session.on && url) take(url, ''); // chosen in the settings while it plays: this video is voiced so too
      session.voicesChanged();
    },
    openTab: (url) => platform.openTab(url),
    copy: (text) => platform.copy(text),
    // what the owner is sent: the journal under what it was written by (never the token)
    journal: () => journal.text([
      `VoxArbor UA ${VERSION} · ${new Date().toISOString()}`,
      navigator.userAgent,
      `server ${SERVER} · ${S.token ? 'connected' : 'not connected'} · page ${location.href}`,
      `settings ${JSON.stringify({ ...S, token: undefined, account: undefined })}`,
    ]),
    onConnectionChanged: reconnect,
  });

  // Another tab may have changed the settings, most of all connected the script (the panel's «Скрипт» page does it
  // in a tab of its own): they are taken when this tab is looked at again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const fresh = store.refresh();
    if (fresh.includes('token')) reconnect();
    if (fresh.includes('voiceVolume')) session.voiceVolumeChanged();
  });

  // A video with YouTube's own Ukrainian audio track: ask before voicing it. «Озвучити» is remembered per video id.
  const dubQuestion = new DubQuestion();
  function startChecked(): void {
    if (dubQuestion.asked || readyQuestion.asked) return;
    const url = adapter.getVideoUrl();
    journal.begin(`click: the voice-over on, ${url ?? 'no video here'}`);
    const ok = platform.getValue<string[]>('ukDubOk', []);
    let dub = false;
    try {
      dub = !!(url && adapter.ukrainianDub && !ok.includes(url) && adapter.ukrainianDub());
    } catch (e) {
      console.warn('VoxArbor UA: the check for a Ukrainian track failed', e); // never block the voice-over because of it
    }
    if (!url) return session.start(); // no video here: the session says so
    if (!dub) return void startReady(url); // a track is only looked for on a video's page
    dubQuestion.ask((go) => {
      if (!go || adapter.getVideoUrl() !== url) return;
      // read again: another tab may have added a video while the question stood
      platform.setValue('ukDubOk', platform.getValue<string[]>('ukDubOk', []).filter((u) => u !== url).concat(url).slice(-DUB_OK_MAX));
      void startReady(url);
    });
  }

  // A video that is ready in other voices (owner): offer them before it is voiced anew in the viewer's own. The
  // voice taken holds for this video only and is remembered ('' : «anew in my own»); the settings stay as they are.
  const sample = new Previews({ api: server, site: adapter, audio: samples, onOriginal: () => {} }); // one: a new ▶ stops the sample before
  const readyQuestion = new ReadyQuestion((path) => sample.playClip(path), () => sample.stopClip());
  const taken = (): [string, string][] => platform.getValue<[string, string][]>('videoVoice', []);
  const kept = (url: string | null): string | undefined => taken().find(([u]) => u === url)?.[1];
  const take = (url: string, voice: string): void =>
    platform.setValue('videoVoice', [...taken().filter(([u]) => u !== url), [url, voice]].slice(-TAKEN_MAX));
  let looking: string | null = null; // the video the server is being asked about (what is ready for it)
  let asking = 0; // grows with every such asking and when the page goes to another video: an older answer is dropped
  async function startReady(url: string): Promise<void> {
    if (looking === url) return;
    const before = kept(url);
    const mine = ++asking;
    looking = url;
    ui.setState('busy', 'Запуск озвучки…');
    // the video is opened on the server at once, while the server is asked what is ready (owner: one request after
    // the other made the start slow); the voice-over that starts below takes that answer
    session.prepare(before || null);
    const offer = await readyOffer({ voiced: (u) => server.voiced(u), voices: () => ui.voices() }, url, S, before);
    if (mine !== asking) return; // the page went to another video meanwhile (the button there is not kept busy)
    looking = null;
    if (session.on) return;
    ui.setState('idle');
    if (adapter.getVideoUrl() !== url) return; // the viewer went on meanwhile
    if (!offer.ready.length) return session.start(before || null);
    journal.mark(`ready in other voices (${offer.ready.map((v) => v.voice).join(', ')}): the viewer is asked`);
    readyQuestion.ask(offer, (voice) => {
      if (adapter.getVideoUrl() !== url) return;
      take(url, voice);
      session.start(voice || null);
    });
  }

  // SPA navigation (called by the adapter; watch() also stops a session whose video changed): drop all state.
  let lastUrl = adapter.getVideoUrl();
  function onNavigate(): void {
    const url = adapter.getVideoUrl();
    if (url && url === lastUrl) return; // the same video (a link to another moment of it): nothing to drop
    lastUrl = url;
    journal.mark(`navigation: ${location.href}`);
    asking++;
    looking = null;
    session.stop();
    ui.setState('idle'); // also when nothing was on yet: the button was busy while the server was asked
    dubQuestion.drop(); // the questions were about the previous video
    readyQuestion.drop();
    ui.closeQuick();
    ui.closeSettings(); // the speakers tab belongs to the previous video
    mount();
  }

  function mount(): void {
    if (!adapter.getVideoUrl()) {
      ui.closeQuick();
      if (ui.removeButtons() && unmount) unmount();
      return;
    }
    const buttons = ui.buttons();
    if (buttons.some((b) => !b.isConnected) || (adapter.wantsRemount && adapter.wantsRemount())) {
      unmount = adapter.mountControls(buttons);
    }
  }

  function watch(): void {
    // a page that went to another video without telling (the site's event did not come) is noticed here
    if (adapter.getVideoUrl() !== lastUrl) return onNavigate();
    if (session.lostVideo) session.stop();
    mount();
  }

  platform.menu('VoxArbor UA: налаштування', () => ui.openSettings());
  adapter.onNavigate(onNavigate); // SPA navigation to another video resets the state
  setInterval(watch, 1000);
  watch();
}

if (onPanel(location, SERVER)) {
  const box = document.getElementById('script-link');
  const S = store.current;
  const api = new ServerApi((request) => platform.request(request), () => ({ server: SERVER, token: S.token }));
  if (box) void autoLink(box as unknown as LinkBox, { api, settings: S, saved: () => store.save() });
} else {
  const adapter = adapterFor(location);
  if (adapter) wire(adapter);
}
