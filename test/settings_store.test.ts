import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { MemoryPlatform } from '../src/platform/gm';
import { DEFAULTS, SettingsStore } from '../src/settings/store';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('the store loads what the script manager keeps, over the defaults and through the migrations', () => {
  const store = new SettingsStore(new MemoryPlatform({ settings: { voice: 'male', token: 't', origVolume: 0.2 } }));
  assert.equal(store.current.voice, DEFAULTS.voice); // 'male' was the 0.1.x default
  assert.equal(store.current.origVolume, DEFAULTS.origVolume); // an older default
  assert.equal(store.current.token, 't');
  assert.equal(new SettingsStore(new MemoryPlatform()).current.token, '');
});

test('save writes at once; saveSoon writes once when the changes settle', () => {
  const platform = new MemoryPlatform();
  const store = new SettingsStore(platform);
  store.current.voice = 'Speaker_1';
  store.save();
  assert.equal((platform.values.settings as { voice: string }).voice, 'Speaker_1');

  const writes: number[] = [];
  const set = platform.setValue.bind(platform);
  platform.setValue = (key, value) => {
    writes.push((value as { voiceVolume: number }).voiceVolume);
    set(key, value);
  };
  for (const v of [0.9, 0.8, 0.7]) {
    store.current.voiceVolume = v; // a slider being dragged
    store.saveSoon();
    vi.advanceTimersByTime(100);
  }
  assert.deepEqual(writes, []);
  vi.advanceTimersByTime(400);
  assert.deepEqual(writes, [0.7]);
});

test('flush writes what is waiting (the page goes away) and nothing when nothing waits', () => {
  const platform = new MemoryPlatform();
  const store = new SettingsStore(platform);
  let writes = 0;
  platform.setValue = () => {
    writes++;
  };
  store.flush();
  assert.equal(writes, 0);
  store.saveSoon();
  store.flush();
  assert.equal(writes, 1);
  vi.advanceTimersByTime(1000);
  assert.equal(writes, 1); // the waiting write is not made twice
  store.saveSoon();
  store.save(); // a write at once takes the waiting one with it
  vi.advanceTimersByTime(1000);
  assert.equal(writes, 2);
});
