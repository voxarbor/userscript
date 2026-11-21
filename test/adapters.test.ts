import assert from 'node:assert/strict';
import { test } from 'vitest';

import { youtubeAdapter } from '../src/adapters/youtube/index';

const at = (hostname: string) => youtubeAdapter.match({ hostname } as Location);

test('YouTube\'s pages are the adapter\'s, other sites not', () => {
  for (const host of ['www.youtube.com', 'm.youtube.com', 'youtube.com', 'music.youtube.com']) assert.equal(at(host), true, host);
  for (const host of ['notyoutube.com', 'youtube.com.example.org', 'example.org']) assert.equal(at(host), false, host);
});
