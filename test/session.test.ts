import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

import type { Collected } from '../src/adapters/youtube/page';
import { ApiError, type Segment } from '../src/api/client';
import { type SessionHost, VoiceoverSession } from '../src/core/session';
import { DEFAULTS, type Settings } from '../src/settings/store';
import type { ToastAction } from '../src/ui/dom';
import { installAudio } from './fake_audio';
import { FakeElement, installDom } from './fake_dom';

afterEach(() => {
  vi.useRealTimers();
});

const VIDEO_A = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
const VIDEO_B = 'https://www.youtube.com/watch?v=bbbbbbbbbbb';
const OPEN_A = `POST {"url":"${VIDEO_A}","voice":"Speaker_53","lead_male":"","lead_female":"","page_support":true,"switch":false,"from":0}`;

/** A video element as far as the session uses it. As in a browser, play() and pause() act at once and their
 *  events come after the code that called them. */
class FakeVideo extends FakeElement {
  currentTime = 0;
  paused = false;
  seeking = false;
  volume = 1;
  playbackRate = 1;

  play(): Promise<void> {
    this.paused = false;
    queueMicrotask(() => this.fire('play'));
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    queueMicrotask(() => this.fire('pause'));
  }
}

const phrase = (i: number, start: number, end: number, voiced = true): Segment =>
  ({ i, start, end, src: '', uk: '', speaker: null, voice: null, audio: voiced ? `/v1/audio/${i}.opus` : null });
const audioOf = (...phrases: number[]) => phrases.map((i) => `audio /v1/audio/${i}.opus`);
/** A volume to three places: a ramp's last step ends a rounding error away from its target. */
const rounded = (volume: number) => Math.round(volume * 1000) / 1000;

/** A page with a playing video on it and a session for it; the server, the site and the clock are stand-ins that
 *  a test changes as it goes. The server's address is set, the rest of the settings are the defaults but `over`. */
function page(over: Partial<Settings> = {}) {
  vi.useFakeTimers();
  const doc = installDom();
  const contexts = installAudio();
  const frames: (() => void)[] = [];
  Object.assign(globalThis, { requestAnimationFrame: (run: () => void) => frames.push(run) });
  const video = new FakeVideo('video', doc);
  doc.body.append(video);
  const settings: Settings = { ...DEFAULTS, ...over };

  /** What the server has for the video. down: every request fails with it. slow: audio is answered only by
   *  deliver(). holdWindows: the phrases asked for are answered only by deliverWindow(), as they were when asked. lost: audio that cannot be had. clips: the length of a phrase's audio in seconds (2 by default). */
  const server = {
    status: 'ready' as string | null,
    progress: 1,
    error: null as string | null,
    refused: null as string | null,
    voicedUntil: 0,
    pageNeeded: false,
    phrases: [] as Segment[],
    down: null as Error | null,
    slow: false,
    holdWindows: false,
    lost: [] as string[],
    clips: {} as Record<string, number>,
    /** The voice the video is voiced in for everybody; null: as the viewer asked. */
    voice: null as string | null,
    /** The opening is answered with the phrases too (a server of 0.10 on); false: one from before. */
    windows: false,
    /** The openings are answered only by deliverOpen(). */
    slowOpen: false,
  };
  /** reconnected: another tab has connected the script meanwhile (a refused token is no news for the person). */
  const site = { url: VIDEO_A as string | null, video: video as FakeVideo | null, ad: false,
    page: { page: { video_id: 'aaaaaaaaaaa', subs: null, subs_missing: 'no_tracks' } } as Collected, reconnected: false };
  /** The requests made, and what the session told the user, both in order. */
  const asked: string[] = [];
  const told: string[] = [];
  /** What the toasts offered to do. */
  const offers: ToastAction[] = [];
  const undelivered: (() => void)[] = [];
  const heldWindows: (() => void)[] = [];
  const heldOpens: (() => void)[] = [];
  /** The journal's lines. */
  const notes: string[] = [];
  const window = () => ({ status: server.status, progress: server.progress, error: server.error, refused: server.refused,
    voiced_until: server.voicedUntil, page_needed: server.pageNeeded, segments: server.phrases, voice: server.voice });

  const host: SessionHost = {
    settings,
    api: {
      async video(body) {
        asked.push('POST ' + JSON.stringify(body));
        if (server.down) throw server.down;
        if (body.switch || !server.voice) server.voice = body.voice ?? null;
        if (server.slowOpen) await new Promise<void>((go) => heldOpens.push(go));
        return { video_key: 'k1', status: server.status, error: server.error, page_needed: server.pageNeeded,
          duration: null, source_lang: null, refused: server.refused, voice: server.voice,
          ...(server.windows && body.from != null ? { window: window() } : {}) };
      },
      async segments(key, from, paused) {
        asked.push(`GET ${key} from ${from}${paused ? ' paused' : ''}`);
        if (server.down) throw server.down;
        const answer = window();
        if (server.holdWindows) await new Promise<void>((go) => heldWindows.push(go));
        return answer;
      },
      bytes(path) {
        asked.push('audio ' + path);
        return new Promise((resolve, reject) => {
          const answer = (): void => (server.lost.includes(path) ? reject(new ApiError(404, 'HTTP 404'))
            : resolve(new ArrayBuffer(1000 * (server.clips[path] ?? 2))));
          if (server.slow) undelivered.push(answer);
          else answer();
        });
      },
    },
    site: {
      getVideo: () => site.video as unknown as HTMLVideoElement | null,
      getVideoUrl: () => site.url,
      inAd: () => site.ad,
      collectPage: async () => site.page,
    },
    setState: (state, text) => told.push(text ? `${state}: ${text}` : state),
    toast: (message, action) => {
      told.push('toast: ' + message);
      if (action) offers.push(action);
    },
    voiceName: async (id) => 'name of ' + id,
    openSettings: () => told.push('settings'),
    note: (what) => notes.push(what),
    tokenRefused: async () => {
      told.push('token refused');
      return site.reconnected;
    },
  };

  /** Lets time pass: the timers due in it fire, and what waited for an answer or an event goes on. */
  const pass = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);
  /** The next frame of the page, `ms` after the one before, with the video at the time t. */
  const frame = async (t: number, ms = 125): Promise<void> => {
    video.currentTime = t;
    await pass(ms);
    for (const run of frames.splice(0)) run();
    await pass(0);
  };
  /** A slow server answers an audio request (the oldest by default). */
  const deliver = async (index = 0): Promise<void> => {
    undelivered.splice(index, 1)[0]!();
    await pass(0);
  };
  /** A server that holds its answers gives the oldest window asked for. */
  const deliverWindow = async (): Promise<void> => {
    heldWindows.shift()!();
    await pass(0);
  };
  /** A server that holds its openings answers the oldest one. */
  const deliverOpen = async (): Promise<void> => {
    heldOpens.shift()!();
    await pass(0);
  };
  /** The audio context the session made, and what was started through it. */
  const audio = () => contexts[0]!;
  const sounds = () => audio().sources;

  return { session: new VoiceoverSession(host), video, settings, server, site, asked, told, offers, contexts, notes, pass, frame, deliver, deliverWindow, deliverOpen, audio, sounds };
}

