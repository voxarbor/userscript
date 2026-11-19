// The voice-over of the page's video. VoiceoverSession switches it on and off and owns what it holds: the audio
// output, the state of the voice-over that is on (Run) and, for a minute after a switching off, what was prepared.
// Three parts work on a run: the poller asks the server, the loader fetches the audio, the playback sounds it.
import type { ToastAction } from '../ui/dom';
import type { SiteAdapter } from '../adapters/types';
import type { Segment, ServerApi, VideoOut } from '../api/client';
import type { Settings } from '../settings/store';
import { Loader } from './loader';
import { Playback } from './playback';
import { modeOf, Poller, voicesOf } from './poller';
import { reusable } from './scheduler';
import type { SessionState } from './types';

const PARK_MS = 60000; // how long a switched-off session (its segments and decoded audio) is kept
const EARLY_MS = 5000; // how long an opening asked for ahead of the switching on (prepare) may be used
const EARLY_NEAR = 5; // s: ... and how far the video may have moved from where it was asked for

/** What the session needs of the rest of the script. */
export interface SessionHost {
  /** The user's settings: one object for the page's life, which the UI changes in place. */
  readonly settings: Settings;
  readonly api: Pick<ServerApi, 'video' | 'segments' | 'bytes'>;
  readonly site: Pick<SiteAdapter, 'getVideo' | 'getVideoUrl' | 'inAd' | 'collectPage'>;
  /** What the voice-over does now, for the switch; text is its tooltip. */
  setState(state: SessionState, text?: string): void;
  /** A line for the user; with an action, a button that does it. */
  toast(message: string, action?: ToastAction): void;
  /** The name of a voice to show, by its id (the id itself when it is not known). */
  voiceName(id: string): Promise<string>;
  /** The connection cannot be used as it is set: the user gets the settings. */
  openSettings(): void;
  /** A line for the diagnostic journal. */
  note(what: string): void;
  /** The server refused the script's token and the voice-over was switched off. -> another tab has connected
   *  the script since, and the voice-over was switched on again with that token: nothing to tell the person */
  tokenRefused(): boolean;
}

/** The video opened on the server ahead of the switching on: asked for at `from` (video seconds) at the time
 *  `at`, for the voices `mode` (voiceMode); its answer comes, or fails, later. */
export interface Early {
  url: string;
  only: string | null;
  mode: string;
  from: number;
  at: number;
  answer: Promise<VideoOut>;
}

/** A phrase that sounds or is scheduled to: its source, its own gain and its place in the video (seconds). */
interface Playing {
  src: AudioBufferSourceNode;
  g: GainNode;
  start: number;
  end: number;
}

/** A voice-over that is on, from the switching on to the switching off: what its parts share. */
export class Run {
  /** Takes the listeners off the video at the switching off. */
  readonly ac = new AbortController();
  /** Switched off: what is still under way (a request, a download, a frame) must leave it alone. */
  stopped = false;

  /** The server's key of the video; null until the server has opened it. */
  key: string | null = null;
  /** The voice settings the server has for this viewer (voiceMode); '' until the video is opened. */
  mode = '';
  status: string | null = null;
  progress: number | null = null;
  error: string | null = null;
  /** Why nothing new is made for this person (they hear what is ready), in the server's words; null: it is. */
  refused: string | null = null;
  /** The voice the video is voiced in on the server, for everybody; null: not told yet. */
  videoVoice: string | null = null;
  /** The person was offered to voice it in theirs (once a run, unless they took the offer). */
  offered = false;
  /** The person asked to voice the video in their voice: the next POST switches it. */
  wantSwitch = false;
  /** The server's end of the unbroken voiced run; null when it belongs to an older position or voice. */
  voicedUntil: number | null = null;
  pageSent = false;
  /** The opening asked for before the run was made; the first poll takes its answer in place of asking. */
  early: Early | null = null;
  /** The last request told the server that the viewer does not watch (paused). */
  toldPaused = false;
  segs = new Map<number, Segment>();
  /** The phrases of segs, sorted by start. */
  list: Segment[] = [];
  /** End of the fetched window; null: fetch it anew. */
  windowEnd: number | null = null;
  /** Grows at every seek: a window fetched for the old position does not count as fetched. */
  gen = 0;
  /** Grows at every change of voices: phrases asked for before it are not taken. */
  voices = 0;
  offline = false;
  lastGet = 0;
  timer: ReturnType<typeof setTimeout> | undefined;
  busy = false;
  again = false;

  /** Decoded audio by phrase; null: loading. */
  bufs = new Map<number, AudioBuffer | null>();
  /** Phrases whose download failed, with the time (ms) it may be tried again. */
  failed = new Map<number, number>();
  loading = 0;

