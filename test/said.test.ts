import assert from 'node:assert/strict';
import { test } from 'vitest';

import { said } from '../src/core/said';

test('the server\'s words become one short line of plain text; anything else is nothing', () => {
  assert.equal(said('  Відео   закрите\n автором  '), 'Відео закрите автором');
  assert.equal(said('a‮b⁦c\u0007d e'), 'a b c d e'); // no direction overrides or control characters
  assert.equal(said('я'.repeat(500))!.length, 200);
  assert.equal(said('я'.repeat(500))!.at(-1), '…');
  for (const nothing of [null, undefined, 42, {}, '', '   ']) assert.equal(said(nothing), null);
});