test('switching on opens the video on the server and asks for its phrases, then asks as often as its state needs', async () => {
  const p = page();
  Object.assign(p.server, { status: 'translating', progress: 0.4 });
  p.session.start();
  assert.deepEqual([p.session.on, p.session.key, p.told], [true, null, ['busy: Запуск озвучки…']]);
  await p.pass(0);
  assert.deepEqual(p.asked, [OPEN_A, 'GET k1 from 0']);
  assert.deepEqual([p.session.key, p.told.at(-1)], ['k1', 'busy: 40%']); // the tooltip: how much is prepared

  await p.pass(2999);
  assert.equal(p.asked.length, 2);
  await p.pass(1); // not ready: every 3 s
  assert.deepEqual(p.asked.slice(2), ['GET k1 from 0']);

  Object.assign(p.server, { status: 'ready', progress: 1 });
  await p.pass(3000);
  assert.deepEqual([p.asked.length, p.told.at(-1)], [4, 'on: 100%']);

  await p.pass(59_999); // ready, the window reaches far ahead: nothing to ask
  assert.equal(p.asked.length, 4);
  await p.pass(1); // but the server hears of the viewer at least once a minute
  assert.deepEqual(p.asked.slice(4), ['GET k1 from 0']);

  p.video.currentTime = 51; // 100 s before the end of the 150 s fetched: kept so far ahead for a server restart
  await p.pass(3000);
  assert.deepEqual(p.asked.slice(5), ['GET k1 from 51']);
  assert.equal(p.asked.filter((a) => a.startsWith('POST')).length, 1); // the settings went once
});

test('no video on the page: a line for the user and nothing starts', () => {
  const none = page();
  none.site.video = null;
  none.session.start();
  assert.deepEqual([none.told, none.session.on, none.contexts.length], [['toast: Відео не знайдено'], false, 0]);
});

test('the audio of a window is downloaded three phrases at a time, the nearest first, the unvoiced not at all', async () => {
  const p = page();
  p.server.slow = true;
  p.server.phrases = [phrase(3, 31, 33), phrase(0, 1, 3), phrase(1, 11, 13), phrase(5, 51, 53, false), phrase(2, 21, 23), phrase(4, 41, 43)];
  p.video.currentTime = 12; // phrase 0 is over
  p.session.start();
  await p.pass(0);
  assert.deepEqual(p.asked.slice(2), audioOf(1, 2, 3));
  await p.deliver();
  assert.deepEqual(p.asked.filter((a) => a.startsWith('audio')).slice(3), audioOf(4)); // one is in: the next one starts
  await p.deliver();
  await p.deliver();
  await p.deliver();
  await p.pass(60_000);
  assert.deepEqual(p.asked.filter((a) => a.startsWith('audio')), audioOf(1, 2, 3, 4)); // each once
});

test('audio that failed to download is tried again after five seconds', async () => {
  const p = page();
  p.server.phrases = [phrase(0, 1, 3), phrase(1, 11, 13)];
  p.server.lost = ['/v1/audio/1.opus'];
  p.session.start();
  await p.pass(0);
  assert.deepEqual(p.asked.slice(2), audioOf(0, 1));
  await p.pass(4999);
  assert.deepEqual(p.asked.filter((a) => a.startsWith('audio')), audioOf(0, 1));
  await p.pass(1001); // at the poll after the five seconds
  assert.deepEqual(p.asked.filter((a) => a.startsWith('audio')), audioOf(0, 1, 1));
});

test('a phrase is started at its time, once, through its own gain and the voice volume, at the video\'s speed', async () => {
  const p = page({ voiceVolume: 0.5 });
  p.server.phrases = [phrase(0, 1, 3), phrase(1, 5, 7), phrase(2, 9, 11), phrase(3, 13, 15)];
  p.server.lost = ['/v1/audio/2.opus'];
  p.session.start();
  await p.pass(0);
  p.audio().currentTime = 100;

  await p.frame(0.5);
  assert.equal(p.sounds().length, 0);
  await p.frame(0.875); // within 150 ms of its start: scheduled for the exact moment
  assert.equal(p.sounds().length, 1);
  const first = p.sounds()[0]!;
  assert.deepEqual([first.started, first.buffer, first.playbackRate.value], [{ when: 100.125, offset: 0 }, { duration: 2 }, 1]);
  const [own, voice] = first.gains;
  assert.deepEqual([first.gains.length, own!.gain.value, voice!.gain.value, voice!.to], [2, 1, 0.5, p.audio().destination]);
  await p.frame(1);
  await p.frame(1.125);
  assert.equal(p.sounds().length, 1); // not started twice

  p.settings.voiceVolume = 0.25;
  p.session.voiceVolumeChanged();
  assert.equal(voice!.gain.value, 0.25);
  p.video.playbackRate = 2;
  p.video.fire('ratechange');
  assert.equal(first.playbackRate.value, 2); // what sounds follows the video's speed

  await p.frame(5.0625); // a frame a little late: the phrase starts that far into its audio
  const second = p.sounds()[1]!;
  assert.deepEqual([second.started, second.playbackRate.value, second.gains[1]], [{ when: 100, offset: 0.0625 }, 2, voice]);
  await p.frame(9); // its audio never came: the phrase is skipped
  assert.equal(p.sounds().length, 2);
  await p.frame(12.875); // at double speed the wait for the start is half as long
  assert.deepEqual(p.sounds()[2]!.started, { when: 100.0625, offset: 0 });
});

test('a phrase waits for the one before it while its own slot has room; else the one before fades out', async () => {
  const p = page();
  p.server.phrases = [phrase(0, 1, 3), phrase(1, 3, 6), phrase(2, 6, 8), phrase(3, 8, 10), phrase(4, 10, 12)];
  // the first runs half a second over; the second is a second short of its slot; the third runs 0.6 s over,
  // and the fourth has a quarter of a second to spare
  p.server.clips = { '/v1/audio/0.opus': 2.5, '/v1/audio/1.opus': 2, '/v1/audio/2.opus': 2.6, '/v1/audio/3.opus': 1.75, '/v1/audio/4.opus': 4 };
  p.session.start();
  await p.pass(0);
  p.audio().currentTime = 100;

  await p.frame(1);
  await p.frame(3); // the first one sounds until 3.5: the second waits for it and still ends in its slot
  const [first, second] = p.sounds();
  assert.deepEqual(second!.started, { when: 100.5, offset: 0 });
  assert.deepEqual([first!.stopped, second!.stopped], [null, null]);

  await p.frame(6);
  await p.frame(8); // the third sounds until 8.6: the fourth can wait a quarter of a second, the rest is cut
  const [, , third, fourth] = p.sounds();
  assert.deepEqual(fourth!.started, { when: 100.25, offset: 0 });
  assert.equal(third!.stopped, 100.33); // it fades out where the fourth comes in, not before
  assert.deepEqual(third!.gains[0]!.gain.scheduled, ['cancel at 100.25', '1 at 100.25', 'ramp to 0 at 100.33']);

  await p.frame(10); // the fourth ends on time, so the fifth starts on time
  assert.deepEqual(p.sounds()[4]!.started, { when: 100, offset: 0 });
  assert.equal(fourth!.stopped, null);
});

