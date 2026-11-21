// What the userscript needs of its script manager (the GM_* functions), behind one interface: the real one
// below, and one that lives in memory for the tests.

export interface HttpResponse {
  status: number;
  responseText: string;
  /** The body as bytes, when the request asked for them. */
  response: unknown;
  /** The answer's headers as one text, a line each (some script managers give none). */
  responseHeaders?: string;
}

/** One request of GM_xmlhttpRequest, as the script makes it. */
export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  data?: string;
  responseType?: 'arraybuffer';
  /** Milliseconds. */
  timeout: number;
  onload(response: HttpResponse): void;
  onerror(): void;
  ontimeout(): void;
}

export interface Platform {
  /** A value kept by the script manager (it survives page loads); fallback while nothing is kept. */
  getValue<T>(key: string, fallback: T): T;
  setValue(key: string, value: unknown): void;
  /** A cross-origin request the page's own rules do not stop. */
  request(request: HttpRequest): void;
  /** A command in the script manager's menu (some managers have none: then nothing happens). */
  menu(title: string, run: () => void): void;
  /** Opens a page in a new tab (the script manager's way: a plain window.open from a site's page can be blocked). */
  openTab(url: string): void;
  /** Puts the text on the clipboard (the script manager's way, else the page's, which may refuse). */
  copy(text: string): Promise<void>;
}

declare function GM_getValue<T>(key: string, fallback: T): T;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_xmlhttpRequest(request: HttpRequest): void;
declare function GM_registerMenuCommand(title: string, run: () => void): void;
declare function GM_openInTab(url: string, options: { active: boolean }): void;
declare function GM_setClipboard(text: string, type: string): void;
/** The promise-based API of the managers that have no GM_* functions (Greasemonkey 4, Userscripts on iOS). */
declare const GM: {
  getValue?(key: string): Promise<unknown>;
  setValue?(key: string, value: unknown): Promise<void>;
  xmlHttpRequest?(request: HttpRequest): void;
  registerMenuCommand?(title: string, run: () => void): void;
  openInTab?(url: string, background: boolean): void;
  setClipboard?(text: string): void;
};

/** The values the script keeps: read ahead where the manager only reads them in a promise. */
export const KEPT = ['settings', 'ukDubOk', 'videoVoice'];

/** The script manager the userscript runs in: its GM_* functions, else its promise-based GM.* ones. With those the
 *  kept values are read into memory ahead (and again by reload()) and written as JSON text (Greasemonkey keeps
 *  only plain values). Null: a manager with neither. A function the manager does not grant is not even named
 *  (typeof only): naming it would throw. */
export async function scriptManager(): Promise<(Platform & { reload(): Promise<void> }) | null> {
  const gm = typeof GM === 'object' && GM ? GM : {};
  const get = typeof GM_getValue === 'function' ? GM_getValue : null;
  const set = typeof GM_setValue === 'function' ? GM_setValue : null;
  const xhr = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : gm.xmlHttpRequest && gm.xmlHttpRequest.bind(gm);
  const menu = typeof GM_registerMenuCommand === 'function' ? GM_registerMenuCommand : gm.registerMenuCommand && gm.registerMenuCommand.bind(gm);
  const tab = typeof GM_openInTab === 'function' ? (url: string) => GM_openInTab(url, { active: true })
    : gm.openInTab && ((url: string) => gm.openInTab!(url, false));
  const clip = typeof GM_setClipboard === 'function' ? (text: string) => GM_setClipboard(text, 'text') : gm.setClipboard && gm.setClipboard.bind(gm);
  const sync = !!(get && set);
  if (!xhr || !(sync || (gm.getValue && gm.setValue))) return null;
  const kept = new Map<string, unknown>();
  const reload = async (): Promise<void> => {
    if (sync) return;
    for (const key of KEPT) {
      const text = await gm.getValue!(key);
      try {
        kept.set(key, typeof text === 'string' ? JSON.parse(text) : undefined);
      } catch {
        kept.delete(key);
      }
    }
  };
  await reload();
  return {
    reload,
    getValue: <T>(key: string, fallback: T): T =>
      (sync ? get!(key, fallback) : kept.get(key) === undefined ? fallback : (kept.get(key) as T)),
    setValue: (key, value) => {
      if (sync) return set!(key, value);
      kept.set(key, value);
      void gm.setValue!(key, JSON.stringify(value));
    },
    request: (request) => xhr(request),
    menu: (title, run) => menu && menu(title, run),
    openTab: (url) => (tab ? tab(url) : void window.open(url, '_blank', 'noopener')),
    copy: async (text) => (clip ? clip(text) : navigator.clipboard.writeText(text)),
  };
}

/** A platform in memory: what was kept, asked and put into the menu can be looked at. */
export class MemoryPlatform implements Platform {
  readonly requests: HttpRequest[] = [];
  readonly menus: { title: string; run: () => void }[] = [];
  readonly tabs: string[] = [];
  readonly copied: string[] = [];

  constructor(readonly values: Record<string, unknown> = {}) {}

  getValue<T>(key: string, fallback: T): T {
    return key in this.values ? (this.values[key] as T) : fallback;
  }

  setValue(key: string, value: unknown): void {
    this.values[key] = value;
  }

  request(request: HttpRequest): void {
    this.requests.push(request);
  }

  menu(title: string, run: () => void): void {
    this.menus.push({ title, run });
  }

  openTab(url: string): void {
    this.tabs.push(url);
  }

  async copy(text: string): Promise<void> {
    this.copied.push(text);
  }
}
