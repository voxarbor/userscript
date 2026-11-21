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
    await context.addInitScript(() => localStorage.setItem('vx-gm:settings', JSON.stringify({ debug: true }))); // the journal to the console
    const page = await context.newPage();
    const journal: string[] = [];
    page.on('console', (m) => {
      if (m.text().startsWith('VoxArbor UA')) journal.push(m.text().slice(12));
    });
    const timedtext: { pot: boolean; c: string | null; bytes: number }[] = [];
    page.on('response', async (r) => {
      if (!r.url().includes('/api/timedtext')) return;
      const q = new URL(r.url()).searchParams;
      timedtext.push({ pot: q.has('pot'), c: q.get('c'), bytes: (await r.body().catch(() => Buffer.alloc(0))).length });
    });
    await page.goto(`https://${isMobile ? 'm' : 'www'}.youtube.com/${path}`, { waitUntil: 'domcontentloaded' });
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
    const playable = await page.evaluate(() => ['shorts-player', 'movie_player'].map((n) => (document.getElementById(n) as unknown as
      { getPlayerResponse?(): { playabilityStatus?: { status?: string } } | null } | null)?.getPlayerResponse?.()?.playabilityStatus?.status).find((x) => x));
    await page.evaluate(SCRIPT);
    const main = page.locator('[data-vot] button').first();
    await main.waitFor();
    // what lies over the switch, if anything takes its presses (seen: a short on m.youtube.com)
    const cover = await main.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !top || b.contains(top) ? null : `${top.tagName.toLowerCase()}.${top.className} in ${top.parentElement?.tagName.toLowerCase()}.${top.parentElement?.className} (button in ${b.closest('[data-vot]')?.getAttribute('data-vot')})`;
    });
    if (cover) console.log(`LIVE-COVER ${info.project.name} ${path}: ${cover}`);
    // the player's captions, every 250 ms for 10 s from the press: [ms, on] at each change
    const timeline = page.evaluate(async () => {
      const p = ['shorts-player', 'movie_player'].map((n) => document.getElementById(n) as unknown as { isSubtitlesOn?(): boolean } | null)
        .find((x) => x && x.isSubtitlesOn);
      const seen: [number, boolean][] = [];
      for (let t = 0; t <= 10_000; t += 250) {
        const on = !!p?.isSubtitlesOn?.();
        if (seen.at(-1)?.[1] !== on) seen.push([t, on]);
        await new Promise((r) => setTimeout(r, 250));
      }
      return seen;
    });
    if (cover) await main.dispatchEvent('click');
    else await (isMobile ? main.tap() : main.click());
    try {
      await expect.poll(() => server.pages.length, { timeout: 40_000 }).toBeGreaterThan(0);
    } finally {
      if (!server.pages.length) {
        console.log(`LIVE-FAIL ${info.project.name} ${path}: calls ${server.calls.map((c) => `${c.method} ${c.path} ${c.status}`).join('; ')}`);
        console.log(journal.slice(-30).join('\n'));
      }
    }
    const sent = server.pages[0]!;
    const result = { project: info.project.name, path, playable, subs: sent.subs, subs_lang: sent.subs_lang, subs_missing: sent.subs_missing,
      events: (sent.json3 as { events?: unknown[] } | undefined)?.events?.length ?? 0, tracks: (sent.tracks as unknown[] | undefined)?.length ?? 0,
      listed: (sent.caption_tracks as { lang: string }[] | undefined)?.map((t) => t.lang), timedtext,
      captions: await timeline,
      journal: journal.filter((l) => /page:|opened|click/.test(l)),
      broken: server.broken };
    console.log('LIVE ' + JSON.stringify(result));
    info.annotations.push({ type: 'live', description: JSON.stringify(result) });
  });
}