test('the original is turned down from just before a phrase until a little after it, in steps, and back up', async () => {
  const p = page({ duckAlways: false, origVolume: 0.25, waitForVoice: false });
  p.server.phrases = [phrase(0, 10, 12)];
  p.session.start();
  await p.pass(0);
  const heard: number[] = [];
  for (const t of [5, 9.75, 9.875, 10, 12.5, 12.625, 12.75, 13]) {
    await p.frame(t);
    heard.push(p.video.volume);
  }
  assert.deepEqual(heard, [1, 0.625, 0.25, 0.25, 0.25, 0.625, 1, 1]);
  assert.equal(p.sounds().length, 1);
});

test('a volume set by the user becomes the original\'s volume: at once quiet under a phrase, restored at the switching off', async () => {
  const p = page({ duckAlways: false, origVolume: 0.25, waitForVoice: false });
  p.server.phrases = [phrase(0, 10, 12)];
  p.session.start();
  await p.pass(0);
  for (const t of [9.75, 9.875, 10]) await p.frame(t);
  p.video.fire('volumechange'); // the event of our own change
  assert.equal(p.video.volume, 0.25);

  p.video.volume = 0.5;
  p.video.fire('volumechange');
  assert.equal(p.video.volume, 0.125); // a quarter of the new volume, with no ramp
  await p.frame(10.125);
  assert.equal(p.video.volume, 0.125);

  p.session.stop();
  assert.equal(p.video.volume, 0.5);
});

test('with «turn down all the time» the original is quiet from the switching on to the switching off', async () => {
  const p = page();
  p.video.volume = 0.5;
  p.session.start();
  await p.pass(0);
  for (let i = 0; i < 4; i++) await p.frame(i);
  assert.equal(rounded(p.video.volume), 0.05); // a tenth, as the settings have it
  p.session.stop();
  assert.equal(p.video.volume, 0.5);
});

test('«wait for the voice-over»: the video is paused with under a second voiced ahead and goes on with ten', async () => {
  const p = page();
  Object.assign(p.server, { status: 'voicing', progress: 0.2, voicedUntil: 0.5 });
  p.session.start();
  await p.pass(0);
  assert.deepEqual([p.video.paused, p.told.at(-1)], [false, 'busy: 20%']);
  await p.frame(0);
  assert.deepEqual([p.video.paused, p.told.at(-1), p.audio().state], [true, 'busy: Чекаю озвучку…', 'suspended']);

  p.asked.length = 0;
  await p.pass(2875); // the poll that was already waiting
  assert.deepEqual(p.asked, ['GET k1 from 0']); // not «paused»: this viewer wants to watch
  await p.pass(1000); // then every second
  assert.equal(p.asked.length, 2);
  p.server.voicedUntil = 9.5;
  await p.pass(1000);
  assert.deepEqual([p.video.paused, p.told.at(-1)], [true, 'busy: Чекаю озвучку…']);

  p.server.voicedUntil = 10;
  await p.pass(1000);
  assert.equal(p.video.paused, false);
  await p.pass(1); // the video's «play» event, and the poll it asks for
  assert.deepEqual([p.told.at(-1), p.audio().state], ['busy: 20%', 'running']);
  assert.deepEqual(p.asked.slice(3), ['GET k1 from 0', 'GET k1 from 0']); // the one that released, and one at once after it
});

test('a held video goes on when waiting is switched off in the settings', async () => {
  const p = page();
  Object.assign(p.server, { status: 'voicing', progress: 0.2, voicedUntil: 0 });
  p.session.start();
  await p.pass(0);
  await p.frame(0);
  assert.equal(p.video.paused, true);
  p.settings.waitForVoice = false;
  await p.pass(3000);
  assert.equal(p.video.paused, false);
});

test('№15 · після очікування відео проходить пропуск і знову чекає на наступній неозвученій фразі', async () => {
  const p = page();
  Object.assign(p.server, { status: 'voicing', voicedUntil: 0,
    phrases: [phrase(0, 0, 3, false), phrase(1, 3, 13), phrase(2, 13, 20, false)] });
  p.session.start();
  await p.pass(0);
  await p.frame(0);
  assert.equal(p.video.paused, true);
  await p.pass(9000);
  assert.equal(p.video.paused, false);
  for (const t of [0.1, 2, 3]) {
    await p.frame(t);
    assert.equal(p.video.paused, false);
  }
  assert.equal(p.sounds().length, 1);
  await p.frame(13);
  assert.equal(p.video.paused, true);
});

test.each(['перемотування', 'зміна голосу'])('№15 · %s скидає дозвіл пройти пропуск', async (change) => {
  const p = page();
  Object.assign(p.server, { status: 'voicing', voicedUntil: 0, phrases: [phrase(0, 0, 3, false), phrase(1, 3, 13)] });
  p.session.start();
  await p.pass(0);
  await p.frame(0);
  await p.pass(9000);
  assert.equal(p.video.paused, false);
  await p.frame(0.5);
  assert.equal(p.video.paused, false);
  if (change === 'перемотування') {
    p.video.currentTime = 0;
    p.video.fire('seeking');
  } else {
    p.settings.voice = 'anna';
    p.session.voicesChanged();
  }
  await p.frame(p.video.currentTime);
  assert.equal(p.video.paused, true);
});

test('switched on over a paused video, the voice-over starts the video once it is ready', async () => {
  const p = page({ waitForVoice: false });
  p.video.paused = true;
  Object.assign(p.server, { status: 'translating', progress: 0.5 });
  p.session.start();
  assert.deepEqual(p.told, ['busy: Запуск озвучки…', 'busy: Чекаю озвучку…']);
  assert.equal(p.audio().state, 'suspended');
  await p.pass(0);
  assert.deepEqual(p.asked, [OPEN_A, 'GET k1 from 0']); // not «paused»
  assert.deepEqual([p.video.paused, p.told.length], [true, 2]);

  p.server.status = 'ready';
  await p.pass(1000);
  assert.equal(p.video.paused, false);
  await p.pass(1); // the video's «play» event, and the poll it asks for
  assert.deepEqual([p.told.at(-1), p.audio().state], ['on: 100%', 'running']);

  p.video.pause(); // now it is the viewer who pauses: the server may serve others first
  await p.pass(0);
  p.asked.length = 0;
  p.video.currentTime = 100;
  p.video.fire('seeking');
  await p.pass(0);
  assert.deepEqual([p.asked, p.video.paused, p.audio().state], [['GET k1 from 100 paused'], true, 'suspended']);
});

test('another voice or speakers\' mode goes to the server in a new POST and the audio is fetched anew', async () => {
  const p = page();
  p.server.phrases = [phrase(0, 1, 3)];
  p.session.start();
  await p.pass(0);
  assert.deepEqual(p.asked, [OPEN_A, 'GET k1 from 0', ...audioOf(0)]);

  p.asked.length = 0;
  Object.assign(p.settings, { voice: 'anna', mode: 'two', leadFemale: 'anna' });
  p.session.voicesChanged();
  await p.pass(0);
  assert.deepEqual(p.asked, [
    `POST {"url":"${VIDEO_A}","voice":"anna","mode":"two","lead_male":"","lead_female":"anna","page_support":true,"switch":true,"from":0}`,
    'GET k1 from 0', ...audioOf(0)]);

  p.asked.length = 0;
  p.session.voicesChanged(); // one speaker's voice, changed on the server: the settings are the same
  await p.pass(0);
  assert.deepEqual(p.asked, ['GET k1 from 0', ...audioOf(0)]);
});

