import assert from 'node:assert/strict';
import { test } from 'vitest';

import { MemoryPlatform } from '../src/platform/gm';

test('the platform of the tests keeps values, records requests and menu commands', () => {
  const p = new MemoryPlatform({ settings: { voice: 'a' } });
  assert.deepEqual(p.getValue('settings', {}), { voice: 'a' });
  assert.deepEqual(p.getValue('ukDubOk', ['x']), ['x']); // the fallback while nothing is kept
  p.setValue('ukDubOk', ['y']);
  assert.deepEqual(p.getValue('ukDubOk', []), ['y']);
  let ran = 0;
  p.menu('Налаштування', () => ran++);
  p.menus[0]!.run();
  assert.deepEqual([p.menus[0]!.title, ran], ['Налаштування', 1]);
  p.openTab('https://vox.test/panel/connect');
  assert.deepEqual(p.tabs, ['https://vox.test/panel/connect']);
});
