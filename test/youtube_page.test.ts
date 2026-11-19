import assert from 'node:assert/strict';
import { test } from 'vitest';

import { extraTracks, listed, originalCaptions, originalLang, pickCaption, ukrainianDub } from '../src/adapters/youtube/captions';
import { moreTracks, pageVideoId, playerTrack, readPlayer, trackUrl, weight } from '../src/adapters/youtube/page';

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

test('YouTube\'s own Ukrainian dub, the default for a Ukrainian viewer, is not taken for the original', async () => {
  // a fragment of the real player response of youtube:ZbmfYMlrlII as a viewer in Ukraine gets it (2026-11-17):
  // the AI dub «uk.10» is the default track, the English original «en-US.4» is not
  const { readFileSync } = await import('node:fs');
  const real = JSON.parse(readFileSync(new URL('./fixtures/ZbmfYMlrlII.json', import.meta.url), 'utf8'));
  const pr = readPlayer({ getPlayerResponse: () => real });
  assert.ok(pr);
  const cr = pr.captions.playerCaptionsTracklistRenderer;
  assert.equal(originalLang(pr.streamingData.adaptiveFormats, cr.audioTracks), 'en-US');
  assert.equal(ukrainianDub(pr.streamingData.adaptiveFormats, cr.audioTracks), true);
  assert.deepEqual(pickCaption(cr.captionTracks, 'en-US'), { track: { languageCode: 'en', kind: 'asr' }, subs: 'asr' });
});

// ---------- more caption tracks for the server (0.10) ----------

const t = (languageCode: string, kind?: string) => (kind ? { languageCode, kind } : { languageCode });

test('the tracks sent besides the main one: the speech\'s own (the author\'s and YouTube\'s) and English (the author\'s, and YouTube\'s translation)', () => {
  // a Spanish vlog with the author's English captions, which were sent as the main track
  assert.deepEqual(extraTracks([t('es', 'asr'), t('en'), t('es-419')], { lang: 'en', subs: 'manual' }), [
    { lang: 'es-419', kind: 'manual' },
    { lang: 'es', kind: 'asr' },
    { lang: 'en', kind: 'asr', translatedFrom: 'es' },
    { lang: 'uk', kind: 'manual', translatedFrom: 'en' },
  ]);
  // the same vlog with nothing but YouTube's own recognition, which went as the main track
  assert.deepEqual(extraTracks([t('es', 'asr')], { lang: 'es', subs: 'asr' }),
    [{ lang: 'en', kind: 'asr', translatedFrom: 'es' }, { lang: 'uk', kind: 'asr', translatedFrom: 'es' }]);
  // English speech: the main track was the author's, YouTube's own comes too (it fills the author's gaps)
  assert.deepEqual(extraTracks([t('en', 'asr'), t('en'), t('de')], { lang: 'en', subs: 'manual' }),
    [{ lang: 'en', kind: 'asr' }, { lang: 'uk', kind: 'manual', translatedFrom: 'en' }]);
  assert.deepEqual(extraTracks([t('en', 'asr')], { lang: 'en', subs: 'asr' }), [{ lang: 'uk', kind: 'asr', translatedFrom: 'en' }]);
  // no recognition of YouTube's own: the speech's language is not known from the tracks; English still comes
  assert.deepEqual(extraTracks([t('de'), t('en')], { lang: 'de', subs: 'manual' }),
    [{ lang: 'en', kind: 'manual' }, { lang: 'uk', kind: 'manual', translatedFrom: 'de' }]);
  assert.deepEqual(extraTracks([], null), []);
  // the main track was not had: every track wanted is asked for
  assert.deepEqual(extraTracks([t('en', 'asr'), t('en')], null),
    [{ lang: 'en', kind: 'manual' }, { lang: 'en', kind: 'asr' }, { lang: 'uk', kind: 'asr', translatedFrom: 'en' }]);
  // Ukrainian: the author's when there is one; none for Ukrainian speech
  assert.deepEqual(extraTracks([t('en', 'asr'), t('uk')], { lang: 'en', subs: 'asr' }), [{ lang: 'uk', kind: 'manual' }]);
  assert.deepEqual(extraTracks([t('uk', 'asr')], { lang: 'uk', subs: 'asr' }), [{ lang: 'en', kind: 'asr', translatedFrom: 'uk' }]);
});

test('a track\'s address is the player\'s own request with the language, the kind and the translation changed', () => {
  const own = 'https://www.youtube.com/api/timedtext?v=abcdefghijk&pot=TOKEN&lang=uk&kind=asr&tlang=de&fmt=srv3';
  const of = (url: string) => Object.fromEntries(new URL(url).searchParams);
  assert.deepEqual(of(trackUrl(own, { lang: 'es-419', kind: 'manual' })), { v: 'abcdefghijk', pot: 'TOKEN', lang: 'es-419', fmt: 'json3' });
  assert.deepEqual(of(trackUrl(own, { lang: 'es', kind: 'asr' })), { v: 'abcdefghijk', pot: 'TOKEN', lang: 'es', kind: 'asr', fmt: 'json3' });
  assert.deepEqual(of(trackUrl(own, { lang: 'en', kind: 'asr', translatedFrom: 'es' })),
    { v: 'abcdefghijk', pot: 'TOKEN', lang: 'es', kind: 'asr', tlang: 'en', fmt: 'json3' });
});

