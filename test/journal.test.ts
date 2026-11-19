import assert from 'node:assert/strict';
import { test } from 'vitest';

import { Journal } from '../src/core/journal';

test('a line of the journal: the time of day, the milliseconds since the line before, what happened', () => {
  let now = new Date(2026, 10, 19, 7, 5, 9, 42).getTime();
  const echoed: string[] = [];
  const journal = new Journal(() => now, (line) => echoed.push(line));
  journal.mark('click');
  now += 1234;
  journal.mark('POST /v1/videos → 200');
  assert.deepEqual(journal.text(['VoxArbor UA 0.10.0']).split('\n'), [
    'VoxArbor UA 0.10.0',
    '07:05:09.042 +    0  click',
    '07:05:10.276 + 1234  POST /v1/videos → 200',
    '',
  ]);
  assert.equal(echoed.length, 2); // each line goes on as it is written (the console, when asked for)
});

test('a long journal loses its oldest lines, but not the first ones of the last switching on', () => {
  let now = 0;
  const journal = new Journal(() => (now += 10));
  journal.mark('before');
  journal.begin('on: video A');
  for (let i = 0; i < 2000; i++) journal.mark('line ' + i);
  const lines = journal.text().trimEnd().split('\n').map((line) => line.slice(21));
  assert.equal(lines.length, 700);
  assert.deepEqual(lines.slice(0, 3), ['── on: video A', 'line 0', 'line 1']); // the start is still there
  assert.equal(lines[249], 'line 248');
  assert.equal(lines[250], 'line 1550'); // what came between is gone
  assert.equal(lines.at(-1), 'line 1999');

  journal.begin('on: video B'); // the start before is no longer kept
  for (let i = 0; i < 700; i++) journal.mark('next ' + i);
  assert.ok(!journal.text().includes('video A'));
  assert.ok(journal.text().includes('── on: video B'));
});
