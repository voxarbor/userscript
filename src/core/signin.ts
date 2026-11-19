// «Увійти»: the script signs in by a code (the server's /v1/device/*, RFC 8628). It shows the code, opens the
// site's «Підключити скрипт» on it, and polls until the person signed in there lets it in; the token comes in the
// answer's body, never in an address.
import { ApiError, type ServerApi } from '../api/client';
import { SERVER } from '../settings/store';

const SLOWER_S = 5; // what a «slow_down» adds to the wait between polls
const EXPIRED = 'Код застарів: натисніть «Увійти» ще раз';

export interface SignInHost {
  readonly api: Pick<ServerApi, 'deviceCode' | 'deviceToken'>;
  /** Opens a page of the site in a tab of its own (never in YouTube's page). */
  openTab(url: string): void;
  wait(ms: number): Promise<void>;
  /** The clock, in ms (Date.now): the code's time is counted by it, so it also runs while a poll hangs without a
   *  network and while the computer sleeps. */
  now(): number;
}

/** Why the server gives no token yet: RFC 8628's word from a refusal's body; '' for anything else. */
function why(e: unknown): string {
  if (!(e instanceof ApiError) || e.status !== 400) return '';
  try {
    return String((JSON.parse(e.body) as { error?: unknown }).error ?? '');
  } catch {
    return '';
  }
}

/** What the script gets once it is let in: its token, and whose account and which device it is. */
export type Connected = Awaited<ReturnType<ServerApi['deviceToken']>>;

/** -> the token for this device; an Error in the person's words when there is none. shown(code): the code to
 *  show, so that the person can see it is the one on the site. */
export async function signIn(host: SignInHost, name: string, shown: (code: string) => void): Promise<Connected> {
  const told = await host.api.deviceCode({ name });
  const ends = host.now() + told.expires_in * 1000;
  shown(told.user_code);
  host.openTab(`${SERVER}/panel/connect?code=${encodeURIComponent(told.user_code)}`);
  let gap = told.interval;
  while (host.now() < ends) {
    await host.wait(Math.min(gap * 1000, ends - host.now()));
    if (host.now() >= ends) break; // the wait (or the poll before it) took the rest of the code's time
    try {
      return await host.api.deviceToken({ device_code: told.device_code });
    } catch (e) {
      const error = why(e);
      if (error === 'slow_down') gap += SLOWER_S;
      else if (error === 'access_denied') throw new Error('На сайті відмовлено');
      else if (error === 'expired_token') throw new Error(EXPIRED);
      else if (error !== 'authorization_pending' && !(e instanceof ApiError && e.status === 0)) {
        throw new Error('Не вдалося: ' + (e as Error).message);
      }
    }
  }
  throw new Error(EXPIRED);
}

/** The device as the profile lists its token: «Firefox · Windows». */
export function deviceName(ua: string): string {
  const browser = ([['Edg/', 'Edge'], ['OPR/', 'Opera'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']] as const)
    .find(([mark]) => ua.includes(mark))?.[1];
  const system = ([['Android', 'Android'], ['iPhone', 'iOS'], ['iPad', 'iOS'], ['Windows', 'Windows'], ['Mac OS', 'macOS'], ['Linux', 'Linux']] as const)
    .find(([mark]) => ua.includes(mark))?.[1];
  return [browser, system].filter(Boolean).join(' · ') || 'Браузер';
}
