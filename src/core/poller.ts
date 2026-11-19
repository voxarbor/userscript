// The talk with the server: the video is opened (and its voice settings sent) with a POST, then the phrases of
// the window ahead are fetched again and again, as often as the video's state asks for.
import type { SegmentsOut, VideoIn, VideoOut } from '../api/client';
import type { Settings } from '../settings/store';
import type { Loader } from './loader';
import type { Playback } from './playback';
import { needFetch, outOfReach, preparedPercent, voiceMode, windowIncomplete } from './scheduler';
import type { Run, SessionHost } from './session';

const POLL_MS = 3000; // while the video is not ready
const IDLE_MS = 1000; // when ready: only check the window edge
const HEARTBEAT_MS = 60000; // a segments GET at least once a minute (owner): the server's idle cut is longer than that
const RETRY_MS = 10000; // server unreachable
const HELD_POLL_MS = 1000; // while the video waits for the voice-over: release it as soon as enough is voiced

/** Who voices a video: the voice, how the speakers are voiced and the lead voices. */
type Voices = Pick<Settings, 'voice' | 'mode' | 'leadMale' | 'leadFemale'>;

/** Who voices the run: the voice taken for this video alone, by itself, else the settings. */
export const voicesOf = (s: Pick<Run, 'only'>, S: Settings): Voices =>
  (s.only ? { voice: s.only, mode: 'one', leadMale: '', leadFemale: '' } : S);

/** The voices as the audio depends on them (voiceMode). */
export const modeOf = (v: Voices): string => voiceMode(v.voice, v.mode, v.leadMale, v.leadFemale);

/** Where the video is, as the server is told: seconds, to a hundredth. */
const place = (video: HTMLVideoElement): number => Math.round(Math.max(0, video.currentTime) * 100) / 100;

/** The server gave the video up: asking again would not help. */
const fatal = (message: string | null): Error => Object.assign(new Error(message || 'помилка обробки'), { fatal: true });

export class Poller {
  /** stop(): switches the voice-over off (a refused token, a video the server gave up). */
  constructor(
    private readonly host: SessionHost,
    private readonly loader: Loader,
    private readonly playback: Playback,
    private readonly stop: () => void,
  ) {}

  /** The next poll in delay ms, in place of the one that waits; during a poll: right after it. */
  kick(s: Run, delay: number): void {
    if (s.stopped) return;
    clearTimeout(s.timer);
    if (s.busy) s.again = true;
    else s.timer = setTimeout(() => this.poll(s), delay);
  }

  /** Opens the video on the server for this viewer, at the place the video is at; change: the voices are switched
   *  for everybody. held: the viewer waits to watch, though the video is paused. -> the place asked for and the
   *  answer, which carries the phrases from that place when the server knows how (window). */
  open(url: string, video: HTMLVideoElement, voices: Voices, change: boolean, held: boolean): { from: number; answer: Promise<VideoOut> } {
    const from = place(video);
    const body: VideoIn = { url, voice: voices.voice, ...(voices.mode ? { mode: voices.mode } : {}),
      lead_male: voices.leadMale || '', lead_female: voices.leadFemale || '', page_support: true, switch: change, from,
      ...(video.paused && !held ? { paused: true } : {}) };
    return { from, answer: this.host.api.video(body) };
  }

