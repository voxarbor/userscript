// The script on a YouTube page, end to end: the server's stand-in answers by the contract, the page is a recorded
// YouTube page with a stand-in player. Every test runs as a computer (www) and as two phones (m., touch).
import { expect, type Opened, test } from './harness';
import type { FixtureName } from './youtube';

const PHRASE_STARTS = (from: number) => (s: { t: number }) => s.t >= from - 0.7;

/** Waits until the server has had a call that `match` takes; -> that call. */
async function called<T>(o: Opened, calls: () => T[], what: string, ms = 15_000): Promise<T> {
  await expect.poll(() => calls().length, { message: what, timeout: ms }).toBeGreaterThan(0);
  return calls()[0]!;
}

test('start: switching on opens the video where it plays and voices the phrases from there', async ({ open, server }) => {
  const o = await open('manual');
  await o.main();
  const opened = await called(o, () => server.made(/^POST \/v1\/videos$/), 'the video is opened');
  expect(opened.body).toMatchObject({ url: 'https://www.youtube.com/watch?v=wdpjv2enZLM', page_support: true, switch: false });
  expect(typeof opened.body!.from).toBe('number');
  await expect.poll(async () => (await o.starts()).length, { timeout: 15_000 }).toBeGreaterThan(1);
  const starts = await o.starts();
  // each phrase starts at its place in the video (phrases at 1 + 4k s)
  for (const s of starts) {
    const into = (((s.t - 1) % 4) + 4) % 4; // how far into a phrase's slot the video was
    expect(into < 0.7 || into > 3.8, `a phrase started at ${s.t}`).toBe(true);
  }
  expect(await o.state()).toBe('100%');
});

const EXPECTED: Record<FixtureName, Record<string, unknown>> = {
  manual: { video_id: 'wdpjv2enZLM', subs: 'manual', subs_lang: 'en-US' },
  auto: { video_id: 'fUgn8iImHmk', subs: 'asr', subs_lang: 'en' },
  none: { video_id: '7Vc4-FDGBxo', subs: null, subs_missing: 'no_tracks' },
  live: { video_id: 'jfKfPfyJRdk', subs: null, subs_missing: 'no_tracks', duration: null },
  short: { video_id: 'qmXFT0FjvCw', subs: 'asr', subs_lang: 'en' },
};

for (const name of Object.keys(EXPECTED) as FixtureName[]) {
  test(`captions without pressing CC: ${name}`, async ({ open, server }) => {
    server.pageNeeded = true;
    const o = await open(name);
    await o.main();
    await called(o, () => server.pages, 'the page is posted');
    const page = server.pages[0]!;
    expect(page).toMatchObject(EXPECTED[name]);
    if (page.subs) expect((page.json3 as { events: unknown[] }).events.length).toBeGreaterThan(0);
    const fx = await o.page.evaluate(() => {
      const w = window as unknown as { __fxClicks: { cc: number }; __fxCaptions: string[] };
      return { clicks: w.__fxClicks.cc, captions: w.__fxCaptions };
    });
    expect(fx.clicks).toBe(0); // never the CC button
    expect(fx.captions.at(-1) ?? 'off').toBe('off'); // the viewer's captions as they were: off
  });
}

test('captions the viewer has on stay on, and the player asks anew for them', async ({ open, server }) => {
  server.pageNeeded = true;
  const o = await open('manual', { captionsOn: true });
  await o.page.waitForTimeout(500);
  await o.page.evaluate(() => performance.clearResourceTimings()); // YouTube clears the buffer: the request before is gone
  await o.main();
  await called(o, () => server.pages, 'the page is posted');
  expect(server.pages[0]).toMatchObject({ subs: 'manual', subs_lang: 'en-US' });
  const captions = await o.page.evaluate(() => (window as unknown as { __fxCaptions: string[] }).__fxCaptions);
  expect(captions).toEqual(['off', 'en-US', 'en-US']); // off, the track, and back to what the viewer had
});

test('late captions: the player asks for them seconds later, and they still go', async ({ open, server }) => {
  server.pageNeeded = true;
  const o = await open('auto', { askDelay: 3000 });
  await o.main();
  await called(o, () => server.pages, 'the page is posted');
  expect(server.pages[0]).toMatchObject({ subs: 'asr', subs_lang: 'en' });
});

test('captions that never come: the page goes without them, saying why; a track\'s own address is tried', async ({ open, server }) => {
  server.pageNeeded = true;
  const o = await open('manual', { askDelay: 60_000 });
  await o.main();
  await called(o, () => server.pages, 'the page is posted', 20_000);
  expect(server.pages[0]).toMatchObject({ subs: null, subs_missing: 'no_url', title: expect.any(String), caption_tracks: [{ lang: 'en-US' }] });

  server.pageNeeded = true; // a player that does not need the token for a track's own address (baseUrl)
  const p = await open('manual', { noApi: true, baseUrlWorks: true });
  await p.main();
  await expect.poll(() => server.pages.length, { timeout: 15_000 }).toBe(2);
  expect(server.pages[1]).toMatchObject({ subs: 'manual', subs_lang: 'en-US' });
});