test('the tracks are fetched together; one that cannot be had, or does not fit the server\'s limit, is left out', async () => {
  const file = (text: string) => ({ events: [{ tStartMs: 0, segs: [{ utf8: text }] }] });
  const asked: string[] = [];
  const get = async (url: string) => {
    const q = new URL(url).searchParams;
    const name = q.get('lang') + (q.get('kind') ? '.asr' : '') + (q.get('tlang') ? '>' + q.get('tlang') : '');
    asked.push(name);
    return name === 'es.asr' ? null : file(name);
  };
  const wanted = [{ lang: 'es-419', kind: 'manual' as const }, { lang: 'es', kind: 'asr' as const }, { lang: 'en', kind: 'asr' as const, translatedFrom: 'es' }];
  const own = 'https://www.youtube.com/api/timedtext?v=abcdefghijk&pot=TOKEN&lang=en';
  assert.deepEqual(await moreTracks(own, wanted, get, 1000), [
    { lang: 'es-419', kind: 'manual', json3: file('es-419') },
    { lang: 'en', kind: 'asr', translated_from: 'es', json3: file('es.asr>en') },
  ]);
  assert.deepEqual(asked, ['es-419', 'es.asr', 'es.asr>en']);
  const one = weight(file('es-419'));
  assert.deepEqual((await moreTracks(own, wanted, get, one)).map((x) => x.lang), ['es-419']); // room for one only
  assert.deepEqual(await moreTracks(own, wanted, get, one - 1), []);
  // the weight is the server's: its JSON writes a letter outside ASCII as six characters
  assert.equal(weight({ a: 'я' }), '{"a":"я"}'.length + 5);
});

test('the player\'s caption tracks are read with their names, for the list the server is sent', () => {
  const pr = readPlayer({
    getPlayerResponse: () => ({
      captions: { playerCaptionsTracklistRenderer: { captionTracks: foreign(
        { languageCode: 'es', kind: 'asr', name: { simpleText: 'Spanish (auto-generated)' } },
        { languageCode: 'en', name: { runs: foreign({ text: 'English' }) } },
        { languageCode: 'de' },
      ) } },
    }),
  });
  assert.deepEqual(pr!.captions.playerCaptionsTracklistRenderer.captionTracks, [
    { languageCode: 'es', kind: 'asr', name: 'Spanish (auto-generated)' },
    { languageCode: 'en', name: 'English' },
    { languageCode: 'de' },
  ]);
  assert.deepEqual(listed(pr!.captions.playerCaptionsTracklistRenderer.captionTracks), [
    { lang: 'es', kind: 'asr', name: 'Spanish (auto-generated)' },
    { lang: 'en', kind: null, name: 'English' },
    { lang: 'de', kind: null, name: null },
  ]);
});

test('the video of the address: a watch page, a short, a live page; another page is no video\'s', () => {
  assert.equal(pageVideoId({ search: '?v=abcdefghijk&t=10s', pathname: '/watch' }), 'abcdefghijk');
  assert.equal(pageVideoId({ search: '', pathname: '/shorts/abcdefghijk' }), 'abcdefghijk');
  assert.equal(pageVideoId({ search: '?si=x', pathname: '/live/abc-efg_ijk' }), 'abc-efg_ijk');
  assert.equal(pageVideoId({ search: '', pathname: '/feed/subscriptions' }), null);
});

test('the player asking for a translation (a viewer listening to a dub) never makes the track sent one', () => {
  // youtube:letg2G-Bnuc 2026-11-19: an English video, its Spanish AI dub played: the player's request had tlang=es and
  // the Spanish text went as the English auto track
  const own = 'https://www.youtube.com/api/timedtext?v=abcdefghijk&pot=TOKEN&lang=en&kind=asr&tlang=es&fmt=srv3';
  const q = (u: string) => Object.fromEntries(new URL(u).searchParams);
  assert.deepEqual(playerTrack(own), { lang: 'en', kind: 'asr' });
  assert.deepEqual(q(trackUrl(own, playerTrack(own))), { v: 'abcdefghijk', pot: 'TOKEN', lang: 'en', kind: 'asr', fmt: 'json3' });
  assert.deepEqual(q(trackUrl(own, { lang: 'en', kind: 'manual' })), { v: 'abcdefghijk', pot: 'TOKEN', lang: 'en', fmt: 'json3' });
});

test('with several audio tracks the captions sent are the original audio ones, not a dub ones', () => {
  const tracks = [{ languageCode: 'es', kind: 'asr' }, { languageCode: 'en', kind: 'asr' }];
  const audio = [{ audioTrackId: 'es.10', captionTrackIndices: [0] }, { audioTrackId: 'en.4', captionTrackIndices: [1] }];
  assert.deepEqual(originalCaptions(tracks, audio), [tracks[1]]);
  assert.deepEqual(originalCaptions(tracks, [{ audioTrackId: 'en.4' }]), tracks); // not told: all of them
  assert.deepEqual(originalCaptions(tracks, []), tracks);
});