test('a voice taken for this video alone voices it by itself; a choice in the settings takes over', async () => {
  const p = page({ voice: 'taras', mode: 'two', leadFemale: 'olena' });
  p.session.start('anna');
  await p.pass(0);
  const alone = `POST {"url":"${VIDEO_A}","voice":"anna","mode":"one","lead_male":"","lead_female":"","page_support":true,"switch":true,"from":0}`;
  assert.deepEqual(p.asked, [alone, 'GET k1 from 0']);

  p.session.stop();
  p.asked.length = 0;
  p.session.start('anna'); // what was prepared in that voice is kept for it
  await p.pass(0);
  assert.deepEqual(p.asked, ['GET k1 from 0']);
  p.session.stop();
  p.session.start(); // and not for the voices of the settings
  await p.pass(0);
  const own = `POST {"url":"${VIDEO_A}","voice":"taras","mode":"two","lead_male":"","lead_female":"olena","page_support":true,"switch":false,"from":0}`;
  assert.deepEqual(p.asked.slice(1), [own, 'GET k1 from 0']);

  p.session.stop();
  p.session.start('anna');
  await p.pass(0);
  p.asked.length = 0;
  p.session.voicesChanged(); // the viewer chose in the settings: a switch
  await p.pass(0);
  assert.deepEqual(p.asked, [own.replace('"switch":false', '"switch":true'), 'GET k1 from 0']);
});

test('audio of the voice before, arriving after the change, is not played', async () => {
  const p = page();
  p.server.slow = true;
  p.server.phrases = [phrase(0, 1, 3)];
  p.session.start();
  await p.pass(0);
  p.settings.voice = 'anna';
  p.session.voicesChanged();
  await p.pass(0);
  await p.deliver(); // the old voice's
  await p.frame(1);
  assert.equal(p.sounds().length, 0);
});

test('a change of voices silences at once what the voice before has started or scheduled', async () => {
  const p = page();
  p.server.phrases = [phrase(0, 1, 3), phrase(1, 3.1, 5)];
  p.session.start();
  await p.pass(0);
  await p.frame(1);
  await p.frame(3); // the second one is scheduled ahead of its start
  const old = p.sounds();
  assert.ok(old.length >= 1);
  p.settings.voice = 'anna';
  p.session.voicesChanged();
  assert.ok(old.every((x) => x.stopped), 'the old voice must not go on after the change');
});

test('a phrase whose audio arrives a little after its start is still heard, from where the video is', async () => {
  const p = page({ waitForVoice: false });
  Object.assign(p.server, { slow: true, status: 'voicing' }); // not ready: the video is not held back for its audio
  p.server.phrases = [phrase(0, 0, 3)];
  p.session.start();
  await p.pass(0);
  await p.frame(0.1); // its start: the audio is not here yet
  assert.equal(p.sounds().length, 0);
  await p.deliver();
  await p.frame(0.4); // here now, 400 ms late: started that far into it, not skipped
  assert.equal(p.sounds().length, 1);
  assert.equal(p.sounds()[0]!.started!.offset, 0.4);
});

test('phrases asked for before a change of voices and answered after it are not taken', async () => {
  const p = page();
  Object.assign(p.server, { status: 'voicing', phrases: [phrase(0, 1, 3)] });
  p.session.start();
  await p.pass(0);
  p.server.holdWindows = true;
  await p.pass(3000); // the next asking is under way, with the audio of the voice before
  p.asked.length = 0;
  Object.assign(p.server, { holdWindows: false, phrases: [{ ...phrase(0, 1, 3), audio: '/v1/audio/anna-0.opus' }] });
  p.session.voicesChanged(); // one speaker's voice, changed on the server: the settings are the same
  await p.deliverWindow();
  assert.deepEqual(p.asked, ['GET k1 from 0', 'audio /v1/audio/anna-0.opus']);
});

test('a phrase voiced anew gets its new audio: the one fetched before is dropped', async () => {
  const p = page();
  Object.assign(p.server, { status: 'voicing', phrases: [phrase(0, 5, 7)], clips: { '/v1/audio/0-edited.opus': 4 } });
  p.session.start();
  await p.pass(0);
  p.server.phrases = [{ ...phrase(0, 5, 7), audio: null }]; // its text was edited: the new audio is being made
  await p.pass(3000);
  p.server.phrases = [{ ...phrase(0, 5, 7), audio: '/v1/audio/0-edited.opus' }];
  await p.pass(3000);
  assert.deepEqual(p.asked.filter((a) => a.startsWith('audio')), [...audioOf(0), 'audio /v1/audio/0-edited.opus']);
  await p.frame(5);
  assert.deepEqual(p.sounds().map((s) => s.buffer!.duration), [4]);
});

test.each([false, true])('№23 · пізня відповідь старої доріжки не чіпає нову (помилка: %s)', async (failed) => {
  const p = page({ waitForVoice: false });
  const edited = '/v1/audio/0-edited.opus';
  Object.assign(p.server, { status: 'voicing', slow: true, phrases: [phrase(0, 5, 7)], clips: { [edited]: 4 },
    lost: failed ? ['/v1/audio/0.opus'] : [] });
  p.session.start();
  await p.pass(0);
  p.server.phrases = [{ ...phrase(0, 5, 7), audio: edited }];
  await p.pass(3000);
  assert.deepEqual(p.asked.filter((a) => a.startsWith('audio')), [...audioOf(0), 'audio ' + edited]);
  await p.deliver(1);
  await p.deliver();
  await p.frame(5);
  assert.deepEqual(p.sounds().map((s) => s.buffer!.duration), [4]);
});

test('№23 · нова версія фрази не чекає на повтор невдалого запиту попередньої', async () => {
  const p = page();
  const edited = '/v1/audio/0-edited.opus';
  Object.assign(p.server, { status: 'voicing', phrases: [phrase(0, 5, 7)], lost: ['/v1/audio/0.opus'] });
  p.session.start();
  await p.pass(0);
  p.server.phrases = [{ ...phrase(0, 5, 7), audio: edited }];
  await p.pass(3000);
  assert.deepEqual(p.asked.filter((a) => a.startsWith('audio')), [...audioOf(0), 'audio ' + edited]);
});

test('switching off keeps what was prepared for a minute: on again for the same video and voice asks only for the window', async () => {
  const p = page();
  p.server.phrases = [phrase(0, 1, 3)];
  p.session.start();
  await p.pass(0);
  p.session.stop();
  assert.deepEqual([p.session.on, p.session.key, p.told.at(-1), p.audio().state], [false, null, 'idle', 'suspended']);
  p.asked.length = 0;
  await p.pass(59_000);
  assert.equal(p.asked.length, 0); // off: the server is left alone

  p.session.start();
  await p.pass(0);
  assert.deepEqual([p.asked, p.session.key, p.contexts.length], [['GET k1 from 0'], 'k1', 1]);
  await p.frame(1);
  assert.equal(p.sounds().length, 1); // the audio it had is played

  p.session.stop();
  p.asked.length = 0;
  await p.pass(60_000); // kept no longer than a minute
  p.session.start();
  await p.pass(0);
  assert.deepEqual(p.asked, [OPEN_A.replace('"from":0', '"from":1'), 'GET k1 from 1', ...audioOf(0)]);

  p.session.stop();
  p.asked.length = 0;
  p.settings.voice = 'anna'; // another voice: nothing of the old one is of use
  p.session.start();
  await p.pass(0);
  assert.deepEqual(p.asked.map((a) => a.slice(0, 4)), ['POST', 'GET ', 'audi']);
});

