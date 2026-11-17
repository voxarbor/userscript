// The sites the userscript knows.
import type { SiteAdapter } from './types';
import { youtubeAdapter } from './youtube/index';

const ADAPTERS: SiteAdapter[] = [youtubeAdapter];

/** The adapter of the page at loc; undefined on a page of no known site. */
export function adapterFor(loc: Location): SiteAdapter | undefined {
  return ADAPTERS.find((a) => a.match(loc));
}
