// YouTube (www and m.youtube.com, watch and shorts).
import type { SiteAdapter } from '../types';
import { Controls } from './mount';
import { collectPage, hasUkrainianDub, pageVideoId } from './page';

/** A short on a computer plays in #shorts-player (#movie_player keeps the video before, hidden); on
 *  m.youtube.com #movie_player is the short's. */
function getVideo(): HTMLVideoElement | null {
  const q = (selector: string): HTMLVideoElement | null => document.querySelector<HTMLVideoElement>(selector);
  return (location.pathname.startsWith('/shorts/') && q('#shorts-player video')) || q('#movie_player video') ||
    q('video.html5-main-video, video');
}

function getPlayer(): HTMLElement | null {
  const v = getVideo();
  return v && v.closest<HTMLElement>('.html5-video-player');
}

const controls = new Controls(getPlayer);

export const youtubeAdapter: SiteAdapter = {
  match: (loc) => /(^|\.)youtube\.com$/.test(loc.hostname),
  getVideo,
  getPlayer,
  // Ads play in the same <video> with their own currentTime.
  inAd(video) {
    const p = video.closest('.html5-video-player');
    return !!p && p.classList.contains('ad-showing');
  },
  collectPage,
  ukrainianDub: hasUkrainianDub,
  getVideoUrl() {
    const id = pageVideoId(location);
    return id ? 'https://www.youtube.com/watch?v=' + id : null;
  },
  mountControls(buttons) {
    controls.mount(buttons);
    return () => controls.unmount();
  },
  wantsRemount: () => controls.wantsRemount(),
  panelAtTop: () => controls.panelAtTop(),
  // a computer's YouTube tells on the document, m.youtube.com on the window
  onNavigate(listener) {
    document.addEventListener('yt-navigate-finish', listener);
    window.addEventListener('state-navigateend', listener);
    return () => {
      document.removeEventListener('yt-navigate-finish', listener);
      window.removeEventListener('state-navigateend', listener);
    };
  },
};