  private async poll(s: Run): Promise<void> {
    if (s.stopped) return;
    const { settings: S, api } = this.host;
    s.busy = true;
    let delay = s.held ? HELD_POLL_MS : POLL_MS; // paused there is no frame loop, poll() releases the hold
    try {
      // Voice settings go to the server only in a POST when they change (not with every segments GET), so two
      // devices on one video don't keep switching it back and forth. Opening a video switches nothing (switch:
      // false): a video already voiced keeps its voice for everybody, and the person is offered to voice it in
      // theirs; a change in the settings during the run, a voice taken for this video, or that offer switch it.
      const voices = voicesOf(s, S);
      const mode = modeOf(voices);
      let got = false; // the phrases came with the opening
      if (!s.key || s.mode !== mode || s.wantSwitch) {
        const change = !!s.key || !!s.only || s.wantSwitch;
        // asked ahead of the switching on (VoiceoverSession.prepare), for these very voices: not asked again
        const early = s.early && !s.key && !s.wantSwitch && s.early.mode === mode ? s.early : null;
        s.early = null;
        const gen = early ? 0 : s.gen;
        const round = s.voices;
        s.toldPaused = !early && s.video.paused && !s.held;
        const { from, answer } = early || this.open(s.url, s.video, voices, change, s.held);
        const r = await answer;
        if (s.stopped) return; // switched off meanwhile: nothing more is asked or collected for it
        s.wantSwitch = false;
        s.videoVoice = r.voice ?? null;
        if (r.page_needed) this.sendPage(s);
        s.mode = mode;
        s.key = r.video_key;
        s.status = r.status;
        s.refused = r.refused ?? null;
        this.host.note(`opened: ${r.status ?? 'nothing to read'}, voice ${r.voice ?? '—'}` + (r.refused ? `, refused: ${r.refused}` : '') +
          (r.window ? '' : ', no phrases with it (a server before 0.10): they are asked for'));
        if (r.status === 'error') throw fatal(r.error);
        if (r.status === null && s.refused) throw fatal(s.refused); // nothing to read, and nothing is made for them
        this.offer(s);
        // the voices changed meanwhile: these phrases are the old ones', the next poll opens the video anew
        if (r.window && round === s.voices && mode === modeOf(voicesOf(s, S))) {
          s.lastGet = Date.now();
          this.take(s, r.window, from, gen);
          got = true;
        }
      }
      const t = s.video.currentTime;
      if (got) delay = s.status === 'ready' || s.held ? IDLE_MS : POLL_MS;
      else if (s.status !== 'ready' || needFetch(t, s.windowEnd) || windowIncomplete(s.list, t, s.windowEnd || 0) ||
        Date.now() - s.lastGet >= HEARTBEAT_MS) await this.fetchWindow(s, s.key);
      else delay = IDLE_MS;
      if (s.status === 'error') throw fatal(s.error);
      s.offline = false;
      if (!s.stopped && !s.held) {
        // owner: the tooltip shows just how much of the video is prepared
        const pct = preparedPercent(s.status, s.progress);
        this.host.setState(s.status === 'ready' ? 'on' : 'busy', s.error || s.refused || pct + '%');
      }
    } catch (thrown) {
      const e = thrown as Error & { status?: number; fatal?: boolean };
      s.busy = false;
      if (s.stopped) return;
      if (e.status === 401) {
        this.stop();
        if (this.host.tokenRefused()) return;
        this.host.toast('Скрипт не підключено: натисніть «Підключити»');
        return this.host.openSettings();
      }
      const wait = e.status === 429 || e.status === 408; // the server (or a proxy before it) asks to come later
      if (e.fatal || (!wait && e.status !== undefined && e.status >= 400 && e.status < 500)) {
        this.stop();
        this.host.setState('error', e.message);
        return this.host.toast(e.message);
      }
      s.offline = true;
      this.playback.release(s);
      this.host.setState('offline', `Сервер озвучки ${wait ? 'зайнятий' : 'недоступний'}, повторю за 10 с`);
      delay = RETRY_MS;
    }
    s.busy = false;
    if (s.stopped) return;
    this.loader.pump(s);
    if (s.video.paused) this.playback.tick(s); // no frame loop while paused: keep the volume and the waitForVoice release current
    this.kick(s, s.again ? 0 : delay);
    s.again = false;
  }