  /** Phrases already started at the current position. */
  done = new Set<number>();
  sources: Playing[] = [];
  /** The original's volume as the user (or the site) set it, and the volume we set last. */
  base: number;
  setVol: number;
  ducked = false;
  /** The video is paused by us until enough is voiced; startHold: it was paused when switched on. */
  held = false;
  startHold = false;
  heldAt = 0;
  /** The first phrases have come and the playback was asked whether to wait for their audio (once a run). */
  prepped = false;
  /** A ready video waits, a moment, for the audio of the phrase i; since: when the wait began (ms). */
  prep: { i: number; since: number } | null = null;
  prepTimer: ReturnType<typeof setTimeout> | undefined;
  /** The video stalls (it buffers): what sounds waits with it. */
  stalled = false;
  /** A speaker's own words are being played from the video: the voice-over stays out of them. */
  original = false;
  lastTick = 0;
  raf = 0;

  /** ctx, gain: the page's audio context and the voice volume on it. only: a voice taken for this video alone
   *  (one the video is ready in), in place of the voices of the settings; null: the settings'. */
  constructor(
    readonly video: HTMLVideoElement,
    readonly url: string,
    readonly ctx: AudioContext,
    readonly gain: GainNode,
    public only: string | null,
  ) {
    this.base = video.volume;
    this.setVol = video.volume;
  }
}

interface Parked {
  url: string;
  voice: string;
  key: string;
  status: string | null;
  progress: number | null;
  segs: Map<number, Segment>;
  list: Segment[];
  bufs: Map<number, AudioBuffer | null>;
  until: number;
}

export class VoiceoverSession {
  private out: { ctx: AudioContext; gain: GainNode } | null = null;
  private run: Run | null = null;
  private parked: Parked | null = null;
  private early: Early | null = null;
  private readonly playback: Playback;
  private readonly loader: Loader;
  private readonly poller: Poller;

  constructor(private readonly host: SessionHost) {
    this.playback = new Playback(host);
    // audio that has come may end a wait for it: with the video paused no frame would notice
    this.loader = new Loader(host.api, (s) => {
      if (s.prep) this.playback.tick(s);
    }, (what) => host.note(what));
    this.poller = new Poller(host, this.loader, this.playback, () => this.stop());
  }

  /** The voice-over is on. */
  get on(): boolean {
    return !!this.run;
  }

  /** The server's key of the video being voiced; null while the voice-over is off or the server has not opened
   *  the video yet. */
  get key(): string | null {
    return (this.run && this.run.key) || null;
  }

  /** The page is no longer on the video being voiced: another address, or the video element left the page. */
  get lostVideo(): boolean {
    const s = this.run;
    return !!s && (this.host.site.getVideoUrl() !== s.url || !s.video.isConnected);
  }

  /** The page's one audio context, made at the first use. */
  audio(): AudioContext {
    return this.output().ctx;
  }

  /** Opens the video on the server now, ahead of the switching on (the viewer may be asked a question first, and
   *  the server is asked what is ready meanwhile): a start() within a few seconds, for the same video and voices,
   *  takes this answer in place of asking again. Nothing sounds and nothing is switched by it. */
  prepare(only: string | null = null): void {
    const { settings: S, site } = this.host;
    const video = site.getVideo();
    const url = site.getVideoUrl();
    if (this.run || !video || !url) return;
    const voices = voicesOf({ only }, S);
    const mode = modeOf(voices);
    if (reusable(this.parked, url, mode, Date.now())) return; // what was prepared for it is still kept
    const { from, answer } = this.poller.open(url, video, voices, !!only, true);
    answer.catch(() => {}); // start() may never come; when it does, its poll hears of the failure
    this.early = { url, only, mode, from, at: Date.now(), answer };
  }