test.each([false, true])('№13 · інший акаунт відкриває те саме відео без старого буфера (сеанс зупинено: %s)', async (stopped) => {
  const p = page({ token: 'account-a' });
  p.server.phrases = [phrase(0, 5, 7)];
  p.session.start();
  await p.pass(0);
  if (stopped) p.session.stop();

  p.settings.token = 'account-b';
  p.asked.length = 0;
  Object.assign(p.server, { slowOpen: true, phrases: [phrase(1, 5, 7)] });
  p.session.start();
  await p.frame(5);
  assert.equal(p.sounds().length, 0);
  assert.deepEqual(p.asked, [OPEN_A.replace('"from":0', '"from":5')]);
  await p.deliverOpen();
  await p.frame(5.1);
  assert.deepEqual(p.asked.slice(1), ['GET k1 from 5', ...audioOf(1)]);
  assert.equal(p.sounds().length, 1);
});

test('the page going to another video is noticed, and switching off stops everything', async () => {
  const p = page();
  p.server.phrases = [phrase(0, 1, 5)];
  p.session.start();
  await p.pass(0);
  for (const t of [0, 0.5, 1]) await p.frame(t);
  assert.deepEqual([p.sounds().length, rounded(p.video.volume), p.session.lostVideo], [1, 0.1, false]);

  p.site.url = VIDEO_B;
  assert.equal(p.session.lostVideo, true);
  p.session.stop();
  assert.deepEqual([p.sounds()[0]!.stopped, p.video.volume, p.told.at(-1), p.session.lostVideo], ['now', 1, 'idle', false]);

  p.asked.length = 0;
  p.video.fire('seeking');
  p.video.fire('play');
  p.video.fire('timeupdate');
  await p.frame(1);
  await p.pass(120_000);
  assert.deepEqual([p.asked, p.sounds().length, p.video.volume, p.told.at(-1)], [[], 1, 1, 'idle']);

  p.session.start(); // what was kept is of the other video
  await p.pass(0);
  assert.equal(p.asked[0], OPEN_A.replace(VIDEO_A, VIDEO_B).replace('"from":0', '"from":1'));
});

test('a video element taken out of the page is a lost video too', async () => {
  const p = page();
  assert.equal(p.session.lostVideo, false); // off: nothing to lose
  p.session.start();
  await p.pass(0);
  p.video.remove();
  assert.equal(p.session.lostVideo, true);
});

test('a seek stops what sounds at once and fetches the window of the new place; phrases there play, also again', async () => {
  const p = page();
  p.server.phrases = [phrase(0, 1, 5), phrase(1, 100, 102)];
  p.session.start();
  await p.pass(0);
  await p.frame(1);
  assert.deepEqual(p.asked.slice(2), audioOf(0, 1));

  p.asked.length = 0;
  p.video.currentTime = 100;
  p.video.seeking = true;
  p.video.fire('seeking');
  await p.pass(0);
  assert.deepEqual([p.sounds()[0]!.stopped, p.asked], ['now', ['GET k1 from 100']]);
  await p.frame(100);
  assert.equal(p.sounds().length, 1); // nothing starts while the video is seeking
  p.video.seeking = false;
  await p.frame(100);
  assert.equal(p.sounds().length, 2);

  p.asked.length = 0;
  p.video.currentTime = 1;
  p.video.fire('seeking');
  await p.pass(0);
  assert.deepEqual(p.asked, ['GET k1 from 1', ...audioOf(0)]); // far behind the other place, its audio was dropped
  await p.frame(1);
  assert.equal(p.sounds().length, 3);
});

test('during an ad nothing sounds, starts or is turned down', async () => {
  const p = page();
  p.server.phrases = [phrase(0, 1, 5), phrase(1, 6, 8)];
  p.session.start();
  await p.pass(0);
  for (const t of [0, 0.5, 1]) await p.frame(t);
  assert.deepEqual([p.sounds().length, rounded(p.video.volume)], [1, 0.1]);

  p.site.ad = true;
  for (const t of [5, 5.5, 6, 6.1]) await p.frame(t); // the ad's own time
  assert.deepEqual([p.sounds()[0]!.stopped, p.sounds().length, p.video.volume], ['now', 1, 1]);
});

test('a refused token switches the voice-over off and shows the settings', async () => {
  const p = page();
  p.server.down = new ApiError(401, 'HTTP 401');
  p.session.start();
  await p.pass(0);
  assert.deepEqual(p.told, ['busy: Запуск озвучки…', 'idle', 'token refused', 'toast: Скрипт не підключено: натисніть «Підключити»', 'settings']);
  await p.pass(60_000);
  assert.deepEqual([p.session.on, p.asked.length], [false, 1]);

  const other = page(); // another tab has connected the script meanwhile: the person is not sent to the settings
  other.server.down = new ApiError(401, 'HTTP 401');
  other.site.reconnected = true;
  other.session.start();
  await other.pass(0);
  assert.deepEqual(other.told, ['busy: Запуск озвучки…', 'idle', 'token refused']);
});

test('a video the server gave up, or a request it refuses, switches the voice-over off with the reason', async () => {
  const failed = page();
  Object.assign(failed.server, { status: 'error', error: 'no subtitles' });
  failed.session.start();
  await failed.pass(0);
  assert.deepEqual(failed.told.slice(1), ['idle', 'error: no subtitles', 'toast: no subtitles']);
  assert.deepEqual([failed.session.on, failed.asked.length], [false, 1]);
  failed.session.start(); // nothing of a failed video is kept
  await failed.pass(0);
  assert.equal(failed.asked[1], OPEN_A);

  const later = page(); // the failure comes with the phrases, and without a reason
  later.session.start();
  await later.pass(0);
  Object.assign(later.server, { status: 'error' });
  later.video.currentTime = 50;
  await later.pass(3000);
  assert.deepEqual(later.told.slice(-3), ['idle', 'error: помилка обробки', 'toast: помилка обробки']);

  const refused = page(); // a refusal: the server's words when it gives them (proposed `message`), else a few here
  refused.server.down = new ApiError(404, 'HTTP 404', '{"detail":"no such video"}');
  refused.session.start();
  await refused.pass(0);
  assert.deepEqual(refused.told.slice(1), ['idle', 'error: Сервер відмовив (HTTP 404)', 'toast: Сервер відмовив (HTTP 404)']);
  const told = page();
  told.server.down = new ApiError(403, 'HTTP 403', JSON.stringify({ detail: 'x', message: '<b>Відео\u202eзакрите</b>\n' + 'я'.repeat(300) }));
  told.session.start();
  await told.pass(0);
  const words = told.told.at(-1)!;
  assert.equal(words.slice(0, 32), 'toast: <b>Відео закрите</b> яяяя'); // plain text: shown as it is, never as markup
  assert.equal(words.length, 'toast: '.length + 200);
});

test('the server\'s words why the voices asked for were not taken are told once; a video kept is not offered to switch', async () => {
  const p = page();
  const opened = (p.session as unknown as { host: SessionHost }).host.api;
  const plain = opened.video.bind(opened);
  opened.video = async (body) => ({ ...(await plain(body)), voice: 'anna', voice_kept: 'Це відео вже озвучене', voice_refused: null });
  p.session.start();
  await p.pass(0);
  await p.pass(3000);
  assert.deepEqual([p.told.filter((t) => t.startsWith('toast:')), p.offers.length], [['toast: Це відео вже озвучене'], 0]);
});