  private async fetchWindow(s: Run, key: string): Promise<void> {
    const from = place(s.video);
    const gen = s.gen;
    const voices = s.voices;
    const mode = s.mode;
    s.lastGet = Date.now();
    // paused: the server keeps preparing ahead but gives the video no viewer priority (held = a viewer who wants to start)
    const paused = (s.toldPaused = s.video.paused && !s.held);
    const r = await this.host.api.segments(key, from, paused);
    // the voices changed meanwhile (the settings, or one speaker's voice on the server): the next poll refetches
    if (s.stopped || voices !== s.voices || mode !== modeOf(voicesOf(s, this.host.settings))) return;
    this.take(s, r, from, gen);
  }

  /** The phrases of the window asked for at `from`, in the seek generation `gen`, become the run's. */
  private take(s: Run, r: SegmentsOut, from: number, gen: number): void {
    const before = `${s.status}/${s.list.length}/${s.list.filter((x) => x.audio).length}`;
    s.status = r.status;
    s.progress = r.progress;
    s.error = r.error; // with a non-error status: a transient local-ai problem, shown but not fatal
    s.refused = r.refused ?? null;
    s.videoVoice = r.voice ?? s.videoVoice;
    this.offer(s);
    s.voicedUntil = r.voiced_until;
    if (r.page_needed) this.sendPage(s);
    for (const seg of r.segments || []) {
      const had = s.segs.get(seg.i);
      // voiced anew (an edited text, another voice): the audio fetched before is not this phrase's any more
      if (had && had.audio && seg.audio && had.audio !== seg.audio) s.bufs.delete(seg.i);
      // while the new audio is being made the phrase keeps the one it had: better than silence
      s.segs.set(seg.i, seg.audio || !had ? seg : { ...seg, audio: had.audio });
    }
    for (const [i, seg] of s.segs) {
      if (outOfReach(seg, from)) {
        s.segs.delete(i);
        s.bufs.delete(i);
      }
    }
    s.list = [...s.segs.values()].sort((a, b) => a.start - b.start);
    if (gen === s.gen) s.windowEnd = from + 60;
    const now = `${s.status}/${s.list.length}/${s.list.filter((x) => x.audio).length}`;
    if (now !== before) { // a poll that brings nothing new is not written down
      const at = s.list.find((x) => x.end > s.video.currentTime);
      this.host.note(`phrases from ${from.toFixed(2)}: ${s.status}, ${s.list.length} known, ${s.list.filter((x) => x.audio).length} voiced, ` +
        `voiced until ${r.voiced_until}` + (at ? `; at the video's place: phrase ${at.i} [${at.start.toFixed(2)}–${at.end.toFixed(2)}]${at.audio ? '' : ' (not voiced)'}` : ''));
    }
    this.loader.pump(s);
    this.playback.prepare(s);
  }

  /** The video is voiced in another voice than the person's (someone chose it, for everybody): they hear it as
   *  it is and are offered, once a run, to voice it in theirs (a switch, for everybody). */
  private offer(s: Run): void {
    const want = voicesOf(s, this.host.settings).voice;
    const now = s.videoVoice;
    if (s.offered || !now || !want || now === want || s.refused || s.stopped) return;
    s.offered = true;
    void this.host.voiceName(now).then((name) => {
      if (s.stopped) return;
      this.host.toast(`відео озвучено голосом «${name}»`, {
        label: 'Озвучити моїм голосом',
        run: () => {
          s.wantSwitch = true;
          s.offered = false;
          this.kick(s, 0);
        },
      });
    });
  }

  /** The server asks for page data (page_needed) when it hasn't the video's subtitles yet: collect them from the
   *  YouTube page once per session and post them; it waits ~20 s for them before fetching YouTube itself. */
  private async sendPage(s: Run): Promise<void> {
    const site = this.host.site;
    if (s.pageSent || s.stopped || !site.collectPage) return;
    s.pageSent = true;
    try {
      const page = await site.collectPage();
      if (page && page.subs && !s.stopped) await this.host.api.video({ url: s.url, page_support: true, page });
    } catch (e) {
      console.warn('VoxArbor UA: the page data was not sent', e); // the server falls back to fetching YouTube itself
    }
  }
}
