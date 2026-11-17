// The userscript's entry: picks the site's adapter, puts the settings, the server's API, the voice-over session
// and the UI together, and follows the page (the buttons' place, navigation to another video).
import { adapterFor } from './adapters/registry';
import type { SiteAdapter } from './adapters/types';
import { ServerApi } from './api/client';
import { autoLink, onPanel, type LinkBox } from './core/autolink';
import { readyOffer } from './core/ready';
import { VoiceoverSession } from './core/session';
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

// A slider's changes are written once they settle: write what still waits when the page goes away.
window.addEventListener('pagehide', () => store.flush());

function wire(adapter: SiteAdapter): void {
  const S = store.current; // one object for the page's life: the UI changes it in place
  const server = new ServerApi((request) => platform.request(request), () => ({ server: SERVER, token: S.token }));
  let unmount: (() => void) | null = null; // takes the buttons out of the page

  const session = new VoiceoverSession({
    settings: S,
    api: server,
    site: adapter,
    setState: (state, text) => ui.setState(state, text),
    toast,
    openSettings: () => ui.openSettings(),
  });

  const ui = new Ui({
    store,
    api: server,
    site: adapter,
    videoKey: () => session.key,
    audio: () => session.audio(),
    onToggle: () => (session.on ? session.stop() : startChecked()),
    onVoiceVolume: () => session.voiceVolumeChanged(),
    onVoicesChanged() {
      const url = adapter.getVideoUrl();
      if (session.on && url) take(url, ''); // chosen in the settings while it plays: this video is voiced so too
      session.voicesChanged();
    },
    openTab: (url) => platform.openTab(url),
    onConnectionChanged() {
      if (session.on) {
        session.stop();
        session.start(kept(adapter.getVideoUrl()) || null);
      }
    },
  });

  // A video with YouTube's own Ukrainian audio track: ask before voicing it. «Озвучити» is remembered per video id.
  const dubQuestion = new DubQuestion();
  function startChecked(): void {
    if (dubQuestion.asked || readyQuestion.asked) return;
    const url = adapter.getVideoUrl();
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
      platform.setValue('ukDubOk', ok.concat(url).slice(-DUB_OK_MAX));
      void startReady(url);
    });
  }

  // A video that is ready in other voices (owner): offer them before it is voiced anew in the viewer's own. The
  // voice taken holds for this video only and is remembered ('' : «anew in my own»); the settings stay as they are.
  const readyQuestion = new ReadyQuestion((path) => new Previews({ api: server, site: adapter, audio: () => session.audio() }).playClip(path));
  const taken = (): [string, string][] => platform.getValue<[string, string][]>('videoVoice', []);
  const kept = (url: string | null): string | undefined => taken().find(([u]) => u === url)?.[1];
  const take = (url: string, voice: string): void =>
    platform.setValue('videoVoice', [...taken().filter(([u]) => u !== url), [url, voice]].slice(-TAKEN_MAX));
  let looking = false; // the server is being asked what is ready
  async function startReady(url: string): Promise<void> {
    if (looking) return;
    const before = kept(url);
    looking = true;
    ui.setState('busy', 'Запуск озвучки…');
    const offer = await readyOffer({ voiced: (u) => server.voiced(u), voices: () => ui.voices() }, url, S, before);
    looking = false;
    if (session.on) return;
    ui.setState('idle');
    if (adapter.getVideoUrl() !== url) return; // the viewer went on meanwhile
    if (!offer.ready.length) return session.start(before || null);
    readyQuestion.ask(offer, (voice) => {
      if (adapter.getVideoUrl() !== url) return;
      take(url, voice);
      session.start(voice || null);
    });
  }

  // SPA navigation (called by the adapter; watch() also stops a session whose video changed): drop all state.
  function onNavigate(): void {
    session.stop();
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
