// What every browser test has: the fake server, the fake YouTube, a script manager's GM functions in the page (as
// Tampermonkey and Violentmonkey give them, or only the promise-based GM.*), and the built script run on the page
// as a script manager runs it (document-idle). The script is dist/voxarbor.user.js (VX_SCRIPT: another build) with
// the server's address put in, as the server does when it serves it.
import { readFileSync } from 'node:fs';

import { type Page, test as base } from '@playwright/test';

import { type Asked, FakeServer } from './server';
import { type FixtureName, type PlayerOptions, serveYouTube, VIDEOS } from './youtube';

export const SERVER = 'https://vx.test';
export const SCRIPT = readFileSync(process.env.VX_SCRIPT || new URL('../dist/voxarbor.user.js', import.meta.url), 'utf8')
  .split('__VOXARBOR_SERVER__').join(SERVER);

/** In the page before its own scripts: the GM functions over the fake server and a store shared by the context's
 *  tabs (as a script manager's), and a log of what sounds (every AudioBufferSourceNode started: the video's place
 *  and speed then) and of the video's pauses. */
export function inPage(gm: { promises: boolean }): void {
  const w = window as unknown as Record<string, unknown> & { __vxRequest(r: unknown): Promise<{ status: number; text: string; b64?: string; headers: string }> };
  const key = (k: string): string => 'vx-gm:' + k;
  type Req = { method: string; url: string; headers: Record<string, string>; data?: string; responseType?: string;
    onload(r: unknown): void; onerror(): void };
  const marks: Record<string, number> = (w.__vxMarks = {}) as Record<string, number>;
  const xhr = (r: Req): void => {
    if (r.method === 'POST' && r.url.endsWith('/v1/videos')) marks.post ??= performance.now();
    void w.__vxRequest({ method: r.method, url: r.url, headers: r.headers, data: r.data ?? null }).then((a) => {
      if (a.status === 0) return r.onerror();
      const bytes = a.b64 ? Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0)).buffer : null;
      r.onload({ status: a.status, responseText: a.text, response: r.responseType === 'arraybuffer' ? bytes : a.text, responseHeaders: a.headers });
    });
  };
  const tabs: string[] = (w.__vxTabs = []) as string[];
  if (gm.promises) {
    w.GM = {
      getValue: async (k: string) => localStorage.getItem(key(k)) ?? undefined,
      setValue: async (k: string, v: unknown) => localStorage.setItem(key(k), String(v)),
      xmlHttpRequest: xhr,
      openInTab: (url: string) => tabs.push(url),
    };
  } else {
    Object.assign(w, {
      GM_getValue: (k: string, d: unknown) => {
        const v = localStorage.getItem(key(k));
        return v === null ? d : JSON.parse(v);
      },
      GM_setValue: (k: string, v: unknown) => localStorage.setItem(key(k), JSON.stringify(v)),
      GM_xmlhttpRequest: xhr,
      GM_openInTab: (url: string) => tabs.push(url),
      GM_setClipboard: () => {},
      GM_registerMenuCommand: () => {},
    });
  }
  const starts: { t: number; rate: number; dur: number }[] = (w.__vxStarts = []) as never;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: number[]) {
    const v = document.querySelector<HTMLVideoElement>('video.html5-main-video');
    starts.push({ t: v ? v.currentTime : -1, rate: this.playbackRate.value, dur: this.buffer ? this.buffer.duration : 0 });
    return start.apply(this, args as [number, number, number]);
  };
  new MutationObserver((_, obs) => {
    if (!document.querySelector('[data-vot]')) return;
    marks.mounted = performance.now();
    obs.disconnect();
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener('pointerup', (e) => { // a press ends here, also a touch whose click never comes (an iPhone's m.)
    if ((e.target as Element).closest('[data-vot]')) marks.click ??= performance.now();
  }, true);
  const pauses: number[] = (w.__vxPauses = []) as number[];
  document.addEventListener('pause', (e) => {
    if ((e.target as HTMLElement).matches('video.html5-main-video')) pauses.push((e.target as HTMLVideoElement).currentTime);
  }, true);
}

export interface Opened {
  page: Page;
  /** The script's switch (the main button). */
  main(): Promise<void>;
  /** The video's place, seconds. */
  time(): Promise<number>;
  starts(): Promise<{ t: number; rate: number; dur: number }[]>;
  pauses(): Promise<number[]>;
  /** The switch's tooltip: what the voice-over does now. */
  state(): Promise<string>;
  /** When (performance.now()) the script was run, its buttons came, the switch was pressed and the first POST
   *  /v1/videos left. */
  marks(): Promise<Record<string, number>>;
}

type Fixtures = {
  server: FakeServer;
  gm: { promises: boolean };
  /** Opens the fixture's page on a new tab of the context, runs the script there and waits for its buttons. */
  open(name: FixtureName, opts?: PlayerOptions): Promise<Opened>;
};

export const test = base.extend<Fixtures>({
  server: async ({}, use) => use(new FakeServer()),
  gm: [{ promises: false }, { option: true }],
  open: async ({ context, server, gm, isMobile }, use) => {
    let now: { name: FixtureName; opts: PlayerOptions } = { name: 'manual', opts: {} };
    await serveYouTube(context, isMobile, () => now);
    await context.exposeBinding('__vxRequest', (_source, asked: Asked) => server.handle(asked));
    await context.addInitScript(inPage, gm);
    await use(async (name, opts = {}) => {
      now = { name, opts };
      const page = await context.newPage();
      await page.goto((isMobile ? 'https://m.youtube.com' : 'https://www.youtube.com') + VIDEOS[name].path);
      await page.waitForFunction(() => (document.querySelector('video.html5-main-video') as HTMLVideoElement | null)?.readyState === 4);
      await page.evaluate('window.__vxMarks.init = performance.now();\n' + SCRIPT);
      const main = page.locator('[data-vot] button').first();
      await main.waitFor();
      return {
        page,
        marks: () => page.evaluate(() => (window as unknown as { __vxMarks: Record<string, number> }).__vxMarks),
        main: () => (isMobile ? main.tap() : main.click()),
        time: () => page.evaluate(() => document.querySelector<HTMLVideoElement>('video.html5-main-video')!.currentTime),
        starts: () => page.evaluate(() => (window as unknown as { __vxStarts: { t: number; rate: number; dur: number }[] }).__vxStarts),
        pauses: () => page.evaluate(() => (window as unknown as { __vxPauses: number[] }).__vxPauses),
        state: async () => (await main.getAttribute('title')) || '',
      };
    });
    if (server.broken.length) throw new Error('the script and the fake server broke the contract:\n' + server.broken.join('\n'));
  },
});

export { expect } from '@playwright/test';