  /** only: a voice for this video alone, in place of the voices of the settings. */
  start(only: string | null = null): void {
    this.stop(); // never two runs at once: the one before would go on sounding with nobody to stop it
    const { settings: S, site } = this.host;
    const early = this.early;
    this.early = null;
    const video = site.getVideo();
    const url = site.getVideoUrl();
    if (!video || !url) return this.host.toast('Відео не знайдено');
    const { ctx, gain } = this.output();
    gain.gain.value = S.voiceVolume;
    if (video.paused) ctx.suspend();
    else ctx.resume();
    const s = (this.run = new Run(video, url, ctx, gain, only));
    const mode = modeOf(voicesOf(s, S));
    if (reusable(this.parked, url, mode, Date.now())) {
      // windowEnd stays null: one segments request refreshes the window, audio already decoded is not fetched again
      const { key, voice, status, progress, segs, list, bufs } = this.parked;
      Object.assign(s, { key, mode: voice, status, progress, segs, list, bufs });
    } else if (early && early.url === url && early.only === only && early.mode === mode &&
      Date.now() - early.at < EARLY_MS && Math.abs(video.currentTime - early.from) < EARLY_NEAR) s.early = early;
    this.parked = null;
    const note = (what: string): void => this.host.note(`video: ${what} at ${video.currentTime.toFixed(2)}`);
    this.host.note(`on: ${url} at ${video.currentTime.toFixed(2)}, ${video.paused ? 'paused' : 'playing'}, voices ${mode}` +
      (s.key ? ', what was prepared before is used' : s.early ? ', opened ahead' : ''));
    const on = (ev: string, fn: () => void): void => video.addEventListener(ev, fn, { signal: s.ac.signal });
    on('play', () => {
      note('play');
      ctx.resume();
      this.playback.loop(s);
      if (s.toldPaused) s.lastGet = 0; // a GET without paused right away: the priority is back before the first phrase
      this.poller.kick(s, 0);
    });
    on('pause', () => {
      note('pause');
      ctx.suspend();
    });
    on('seeking', () => {
      note('seek');
      this.playback.stopSources(s);
      s.done.clear();
      s.windowEnd = null;
      s.voicedUntil = null; // belongs to the old position until the refetch
      s.gen++;
      this.loader.pump(s); // a phrase already known at the new place: its audio is asked for without waiting for the window
      this.poller.kick(s, 0);
    });
    // The video stalls (it buffers) without being paused: what sounds waits with it, else it runs ahead of the picture.
    on('waiting', () => {
      note('stalled');
      s.stalled = true;
      ctx.suspend();
    });
    const goOn = (): void => {
      if (!s.stalled) return;
      s.stalled = false;
      if (!video.paused) ctx.resume();
    };
    on('playing', () => {
      note('playing');
      goOn();
    });
    on('ratechange', () => s.sources.forEach((x) => (x.src.playbackRate.value = video.playbackRate)));
    on('volumechange', () => this.playback.adoptVolume(s));
    on('timeupdate', () => {
      if (video.readyState > 2) goOn(); // the time moves again: should «playing» not come, the voice-over is not left mute
      this.playback.tick(s);
    });
    this.playback.loop(s);
    this.host.setState('busy', 'Запуск озвучки…');
    this.poller.kick(s, 0);
    // UK click on a paused video: start it once the voice is ready (release() calls play()).
    if (video.paused) {
      s.held = s.startHold = true;
      s.heldAt = Date.now();
      this.host.setState('busy', 'Чекаю озвучку…');
    }
  }

  stop(): void {
    const s = this.run;
    if (!s) return;
    const lost = this.lostVideo;
    this.run = null;
    s.stopped = true;
    clearTimeout(s.timer);
    clearTimeout(s.prepTimer);
    s.ac.abort();
    this.playback.stopSources(s);
    s.ctx.suspend(); // no audio thread kept running while the voice-over is off
    if (s.key && s.status !== 'error') {
      const p = (this.parked = { url: s.url, voice: s.mode, key: s.key, status: s.status, progress: s.progress,
        segs: s.segs, list: s.list, bufs: s.bufs, until: Date.now() + PARK_MS });
      // then free the decoded audio
      setTimeout(() => {
        if (this.parked === p) this.parked = null;
      }, PARK_MS);
    }
    s.video.volume = s.base;
    // a video we paused ourselves (it waited for the voice-over) is not left paused; one the viewer had paused, or
    // one the page has left, is not ours to start
    if (s.held && !s.startHold && !lost) s.video.play().catch(() => {});
    this.host.note('off');
    this.host.setState('idle');
  }

  /** A speaker's own words are played from the video (the settings' «Оригінал»), or no longer: meanwhile nothing
   *  sounds or starts, the original is at its own volume and the video is not held back. */
  original(on: boolean): void {
    const s = this.run;
    if (!s) return;
    s.original = on;
    if (on) this.playback.stopSources(s);
    this.host.note(`the original's sample: ${on ? 'on' : 'off'}`);
  }

  /** The voice-over's volume was changed in the settings. */
  voiceVolumeChanged(): void {
    if (this.out) this.out.gain.gain.value = this.host.settings.voiceVolume;
  }

  /** New voice while playing: drop unplayed buffers, re-POST with the voice (poll) and refetch the window. The
   *  viewer chose in the settings, so a voice taken for this video alone no longer holds. */
  voicesChanged(): void {
    const s = this.run;
    if (!s) return;
    s.only = null;
    s.voices++;
    s.voicedUntil = null;
    this.playback.stopSources(s); // the voice before is not heard a moment longer: what sounds or waits to, stops
    s.done.clear();
    s.failed.clear();
    s.bufs = new Map();
    s.segs.clear();
    s.list = [];
    s.windowEnd = null;
    this.poller.kick(s, 0);
  }

  /** The audio context with the voice volume on it. */
  private output(): { ctx: AudioContext; gain: GainNode } {
    if (!this.out) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      this.out = { ctx, gain };
    }
    return this.out;
  }
}
