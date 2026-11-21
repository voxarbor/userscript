// A stand-in YouTube for the browser tests: www.youtube.com and m.youtube.com are answered here (Playwright routes,
// nothing goes out), with pages built like YouTube's (the player's markup as recorded on 2026-11-21: e2e/README.md),
// a player object with the API the script uses, and timedtext that answers only the player's own request (pot), as
// YouTube does. The video is a silent WAV: a <video> plays it, seeks in it and changes its speed like a real one.
import { readFileSync } from 'node:fs';

import type { BrowserContext } from '@playwright/test';

import { wav } from './server';

export type FixtureName = 'manual' | 'auto' | 'none' | 'live' | 'short';

/** The recorded player responses (e2e/fixtures/videos.json). */
export const VIDEOS = JSON.parse(readFileSync(new URL('./fixtures/videos.json', import.meta.url), 'utf8')) as
  Record<FixtureName, { path: string; player: { videoDetails: { videoId: string } } }>;

/** How the fake player behaves on a page. */
export interface PlayerOptions {
  /** ms from captions switched on to the player's own timedtext request. */
  askDelay?: number;
  /** The player object has no API but getPlayerResponse (an older or stripped player). */
  noApi?: boolean;
  /** The viewer had captions on. */
  captionsOn?: boolean;
  /** timedtext answers a track's own address (no pot) too. */
  baseUrlWorks?: boolean;
  /** Captions switched off soon after they were switched on come on again once the player has loaded them (seen
   *  on youtube.com). */
  lateOn?: boolean;
}

const MEDIA = wav(300, 0);

/** Made-up lines of a caption track in json3, as timedtext gives them. */
function json3(lang: string): string {
  const events = Array.from({ length: 12 }, (_, k) => ({ tStartMs: 1000 + 4000 * k, dDurationMs: 2500, segs: [{ utf8: `${lang} line ${k}` }] }));
  return JSON.stringify({ wireMagic: 'pb3', pens: [{}], wsWinStyles: [{}], wpWinPositions: [{}], events });
}