test('translation changed: the phrase\'s new audio is fetched and nothing pauses', async ({ open, server }) => {
  server.status = 'voicing'; // a video in the making is asked about every few seconds
  server.progress = 0.5;
  const o = await open('manual');
  await o.main();
  await expect.poll(async () => (await o.starts()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const at = await o.time();
  const next = server.phrases.find((p) => p.start > at + 6)!;
  next.v = 2; // voiced anew: another hash, another address
  await called(o, () => server.made(new RegExp(`^GET /v1/audio/p${next.i}v2\\.opus$`)), 'the new audio is fetched', 10_000);
  await expect.poll(() => o.time(), { timeout: 15_000 }).toBeGreaterThan(next.end);
  expect(await o.pauses()).toEqual([]);
});

test('no audio yet: the video waits for the voice-over and goes on once it comes', async ({ open, server }) => {
  server.status = 'voicing';
  server.progress = 0.1;
  for (const p of server.phrases) p.voiced = false;
  const o = await open('manual');
  await o.main();
  await expect.poll(() => o.state(), { timeout: 10_000 }).toBe('Чекаю озвучку…');
  await expect.poll(() => o.page.evaluate(() => document.querySelector('video')!.paused)).toBe(true);
  for (const p of server.phrases) p.voiced = true;
  await expect.poll(() => o.page.evaluate(() => document.querySelector('video')!.paused), { timeout: 10_000 }).toBe(false);
  await expect.poll(async () => (await o.starts()).length, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('server restart: 503 and no answer while audio is here ahead pass quietly, then it is asked again', async ({ open, server }) => {
  server.status = 'voicing';
  server.progress = 0.9;
  const o = await open('manual');
  await o.main();
  await expect.poll(() => server.made(/^GET \/v1\/audio\//).length, { timeout: 15_000 }).toBeGreaterThan(10);
  await o.page.waitForTimeout(1000);
  server.down = 503;
  await expect.poll(() => server.calls.filter((c) => c.status === 503).length, { timeout: 10_000 }).toBeGreaterThan(0);
  server.down = 0;
  await expect.poll(() => server.calls.filter((c) => c.status === 0).length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await o.state()).not.toMatch(/Сервер/);
  server.down = null;
  const back = server.calls.length;
  await expect.poll(() => server.calls.slice(back).filter((c) => c.status === 200).length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await o.state()).not.toMatch(/Сервер/);
  expect(await o.pauses()).toEqual([]);
});

test('seek: the phrases of the new place are asked for and sound there', async ({ open, server }) => {
  const o = await open('manual');
  await o.main();
  await expect.poll(async () => (await o.starts()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await o.page.evaluate(() => (document.querySelector('video')!.currentTime = 120));
  await called(o, () => server.made(/segments$/).filter((c) => Number(c.query.get('from')) >= 119), 'the window of the new place');
  await expect.poll(async () => (await o.starts()).filter(PHRASE_STARTS(120)).length, { timeout: 10_000 }).toBeGreaterThan(0);
});

test('2x speed: the phrases sound at the video\'s speed', async ({ open }) => {
  const o = await open('manual');
  await o.page.evaluate(() => (document.querySelector('video')!.playbackRate = 2));
  await o.main();
  await expect.poll(async () => (await o.starts()).length, { timeout: 15_000 }).toBeGreaterThan(1);
  expect((await o.starts()).every((s) => s.rate === 2)).toBe(true);
});

test('several tabs: each is its own viewer of the video, and each sounds', async ({ open, server }) => {
  const a = await open('manual');
  const b = await open('manual');
  await a.main();
  await b.main();
  await expect.poll(async () => (await a.starts()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await b.starts()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const tabs = new Set(server.made(/^POST \/v1\/videos$/).map((c) => c.body!.tab));
  expect(tabs.size).toBe(2);
});

test('sign-in and out: a refused script is asked to connect, connects through the site, and forgets the token', async ({ open, server }) => {
  server.token = 'vxa_e2e';
  const o = await open('manual');
  await o.main();
  await expect(o.page.getByText('Скрипт не підключено: натисніть «Підключити»')).toBeVisible();
  const connect = o.page.getByRole('button', { name: 'Підключити', exact: true });
  await connect.click();
  await expect.poll(() => o.page.evaluate(() => (window as unknown as { __vxTabs: string[] }).__vxTabs)).toEqual([expect.stringContaining('/panel/connect')]);
  await expect(o.page.getByText(/Підключено як tester/)).toBeVisible({ timeout: 10_000 });
  await o.page.getByTitle('Закрити').click();
  const before = server.calls.length;
  await o.main();
  await expect.poll(async () => (await o.starts()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(server.calls.slice(before).every((c) => c.path.startsWith('/v1/audio') || c.auth === 'Bearer vxa_e2e')).toBe(true);
  await o.main(); // off
  await o.page.locator('[data-vot] button').first().click({ button: 'right' });
  await o.page.getByRole('button', { name: 'Відключити' }).click();
  await expect(o.page.getByRole('button', { name: 'Підключити', exact: true })).toBeVisible();
  const stored = await o.page.evaluate(() => JSON.parse(localStorage.getItem('vx-gm:settings') || '{}').token);
  expect(stored).toBe('');
});

test.describe('a script manager with the promise-based GM.* only (Greasemonkey 4, Userscripts)', () => {
  test.use({ gm: { promises: true } });
  test('the script starts and voices', async ({ open, server }) => {
    const o = await open('manual');
    await o.main();
    await called(o, () => server.made(/^POST \/v1\/videos$/), 'the video is opened');
    await expect.poll(async () => (await o.starts()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  });
});