test('a person who may not generate is told why: nothing to read switches the voice-over off, a part to read keeps it on', async () => {
  const why = 'Щоб генерувати нове, підключіть вузол і поділіться ним. Готові переклади доступні й так.';
  const none = page();
  Object.assign(none.server, { status: null, refused: why });
  none.session.start();
  await none.pass(0);
  assert.deepEqual([none.told.slice(1), none.session.on, none.asked.length], [['idle', `error: ${why}`, `toast: ${why}`], false, 1]);

  const some = page({ waitForVoice: false }); // a video somebody else is making: what is ready plays
  Object.assign(some.server, { status: 'voicing', progress: 35, refused: why });
  some.session.start();
  await some.pass(0);
  assert.deepEqual([some.told.at(-1), some.session.on], [`busy: ${why}`, true]);
  some.server.refused = null;
  await some.pass(3000);
  assert.equal(some.told.at(-1), 'busy: 35%');
});

test('a passing problem of the server is shown in place of the percentage; the voice-over stays on', async () => {
  const p = page({ waitForVoice: false });
  Object.assign(p.server, { status: 'voicing', progress: 35, error: 'local-ai: timeout' });
  p.session.start();
  await p.pass(0);
  assert.deepEqual([p.told.at(-1), p.session.on], ['busy: local-ai: timeout', true]);
  p.server.error = null;
  await p.pass(3000);
  assert.equal(p.told.at(-1), 'busy: 35%'); // a progress above 1 is a percentage already
});

test('a server that asks to wait (429, 408) is asked again in ten seconds; the voice-over stays on', async () => {
  for (const status of [429, 408]) {
    const p = page();
    p.server.down = new ApiError(status, 'HTTP ' + status);
    p.session.start();
    await p.pass(0);
    assert.deepEqual([p.told.at(-1), p.session.on], ['offline: Сервер озвучки зайнятий, повторю за 10 с', true]);
    p.server.down = null;
    await p.pass(10_000);
    assert.deepEqual([p.asked, p.told.at(-1)], [[OPEN_A, OPEN_A, 'GET k1 from 0'], 'on: 100%']);
  }
});

test('a server that does not answer: said so, asked again every ten seconds, and the video is not kept waiting', async () => {
  const p = page();
  p.video.paused = true;
  Object.assign(p.server, { status: 'voicing', down: new ApiError(0, 'network error') });
  p.session.start();
  await p.pass(0);
  assert.deepEqual([p.told.at(-1), p.video.paused, p.session.on], ['offline: Сервер озвучки недоступний, повторю за 10 с', false, true]);
  for (let i = 0; i < 4; i++) await p.frame(i);
  assert.equal(p.video.volume, 1); // the original plays at its volume meanwhile

  p.asked.length = 0;
  await p.pass(9000);
  assert.equal(p.asked.length, 0);
  p.server.down = new ApiError(503, 'HTTP 503');
  await p.pass(1000);
  const again = OPEN_A.replace('"from":0', '"from":3'); // the video went on meanwhile
  assert.deepEqual([p.asked, p.told.at(-1)], [[again], 'offline: Сервер озвучки недоступний, повторю за 10 с']);
  Object.assign(p.server, { down: null, status: 'ready' });
  await p.pass(10_000);
  assert.deepEqual([p.asked.slice(1), p.told.at(-1)], [[again, 'GET k1 from 3'], 'on: 100%']);
});

test('page data the server asks for is collected and posted once per switching on, with captions or without', async () => {
  const p = page();
  p.server.pageNeeded = true;
  p.site.page = { page: { video_id: 'aaaaaaaaaaa', subs: 'manual', subs_lang: 'en', json3: { events: [] } }, via: 'player' };
  p.session.start();
  await p.pass(0);
  const data = `POST {"url":"${VIDEO_A}","page_support":true,"page":{"video_id":"aaaaaaaaaaa","subs":"manual","subs_lang":"en","json3":{"events":[]}}}`;
  assert.deepEqual(p.asked, [OPEN_A, 'GET k1 from 0', data]);
  await p.pass(10_000);
  assert.equal(p.asked.filter((a) => a === data).length, 1);
  assert.ok(p.notes.some((n) => /^page: manual captions \(en\) via player, 0 more tracks, \d+ ms$/.test(n)), p.notes.join('\n'));

  // none: the page goes all the same, saying why (the server stops waiting for captions and fetches them itself)
  const bare = page();
  bare.server.pageNeeded = true;
  bare.session.start();
  await bare.pass(0);
  assert.deepEqual(bare.asked, [OPEN_A, 'GET k1 from 0',
    `POST {"url":"${VIDEO_A}","page_support":true,"page":{"video_id":"aaaaaaaaaaa","subs":null,"subs_missing":"no_tracks"}}`]);
  assert.ok(bare.notes.some((n) => /^page: no captions \(no_tracks\), \d+ ms$/.test(n)));
});

test('a video voiced in another voice is heard as it is, and the person is offered to voice it in theirs', async () => {
  const p = page();
  p.server.voice = 'olena'; // somebody voiced it so, for everybody
  p.session.start();
  await p.pass(0);
  assert.equal(p.asked[0], OPEN_A); // opening it switches nothing
  assert.equal(p.server.voice, 'olena');
  assert.deepEqual(p.told.filter((t) => t.startsWith('toast')), ['toast: відео озвучено голосом «name of olena»']);
  await p.pass(5000); // once a run, not at every poll
  assert.equal(p.told.filter((t) => t.startsWith('toast')).length, 1);
  p.asked.length = 0;
  p.offers[0]!.run(); // «Озвучити моїм голосом»
  await p.pass(0);
  assert.equal(p.asked[0], OPEN_A.replace('"switch":false', '"switch":true'));
  assert.equal(p.server.voice, 'Speaker_53');
});

// ---------- the start of a ready video (0.10): phrases with the opening, joined in their middle, a short wait ----------

test('a server that answers the opening with the phrases is not asked for them again', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, phrases: [phrase(0, 5, 8), phrase(1, 70, 72)] });
  p.session.start();
  await p.pass(0);
  assert.deepEqual(p.asked, [OPEN_A, ...audioOf(0, 1)]);
  assert.deepEqual([p.session.key, p.told.at(-1)], ['k1', 'on: 100%']);
  await p.pass(59_000); // ready, the minute that came with the opening reaches far ahead
  assert.deepEqual(p.asked.filter((a) => !a.startsWith('audio')), [OPEN_A]);
  await p.pass(2000); // the server hears of the viewer once a minute, as before
  assert.deepEqual(p.asked.slice(3), ['GET k1 from 0']);

  const voicing = page({ waitForVoice: false });
  Object.assign(voicing.server, { windows: true, status: 'voicing', progress: 0.5 });
  voicing.session.start();
  await voicing.pass(0);
  assert.deepEqual([voicing.asked, voicing.told.at(-1)], [[OPEN_A], 'busy: 50%']);
  await voicing.pass(3001); // not ready: asked every three seconds from then on
  assert.deepEqual(voicing.asked.slice(1), ['GET k1 from 0']);
});

