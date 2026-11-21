import assert from 'node:assert/strict';
import { test } from 'vitest';

import { DEFAULTS, SERVER, loadSettings } from '../src/settings/store';

test('defaults: voice 53, original at 10%, full voice volume, wait for voice', () => {
  assert.equal(DEFAULTS.voice, 'Speaker_53');
  assert.equal(DEFAULTS.origVolume, 0.1);
  assert.equal(DEFAULTS.voiceVolume, 1);
  assert.equal(DEFAULTS.waitForVoice, true);
  assert.equal(DEFAULTS.mode, ''); // the speakers' voices as the server has them for the video
});

test('loadSettings: saved settings over the defaults', () => {
  assert.deepEqual([loadSettings({ voice: 'Speaker_30', token: 't' }).voice, loadSettings({ token: 't' }).token], ['Speaker_30', 't']);
  assert.equal(loadSettings({}).voice, 'Speaker_53');
});

test('defaults: original stays ducked for the whole session', () => {
  assert.equal(DEFAULTS.duckAlways, true);
});

test('the server is the one the script was served from: no setting can change it', () => {
  assert.equal(SERVER, '__VOXARBOR_SERVER__'); // the server puts its public address here when serving the script
  assert.equal('server' in DEFAULTS, false);
});
