// A site the userscript works on, as the core sees it.
import type { PageData } from '../api/client';

export interface SiteAdapter {
  readonly name: string;
  match(loc: Location): boolean;
  getVideo(): HTMLVideoElement | null;
  /** The video's canonical address; null when the page is not a video's. */
  getVideoUrl(): string | null;
  getPlayer?(): HTMLElement | null;
  /** An ad plays in the video element now: no voice-over, ducking or holding during it. */
  inAd?(video: HTMLVideoElement): boolean;
  /** Page data for the server (it cannot always fetch the site itself); null when nothing usable. */
  collectPage?(): Promise<PageData | null>;
  /** The site itself offers a Ukrainian audio track for this video. */
  ukrainianDub?(): boolean;
  /** Puts the script's buttons into the page. -> the function that takes them out again */
  mountControls(buttons: HTMLElement[]): () => void;
  /** A better place for the buttons has appeared (asked every second). */
  wantsRemount?(): boolean;
  /** The page went to another video without a load. -> the function that stops telling the listener */
  onNavigate(listener: () => void): () => void;
}