function page(name: FixtureName, mobile: boolean, opts: PlayerOptions): string {
  const fx = VIDEOS[name];
  const shorts = fx.path.startsWith('/shorts/');
  const video = '<div class="html5-video-container" data-layer="0"><video tabindex="-1" class="video-stream html5-main-video" ' +
    'src="/e2e/media.wav" muted autoplay playsinline></video></div>';
  let body: string;
  if (mobile) {
    const player = `<div id="player" class="player-api player-size"><div class="html5-video-player ytp-mweb-player playing-mode" id="movie_player">${video}</div></div>`;
    body = `<ytm-app><div id="player-container-id" class="player-container">` +
      (shorts ? `<shorts-video id="shorts-video"><player-component>${player}</player-component></shorts-video>` : player) +
      `<div id="player-control-container"><ytm-custom-control><ytm-watch-player-controls>` +
      (shorts ? '' : '<div class="player-controls-top"><button class="yt-cc">CC</button></div>') +
      `</ytm-watch-player-controls></ytm-custom-control></div></div></ytm-app>`;
  } else if (shorts) {
    // a short on a computer: its own player; #movie_player keeps the video watched before, hidden
    body = `<ytd-app><div id="hidden" hidden><div class="html5-video-player" id="movie_player"><div class="html5-video-container"><video></video></div></div></div>` +
      `<ytd-shorts><ytd-reel-video-renderer><div id="player-container"><ytd-player id="player"><div class="html5-video-player" id="shorts-player">${video}</div></ytd-player></div>` +
      `<div class="player-controls"><ytd-shorts-player-controls><div id="left-controls"></div><div id="right-controls"><div id="closed-captioning-button-container"></div></div></ytd-shorts-player-controls></div>` +
      `</ytd-reel-video-renderer></ytd-shorts></ytd-app>`;
  } else {
    body = `<ytd-app><ytd-watch-flexy><div id="player"><div id="player-container"><div class="html5-video-player ytp-transparent playing-mode" id="movie_player">${video}` +
      `<div class="ytp-chrome-bottom"><div class="ytp-chrome-controls"><div class="ytp-left-controls"></div><div class="ytp-right-controls">` +
      `<button class="ytp-subtitles-button ytp-button" aria-pressed="false" aria-label="Subtitles/closed captions (c)"></button>` +
      `<button class="ytp-fullscreen-button ytp-button"></button></div></div></div></div></div></div></ytd-watch-flexy></ytd-app>`;
  }
  const config = { ...opts, name, mobile, shorts, player: fx.player, previous: { videoDetails: { videoId: 'previous000' } } };
  const css = '#movie_player,#shorts-player{position:relative;width:640px;max-width:100vw;height:360px;background:#000}' +
    '.player-controls-top,#right-controls{display:flex;min-height:48px}video{width:100%;height:100%}body{margin:0;background:#0f0f0f;color:#fff}';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${name}</title><style>${css}</style></head><body>${body}` +
    `<script>window.__fx = ${JSON.stringify(config)};</script><script>(${fakePlayer.toString()})();</script></body></html>`;
}

/** The player object of the page, made in the page's own world (#movie_player, or #shorts-player of a short on a
 *  computer): the API seen on www and m.youtube.com in 2026-11, and a captions state that asks timedtext for the
 *  track when it is switched on, a while later (askDelay), with the player's token. */
function fakePlayer(): void {
  type Track = { languageCode?: string; kind?: string };
  const w = window as unknown as Record<string, unknown> & { __fx: Record<string, unknown> & { player: { videoDetails: { videoId: string };
    captions?: { playerCaptionsTracklistRenderer: { captionTracks: (Track & { baseUrl: string })[] } } } } };
  const fx = w.__fx;
  const shown: string[] = (w.__fxCaptions = []) as string[];
  const clicks = { cc: 0 };
  w.__fxClicks = clicks;
  const tracks = (fx.player.captions && fx.player.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
  if (!fx.mobile) for (const t of tracks) t.baseUrl = location.origin + t.baseUrl; // m.youtube.com's are relative
  const el = document.getElementById(fx.shorts && !fx.mobile ? 'shorts-player' : 'movie_player') as HTMLElement & Record<string, unknown>;
  const btn = fx.mobile ? null : document.querySelector('#movie_player .ytp-subtitles-button');
  let track: Track = fx.captionsOn && tracks[0] ? { languageCode: tracks[0].languageCode, kind: tracks[0].kind || '' } : {};
  const ask = (t: Track): void => {
    setTimeout(() => {
      const q = `v=${fx.player.videoDetails.videoId}&caps=asr&xoaf=5&hl=en&lang=${t.languageCode}${t.kind ? '&kind=' + t.kind : ''}` +
        `&fmt=json3&xorb=2&c=${fx.mobile ? 'MWEB' : 'WEB'}&pot=e2e-player-token`;
      void fetch('/api/timedtext?' + q, { credentials: 'include' });
    }, Number(fx.askDelay ?? 300));
  };
  let loading: ReturnType<typeof setTimeout> | undefined;
  const set = (t: Track | null | undefined): void => {
    const was = track;
    track = t && t.languageCode && tracks.length ? { languageCode: t.languageCode, kind: t.kind || '' } : {};
    if (fx.lateOn && was.languageCode && !track.languageCode && loading === undefined) loading = setTimeout(() => set(was), 700);
    shown.push(track.languageCode ? track.languageCode + (track.kind ? ':' + track.kind : '') : 'off');
    if (btn) btn.setAttribute('aria-pressed', String(!!track.languageCode));
    if (track.languageCode) ask(track);
  };
  if (track.languageCode) ask(track);
  el.getPlayerResponse = () => fx.player;
  if (!fx.noApi) {
    Object.assign(el, {
      isSubtitlesOn: () => !!track.languageCode,
      getOption: (m: string, o: string) => (m === 'captions' && o === 'track' ? { ...track } : undefined),
      setOption: (m: string, o: string, v: Track) => (m === 'captions' && o === 'track' ? set(v) : undefined),
      toggleSubtitles: () => set(track.languageCode ? {} : tracks[0]),
      toggleSubtitlesOn: () => (fx.mobile ? undefined : set(tracks[0])), // m.youtube.com's did nothing for an asr track
      loadModule: () => {},
      unloadModule: (m: string) => (m === 'captions' ? set({}) : undefined),
    });
  }
  if (btn) {
    btn.addEventListener('click', () => {
      clicks.cc++;
      set(track.languageCode ? {} : tracks[0]);
    });
  }
  if (fx.shorts && !fx.mobile) {
    const before = document.getElementById('movie_player') as HTMLElement & Record<string, unknown>;
    before.getPlayerResponse = () => fx.previous;
  }
}

/** Serves YouTube in the context: the fixture `name` at its address on www (computer) or m. (phone). */
export async function serveYouTube(context: BrowserContext, mobile: boolean, pick: () => { name: FixtureName; opts: PlayerOptions }): Promise<void> {
  await context.route(/^https:\/\/(www|m)\.youtube\.com\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/e2e/media.wav') {
      // ranges, as a media server answers them: without them the video cannot seek
      const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
      const from = range ? Number(range[1]) : 0;
      const to = range && range[2] ? Number(range[2]) : MEDIA.length - 1;
      return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: MEDIA.subarray(from, to + 1),
        headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${from}-${to}/${MEDIA.length}` } : {}) } });
    }
    if (url.pathname === '/api/timedtext') {
      // YouTube answers a web page's timedtext without the player's token with nothing (seen 2026-11-21)
      const { opts } = pick();
      const ok = url.searchParams.has('pot') || !!opts.baseUrlWorks;
      return route.fulfill({ status: 200, contentType: 'application/json', body: ok ? json3(url.searchParams.get('lang') || '') : '' });
    }
    if (url.pathname === '/watch' || url.pathname.startsWith('/shorts/')) {
      const { name, opts } = pick();
      // YouTube's own pages enforce Trusted Types: so do these, so HTML from a string fails here too
      return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': "require-trusted-types-for 'script'" },
        body: page(name, mobile, opts) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
}
