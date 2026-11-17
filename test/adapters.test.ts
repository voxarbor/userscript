import assert from 'node:assert/strict';
import { test } from 'vitest';

import { adapterFor } from '../src/adapters/registry';

const at = (hostname: string) => adapterFor({ hostname } as Location);

test('YouTube pages have the YouTube adapter, other sites none', () => {
  for (const host of ['www.youtube.com', 'm.youtube.com', 'youtube.com', 'music.youtube.com']) {
    assert.equal(at(host)?.name, 'youtube', host);
  }
  for (const host of ['notyoutube.com', 'youtube.com.example.org', 'example.org']) {
    assert.equal(at(host), undefined, host);
  }
});
