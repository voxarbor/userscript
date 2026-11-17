// YouTube (www and m.youtube.com, watch and shorts).
import type { SiteAdapter } from '../types';
import { Controls } from './mount';
import { collectPage, hasUkrainianDub } from './page';

function getVideo(): HTMLVideoElement | null {
  const shorts = location.pathname.startsWith('/shorts/');
  return document.querySelector<HTMLVideoElement>(shorts ? '#shorts-player video' : '#movie_player video') ||
    document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
}

function getPlayer(): HTMLElement | null {
  const v = getVideo();
  return v && v.closest<HTMLElement>('.html5-video-player');
}

const controls = new Controls(getPlayer);

export const youtubeAdapter: SiteAdapter = {
  name: 'youtube',
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
    const id = new URLSearchParams(location.search).get('v') ||
      (location.pathname.match(/^\/shorts\/([\w-]{11})/) || [])[1];
    return id ? 'https://www.youtube.com/watch?v=' + id : null;
  },
  mountControls(buttons) {
    controls.mount(buttons);
    return () => controls.unmount();
  },
  wantsRemount: () => controls.wantsRemount(),
  onNavigate(listener) {
    document.addEventListener('yt-navigate-finish', listener);
    return () => document.removeEventListener('yt-navigate-finish', listener);
  },
};