test('a ready video switched on in the middle of a phrase: the phrase is heard from where the video is', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, phrases: [phrase(0, 10, 16), phrase(1, 16, 19)], clips: { '/v1/audio/0.opus': 6 } });
  p.video.currentTime = 12;
  p.session.start();
  await p.pass(0); // the phrases came with the opening, the audio right after
  assert.equal(p.sounds().length, 1);
  assert.deepEqual(p.sounds()[0]!.started, { when: 0, offset: 2 });
  assert.ok(p.notes.some((n) => n.startsWith('phrase 0 [10.00–16.00] sounds from 2.00 s into its 6.00 s')), p.notes.join('\n'));
  p.audio().currentTime = 50;
  await p.frame(12.5);
  assert.equal(p.sounds().length, 1);
  await p.frame(15.875); // the next one starts at its time, the joined one is not started again
  assert.deepEqual([p.sounds().length, p.sounds()[1]!.started], [2, { when: 50.125, offset: 0 }]);
});

test('a phrase with under 0.7 s left to hear is not joined: the next one is waited for', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, phrases: [phrase(0, 10, 13), phrase(1, 13, 16)], clips: { '/v1/audio/0.opus': 3 } });
  p.video.currentTime = 12.5;
  p.session.start();
  await p.pass(0);
  await p.frame(12.5);
  assert.equal(p.sounds().length, 0);
  await p.frame(13);
  assert.deepEqual(p.sounds().map((x) => x.started!.offset), [0]);
});

test('a ready video is held back at the switching on until the audio of the phrase at its place is here', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, slow: true, phrases: [phrase(0, 10, 16), phrase(1, 16, 19)], clips: { '/v1/audio/0.opus': 6 } });
  p.video.currentTime = 12;
  p.session.start();
  await p.pass(0);
  assert.deepEqual([p.video.paused, p.told.at(-1), p.audio().state], [true, 'busy: Готуємо озвучку…', 'suspended']);
  await p.pass(400);
  assert.equal(p.video.paused, true);
  await p.deliver(); // the audio of the phrase at the video's place
  assert.deepEqual([p.video.paused, p.told.at(-1), p.audio().state], [false, 'on: 100%', 'running']);
  assert.deepEqual(p.sounds().map((x) => x.started!.offset), [2]); // and it sounds at once, from where the video stands
  assert.ok(!p.asked.some((a) => a.includes('paused'))); // the viewer waits to watch: the server is not told «paused»
  await p.pass(5000);
  assert.equal(p.video.paused, false); // once a switching on
});

test('the wait for the first audio ends after a second and a half whatever has come; the phrase is joined later', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, slow: true, phrases: [phrase(0, 10, 16)], clips: { '/v1/audio/0.opus': 6 } });
  p.video.currentTime = 12;
  p.session.start();
  await p.pass(0);
  await p.pass(1499);
  assert.equal(p.video.paused, true);
  await p.pass(1);
  assert.deepEqual([p.video.paused, p.told.at(-1)], [false, 'on: 100%']);
  assert.ok(p.notes.includes('prep: the video goes on after 1500 ms: the time is up'), p.notes.join('\n'));
  await p.frame(13);
  assert.equal(p.sounds().length, 0);
  await p.deliver(); // late
  await p.frame(13.5);
  assert.deepEqual(p.sounds().map((x) => x.started!.offset), [3.5]);
});

test('audio that cannot be had ends the wait at once', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, phrases: [phrase(0, 10, 16)], lost: ['/v1/audio/0.opus'] });
  p.video.currentTime = 12;
  p.session.start();
  await p.pass(0);
  assert.equal(p.video.paused, false);
  assert.ok(p.notes.some((n) => n.endsWith('its audio is not coming')), p.notes.join('\n'));
});

test('the video is not held back when nothing is to be waited for: no phrase near, a video not ready, an ad', async () => {
  const far = page();
  Object.assign(far.server, { windows: true, slow: true, phrases: [phrase(0, 14, 16)] });
  far.video.currentTime = 12; // the first phrase is two seconds ahead: its audio comes in time
  far.session.start();
  await far.pass(0);
  assert.deepEqual([far.video.paused, far.told.at(-1)], [false, 'on: 100%']);

  const over = page();
  Object.assign(over.server, { windows: true, slow: true, phrases: [phrase(0, 10, 12.5), phrase(1, 14, 16)] });
  over.video.currentTime = 12; // half a second of the phrase here is left: it would not be joined, so it is not waited for
  over.session.start();
  await over.pass(0);
  assert.equal(over.video.paused, false);

  const voicing = page({ waitForVoice: false });
  Object.assign(voicing.server, { windows: true, slow: true, status: 'voicing', phrases: [phrase(0, 10, 16)] });
  voicing.video.currentTime = 12;
  voicing.session.start();
  await voicing.pass(0);
  assert.equal(voicing.video.paused, false);

  const ad = page();
  Object.assign(ad.server, { windows: true, slow: true, phrases: [phrase(0, 10, 16)] });
  ad.video.currentTime = 12;
  ad.site.ad = true;
  ad.session.start();
  await ad.pass(0);
  assert.equal(ad.video.paused, false);
});

test('switched on over a paused ready video: it starts when the first audio is here, not before', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, slow: true, phrases: [phrase(0, 0, 4)] });
  p.video.paused = true;
  p.session.start();
  await p.pass(0);
  assert.deepEqual([p.video.paused, p.told.at(-1)], [true, 'busy: Готуємо озвучку…']);
  await p.deliver();
  assert.equal(p.video.paused, false);
  assert.deepEqual(p.sounds().map((x) => x.started!.offset), [0]);
});

test('switching off while the video waits for the voice-over lets it go on; one the viewer had paused stays paused', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, slow: true, phrases: [phrase(0, 0, 4)] });
  p.session.start();
  await p.pass(0);
  assert.equal(p.video.paused, true); // held back by us
  p.session.stop();
  assert.equal(p.video.paused, false);
  await p.pass(2000); // the wait's timer is gone with the run
  assert.equal(p.told.at(-1), 'idle');

  const own = page();
  Object.assign(own.server, { windows: true, slow: true, phrases: [phrase(0, 0, 4)] });
  own.video.paused = true;
  own.session.start();
  await own.pass(0);
  own.session.stop();
  assert.equal(own.video.paused, true);

  const gone = page(); // the page went to another video: its player is not ours to start
  Object.assign(gone.server, { windows: true, slow: true, phrases: [phrase(0, 0, 4)] });
  gone.session.start();
  await gone.pass(0);
  gone.site.url = VIDEO_B;
  gone.session.stop();
  assert.equal(gone.video.paused, true);
});

test('switched off while the video is being opened: nothing more is asked or collected for it', async () => {
  const p = page();
  Object.assign(p.server, { slowOpen: true, pageNeeded: true });
  let collected = 0;
  const host = p.session as unknown as { host: { site: { collectPage(): Promise<Collected> } } };
  host.host.site.collectPage = async () => (collected++, p.site.page);
  p.session.start();
  await p.pass(0);
  p.session.stop();
  await p.deliverOpen();
  await p.pass(5000);
  assert.deepEqual([p.asked, collected], [[OPEN_A], 0]);
});

test('switching on while the voice-over is on stops the run before: one run, one set of listeners', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, phrases: [phrase(0, 5, 8)] });
  p.session.start();
  await p.pass(0);
  p.session.start();
  await p.pass(0);
  p.audio().currentTime = 9;
  await p.frame(5);
  assert.equal(p.sounds().length, 1); // not once per run
});

