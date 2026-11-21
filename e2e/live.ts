// A smoke test on the real YouTube (manual: `npm run smoke:live`, never in CI): the built script on real watch pages
// and a short, www as a computer and m. as two phones, with the stand-in server asking for the page's captions.
// It prints what the script sent and how it got the captions; it fails only when no page was sent at all.
import { expect, test } from '@playwright/test';

import { inPage, SCRIPT } from './harness';
import { type Asked, FakeServer } from './server';

const VIDEOS = (process.env.VX_LIVE_VIDEOS || 'watch?v=wdpjv2enZLM watch?v=fUgn8iImHmk shorts/qmXFT0FjvCw').split(' ');

for (const path of VIDEOS) {
  test(`live: ${path}`, async ({ context, isMobile }, info) => {
    const server = new FakeServer();
    server.pageNeeded = true;
    await context.addCookies([{ name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' }]); // the consent answered: necessary cookies only
    await context.exposeBinding('__vxRequest', (_source, asked: Asked) => server.handle(asked));
    await context.addInitScript(inPage, { promises: false });
    const page = await context.newPage();
    const timedtext: { pot: boolean; c: string | null; bytes: number }[] = [];
    page.on('response', async (r) => {
      if (!r.url().includes('/api/timedtext')) return;
      const q = new URL(r.url()).searchParams;
      timedtext.push({ pot: q.has('pot'), c: q.get('c'), bytes: (await r.body().catch(() => Buffer.alloc(0))).length });
    });
    await page.goto(`https://${isMobile ? 'm' : 'www'}.youtube.com/${path}`);
    const id = path.split(/[=/]/).pop()!;
    await page.waitForFunction((id) => ['shorts-player', 'movie_player'].some((n) => {
      const p = document.getElementById(n) as (HTMLElement & { getPlayerResponse?(): { videoDetails?: { videoId?: string } } }) | null;
      return p?.getPlayerResponse?.()?.videoDetails?.videoId === id;
    }), id, { timeout: 30_000 });
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('video.html5-main-video');
      if (v) (v.muted = true), v.play().catch(() => {});
    });
    await page.waitForTimeout(3000);
    const playable = await page.evaluate(() => (document.getElementById('movie_player') as unknown as { getPlayerResponse(): { playabilityStatus?: { status?: string } } })
      .getPlayerResponse().playabilityStatus?.status);
    await page.evaluate(SCRIPT);
    const main = page.locator('[data-vot] button').first();
    await main.waitFor();
    await (isMobile ? main.tap() : main.click());
    await expect.poll(() => server.pages.length, { timeout: 40_000 }).toBeGreaterThan(0);
    const sent = server.pages[0]!;
    const result = { project: info.project.name, path, playable, subs: sent.subs, subs_lang: sent.subs_lang, subs_missing: sent.subs_missing,
      events: (sent.json3 as { events?: unknown[] } | undefined)?.events?.length ?? 0, tracks: (sent.tracks as unknown[] | undefined)?.length ?? 0,
      listed: (sent.caption_tracks as { lang: string }[] | undefined)?.map((t) => t.lang), timedtext,
      captionsAfter: await page.evaluate(() => (document.getElementById('movie_player') as unknown as { isSubtitlesOn?(): boolean }).isSubtitlesOn?.() ?? null),
      broken: server.broken };
    console.log('LIVE ' + JSON.stringify(result));
    info.annotations.push({ type: 'live', description: JSON.stringify(result) });
  });
}
