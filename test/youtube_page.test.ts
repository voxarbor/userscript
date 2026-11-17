import assert from 'node:assert/strict';
import { test } from 'vitest';

import { originalLang, pickCaption, ukrainianDub } from '../src/adapters/youtube/captions';
import { readPlayer } from '../src/adapters/youtube/page';

/** An array of the page's world as a script in its own world (Firefox) sees it: reading works, but the page
 *  cannot call a function of ours, so every method that takes a callback throws. */
class Foreign<T> extends Array<T> {
  static override get [Symbol.species](): ArrayConstructor {
    return Array;
  }
}
for (const name of ['find', 'map', 'filter', 'some', 'forEach', 'concat'] as const) {
  Object.defineProperty(Foreign.prototype, name, {
    value: () => {
      throw new Error('Permission denied to access object');
    },
  });
}
const foreign = <T>(...items: T[]): T[] => Foreign.from(items) as T[];

const player = () => ({
  getPlayerResponse: () => ({
    videoDetails: { videoId: 'abcdefghijk', title: 'T', lengthSeconds: '90', author: 'A', shortDescription: 'long' },
    captions: {
      playerCaptionsTracklistRenderer: {
        audioTracks: foreign({ audioTrackId: 'en.4' }, { audioTrackId: 'uk.3' }),
        captionTracks: foreign({ languageCode: 'en', kind: 'asr' }, { languageCode: 'en' }),
      },
    },
    streamingData: {
      adaptiveFormats: foreign(
        { itag: 140, audioTrack: { id: 'en.4', audioIsDefault: true } },
        { itag: 140, audioTrack: { id: 'uk.3' } },
        { itag: 137 },
      ),
    },
  }),
});

test('the rules read a copy of the player response, never the page\'s own arrays', () => {
  const raw = player().getPlayerResponse();
  assert.throws(() => ukrainianDub(raw.streamingData.adaptiveFormats, []), /Permission denied/); // what happened
  const pr = readPlayer(player());
  assert.ok(pr);
  const cr = pr.captions.playerCaptionsTracklistRenderer;
  assert.equal(ukrainianDub(pr.streamingData.adaptiveFormats, cr.audioTracks), true);
  assert.equal(originalLang(pr.streamingData.adaptiveFormats, cr.audioTracks), 'en');
  assert.deepEqual(pickCaption(cr.captionTracks, 'en'), { track: { languageCode: 'en' }, subs: 'manual' });
  assert.deepEqual(pr.videoDetails, { videoId: 'abcdefghijk', title: 'T', lengthSeconds: '90', author: 'A' });
});

test('a page without a player, or a player without a response, reads as nothing', () => {
  assert.equal(readPlayer(null), null);
  assert.equal(readPlayer({}), null);
  assert.equal(readPlayer({ getPlayerResponse: () => undefined }), null);
  const bare = readPlayer({ getPlayerResponse: () => ({}) });
  assert.deepEqual(bare, {
    videoDetails: {},
    captions: { playerCaptionsTracklistRenderer: { audioTracks: [], captionTracks: [] } },
    streamingData: { adaptiveFormats: [] },
  });
});
