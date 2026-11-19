// Runs a built userscript on a real YouTube watch page against a stand-in server that lives in this function:
// every answer comes after `lat` ms, the video is «ready» with a phrase every 6 s, audio is a generated 5 s tone
// (windows: false stands for a server from before 0.10, which sends no phrases with the opening).
// It seeks the playing video into the middle of a phrase, switches the voice-over on, seeks twice, switches it off,
// and reports the script's journal, the requests and how the <video> was paused and played.
// The file is a function: evaluate it and call it with the text of dist/voxarbor.user.js, in the world a userscript
// runs in (the page's DOM, its own globals). It takes about 18 s.
(async (source, opts) => {
  const o = Object.assign({ lat: 150, audioLat: 250, windows: true }, opts || {});
  const lines = [], errors = [], asked = [], moves = [];
  const T0 = performance.now();
  const at = () => Math.round(performance.now() - T0);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const id = new URLSearchParams(location.search).get('v');
  const url = 'https://www.youtube.com/watch?v=' + id;
  const settings = { token: 't', voice: 'Speaker_53', debug: true };
  globalThis.GM_getValue = (k, d) => (k === 'settings' ? settings : k === 'ukDubOk' ? [url] : d);
  globalThis.GM_setValue = () => {};
  globalThis.GM_registerMenuCommand = () => {};
  const wav = (seconds) => {
    const rate = 8000, n = rate * seconds, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (p, s) => [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 440 / rate) * 8000, true);
    return buf;
  };
  const phrases = [];
  for (let i = 0; i < 300; i++) phrases.push({ i, start: i * 6, end: i * 6 + 5.5, src: '', uk: '', speaker: null, voice: 'Speaker_53', audio: `/v1/audio/${i}.opus` });
  const win = (from) => ({ status: 'ready', progress: 1, error: null, voiced_until: from + 60, page_needed: false, voice: 'Speaker_53',
    segments: phrases.filter((p) => p.end > from && p.start < from + 60) });
  globalThis.GM_xmlhttpRequest = (r) => {
    const path = r.url.replace(/^https?:\/\/[^/]+/, '');
    asked.push(`${at()} ${r.method} ${path.slice(0, 70)}`);
    const answer = (body, ms, bin) => setTimeout(() => r.onload({ status: 200, responseText: bin ? '' : JSON.stringify(body),
      response: bin ? body : null, responseHeaders: 'content-type: x\r\nserver-timing: app;dur=5.0\r\n' }), ms);
    if (r.method === 'POST' && path === '/v1/videos') {
      const b = JSON.parse(r.data);
      return answer({ video_key: 'k', status: 'ready', source_lang: 'en', duration: 1800, error: null, page_needed: false, refused: null,
        voice: 'Speaker_53', ...(o.windows ? { window: b.from != null ? win(b.from) : null } : {}) }, o.lat);
    }
    if (path.startsWith('/v1/voiced')) return answer({ video_key: 'k', voices: { Speaker_53: 1 } }, o.lat);
    if (path.includes('/segments')) return answer(win(Number(new URL(r.url).searchParams.get('from'))), o.lat);
    if (path.startsWith('/v1/audio/')) return answer(wav(5), o.audioLat, true);
    if (path === '/v1/voices') return answer([], o.lat);
    setTimeout(() => r.onerror(), o.lat);
  };
  console.debug = (...a) => {
    if (a[0] === 'VoxArbor UA') lines.push(`${at()} | ${String(a[1]).slice(13)}`);
  };
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  try {
    (0, eval)(source.split('__VOXARBOR_SERVER__').join('https://vox.invalid'));
  } catch (e) {
    errors.push(String(e));
  }
  await sleep(2500);
  const video = document.querySelector('#movie_player video');
  const main = document.querySelector('button[data-vot="main"]');
  if (!video || !main) return { errors, note: 'no video or no button', video: !!video, main: !!main, lines };
  for (const ev of ['pause', 'play', 'playing', 'waiting', 'seeking', 'seeked']) {
    video.addEventListener(ev, () => moves.push(`${at()} ${ev} @${video.currentTime.toFixed(2)}`));
  }
  const ad = () => !!video.closest('.html5-video-player.ad-showing');
  video.muted = true; // lets it play without a person's press
  const step = async (name, run, wait) => {
    lines.push(`${at()} | ===== ${name}`);
    moves.push(`${at()} ===== ${name}`);
    await run();
    await sleep(wait);
  };
  const report = { ad: ad(), duration: video.duration };
  await step('the video plays from 20.0 (2 s into phrase 3)', async () => {
    video.currentTime = 20;
    await video.play().catch((e) => errors.push('play: ' + e));
  }, 2500);
  report.before = { paused: video.paused, t: video.currentTime, readyState: video.readyState };
  await step('click: the voice-over on', async () => main.click(), 5000);
  report.afterOn = { paused: video.paused, t: video.currentTime, color: main.style.color, title: main.title };
  await step('seek to 100.0 (4 s into phrase 16, 1.5 s of it left)', async () => {
    video.currentTime = 100;
  }, 4000);
  await step('seek to 301.0 (unknown place: phrase 50, 1 s in)', async () => {
    video.currentTime = 301;
  }, 4000);
  await step('click: off', async () => main.click(), 500);
  report.end = { paused: video.paused, t: video.currentTime, color: main.style.color };
  return { errors, report, lines, asked, moves };
})