test('a seek into the middle of a phrase: its audio is asked for at once and it is heard from there', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, phrases: [phrase(0, 1, 3), phrase(1, 100, 110)], clips: { '/v1/audio/1.opus': 10 } });
  p.session.start();
  await p.pass(0);
  await p.frame(1);
  // further on: the phrase there is known already (kept 120 s ahead) and its audio is here
  p.server.holdWindows = true;
  p.asked.length = 0;
  p.video.currentTime = 104;
  p.video.seeking = true;
  p.video.fire('seeking');
  await p.pass(0);
  assert.deepEqual(p.asked, ['GET k1 from 104']); // its audio is here already; the window is asked for
  p.video.seeking = false;
  await p.frame(104.25);
  assert.deepEqual(p.sounds().at(-1)!.started!.offset, 4.25); // joined before the window has even come

  // a place whose phrase is known but its audio is not here: asked for with the seek, not after the window
  const q = page();
  Object.assign(q.server, { windows: true, slow: true, phrases: [phrase(0, 1, 3), phrase(1, 20, 30), phrase(2, 40, 50), phrase(3, 60, 70), phrase(4, 80, 90)] });
  q.session.start();
  await q.pass(0); // three at a time: 0, 1, 2 are on their way
  q.server.holdWindows = true;
  q.asked.length = 0;
  q.video.currentTime = 85;
  q.video.fire('seeking');
  assert.equal(q.asked.length, 0); // three are on their way already
  await q.deliver();
  assert.deepEqual(q.asked.filter((a) => a.startsWith('audio')), audioOf(4)); // the one at the new place goes first
});

test('another voice chosen in the middle of a phrase: the phrase goes on in the new voice from where the video is', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, phrases: [phrase(0, 10, 20)], clips: { '/v1/audio/0.opus': 10 } });
  p.video.currentTime = 10;
  p.session.start();
  await p.pass(0);
  await p.frame(10);
  assert.equal(p.sounds().length, 1);
  p.settings.voice = 'anna';
  p.session.voicesChanged();
  assert.equal(p.sounds()[0]!.stopped, 'now');
  await p.pass(0); // opened anew with the new voice: its phrases and their audio come
  assert.equal(p.video.paused, false); // no holding back in the middle of the watching
  await p.frame(13);
  assert.deepEqual([p.sounds().length, p.sounds()[1]!.started!.offset], [2, 3]);
});

test('a video that stalls keeps what sounds waiting with it', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, phrases: [phrase(0, 1, 9)] });
  p.session.start();
  await p.pass(0);
  await p.frame(1);
  p.video.fire('waiting'); // it buffers: not paused, but the picture stands
  await p.pass(0);
  assert.equal(p.audio().state, 'suspended');
  p.video.fire('playing');
  await p.pass(0);
  assert.equal(p.audio().state, 'running');

  p.video.fire('waiting');
  await p.pass(0);
  Object.assign(p.video, { readyState: 4 });
  p.video.fire('timeupdate'); // the time moves again though «playing» never came
  await p.pass(0);
  assert.equal(p.audio().state, 'running');

  p.video.fire('waiting');
  p.video.pause(); // paused while it stalled: «playing» alone does not start the sound
  await p.pass(0);
  p.video.fire('playing');
  await p.pass(0);
  assert.equal(p.audio().state, 'suspended');
});

test('the journal tells the steps of a switching on', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, slow: true, phrases: [phrase(0, 10, 16)], clips: { '/v1/audio/0.opus': 6 } });
  p.video.currentTime = 12;
  p.session.start();
  await p.pass(0);
  await p.pass(250);
  await p.deliver();
  assert.deepEqual(p.notes, [
    `on: ${VIDEO_A} at 12.00, playing, voices Speaker_53|||`,
    'opened: ready, voice Speaker_53',
    'phrases from 12.00: ready, 1 known, 1 voiced, voiced until 0; at the video\'s place: phrase 0 [10.00–16.00]',
    'prep: the video waits for the audio of phrase 0 (it starts at 10.00, the video is at 12.00)',
    'video: pause at 12.00',
    'phrase 0 [10.00–16.00]: 6.00 s of audio here 250 ms after it was asked for',
    'prep: the video goes on after 250 ms: its audio is here',
    'phrase 0 [10.00–16.00] sounds from 2.00 s into its 6.00 s, the video is at 12.00',
    'video: play at 12.00',
  ]);
});

test('while a speaker\'s own words are played from the video, the voice-over stays out: nothing sounds, the original is at its volume, no waiting', async () => {
  const p = page();
  Object.assign(p.server, { windows: true, status: 'voicing', voicedUntil: 60, phrases: [phrase(0, 1, 9), phrase(1, 100, 104), phrase(2, 106, 109)] });
  p.session.start();
  await p.pass(0);
  for (const t of [1, 1.125, 1.25, 1.375]) await p.frame(t);
  assert.deepEqual([p.sounds().length, rounded(p.video.volume)], [1, 0.1]);

  p.session.original(true);
  assert.equal(p.sounds()[0]!.stopped, 'now');
  p.server.voicedUntil = 0; // nothing voiced where the sample is: the video would be held back
  p.video.currentTime = 100;
  p.video.fire('seeking');
  await p.pass(0);
  for (const t of [100, 100.125, 100.25, 100.5, 101]) await p.frame(t);
  assert.deepEqual([p.sounds().length, p.video.volume, p.video.paused], [1, 1, false]);

  p.session.original(false);
  p.server.voicedUntil = 160;
  await p.pass(3000);
  await p.frame(105.875);
  assert.equal(p.sounds().length, 2); // the voice-over is back with the next phrase
  p.session.stop();
  p.session.original(true); // off: nothing to keep out
});

test('a server that goes away while audio is here ahead is asked again quietly; said once the audio runs low', async () => {
  // owner 2026-11-19: a restart of the server must pass unheard; the viewer is told only when it would be heard
  const p = page();
  p.server.phrases = Array.from({ length: 100 }, (_, n) => phrase(n, n * 2, n * 2 + 2));
  p.session.start();
  await p.pass(0);
  for (let i = 0; i < 40; i++) await p.pass(100); // the audio of the window comes
  const shown = p.told.at(-1);
  p.server.down = new ApiError(502, 'HTTP 502');
  p.video.currentTime = 60; // under 100 s of the window left: asked for the next one
  p.asked.length = 0;
  await p.pass(1000);
  assert.deepEqual([p.asked, p.told.at(-1)], [['GET k1 from 60'], shown]);
  assert.ok(p.notes.some((n) => n.startsWith('the server did not answer (HTTP 502): asked again quietly')), p.notes.join('\n'));
  await p.pass(2000); // soon again
  await p.pass(4000);
  assert.deepEqual([p.asked.length, p.told.at(-1)], [3, shown]);
  p.server.down = null;
  await p.pass(8000);
  assert.ok(p.notes.some((n) => n.startsWith('the server answers again after')), p.notes.join('\n'));
  assert.equal(p.told.at(-1), shown);

  p.server.down = new ApiError(0, 'network error');
  p.video.currentTime = 190; // little left here: the viewer would hear it
  await p.pass(3000);
  assert.equal(p.told.at(-1), 'offline: Сервер озвучки недоступний, повторю за 10 с');
});
