// What the userscript needs of its script manager (the GM_* functions), behind one interface: the real one
// below, and one that lives in memory for the tests.

export interface HttpResponse {
  status: number;
  responseText: string;
  /** The body as bytes, when the request asked for them. */
  response: unknown;
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
}

declare function GM_getValue<T>(key: string, fallback: T): T;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_xmlhttpRequest(request: HttpRequest): void;
declare const GM_registerMenuCommand: ((title: string, run: () => void) => void) | undefined;
declare const GM_openInTab: ((url: string, options: { active: boolean }) => void) | undefined;

/** The script manager the userscript runs in. */
export const scriptManager: Platform = {
  getValue: (key, fallback) => GM_getValue(key, fallback),
  setValue: (key, value) => GM_setValue(key, value),
  request: (request) => GM_xmlhttpRequest(request),
  menu: (title, run) => {
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(title, run);
  },
  openTab: (url) => {
    if (typeof GM_openInTab === 'function') GM_openInTab(url, { active: true });
    else window.open(url, '_blank', 'noopener');
  },
};

/** A platform in memory: what was kept, asked and put into the menu can be looked at. */
export class MemoryPlatform implements Platform {
  readonly requests: HttpRequest[] = [];
  readonly menus: { title: string; run: () => void }[] = [];
  readonly tabs: string[] = [];

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
}
