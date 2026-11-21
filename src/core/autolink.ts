// The script on the server's own «Скрипт» page (0.7): the page, opened by a person signed in, gives a one-time code
// already let in for them (#script-link data-code, 10 min); the script trades it for its token without a question
// and marks the outcome on the page (data-state: connected, other, failed), which the page shows. A script connected
// to another account is not switched silently: the page offers «Підключити до цього».
import { ApiError, type ServerApi } from '../api/client';

/** #script-link: what the script reads and marks. */
export interface LinkBox {
  dataset: Record<string, string | undefined>;
  querySelector(selector: string): { textContent: string | null; onclick: unknown } | null;
}

export interface LinkHost {
  readonly api: Pick<ServerApi, 'deviceToken'>;
  /** The script's settings: changed in place. */
  readonly settings: { token: string; account: string };
  /** Writes the settings (once changed). */
  saved(): void;
}

/** The page is the script's server's «Скрипт» (and no other site's page that looks like it). */
export function onPanel(where: { origin: string; pathname: string }, server: string): boolean {
  let origin: string;
  try {
    origin = new URL(server).origin;
  } catch {
    return false; // the placeholder: a build not served by a server
  }
  return where.origin === origin && /^\/panel\/install\/?$/.test(where.pathname);
}

function why(e: unknown): string {
  if (e instanceof ApiError && e.said) return e.said; // the server's own words, when it gives them
  if (e instanceof ApiError && e.status === 400 && e.body.includes('expired_token')) return 'Код застарів.';
  if (e instanceof ApiError && e.status === 0) return 'Немає зв\'язку із сервером.';
  return 'Сервер відмовив.';
}

export async function autoLink(box: LinkBox, host: LinkHost): Promise<void> {
  const code = box.dataset.code ?? '';
  const login = box.dataset.login ?? '';
  if (!code || !login) return;
  const { settings } = host;
  const theirs = settings.account.split(' · ')[0];
  // The code is good for one token, so it is traded once: a second press (a double click) is that same trade.
  // Asked twice, the server refused the second, and the page said «failed» over a script just connected.
  let trade: Promise<void> | null = null;
  const attempt = async (): Promise<void> => {
    try {
      const got = await host.api.deviceToken({ device_code: code });
      Object.assign(settings, { token: got.token, account: `${got.login} · ${got.name}` });
      host.saved();
      box.dataset.state = 'connected';
    } catch (e) {
      const slot = box.querySelector('[data-slot="error"]');
      if (slot) slot.textContent = why(e);
      box.dataset.state = 'failed';
    }
  };
  const take = (): Promise<void> => (trade ??= attempt());
  if (settings.token && theirs === login) {
    box.dataset.state = 'connected';
  } else if (settings.token) {
    const slot = box.querySelector('[data-slot="other"]');
    if (slot) slot.textContent = theirs || 'невідомий';
    const button = box.querySelector('#script-relink');
    if (button) button.onclick = take;
    box.dataset.state = 'other';
  } else {
    await take();
  }
}
