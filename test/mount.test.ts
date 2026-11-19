import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

import { Controls } from '../src/adapters/youtube/mount';
import { fake, type FakeElement, installDom } from './fake_dom';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const BAR = '#movie_player .ytp-right-controls:not([data-vot])';
const TOP = '#player-control-container .player-controls-top';
const SHORT_TOP = 'ytd-shorts-player-controls #right-controls';

/** A YouTube page with both of its players, as the desktop site keeps them once each was shown: the one that is
 *  not the page's stays in the document, hidden. */
function youtube(pathname: string) {
  vi.useFakeTimers(); // a capsule over a player hides itself after a while
  const doc = installDom();
  const where = { pathname };
  vi.stubGlobal('location', where);
  const make = (...kids: FakeElement[]): FakeElement => {
    const e = doc.createElement('div');
    e.append(...kids);
    return e;
  };
  const bar = make(); // YouTube's own right controls
  const chrome = make(bar);
  const watchPlayer = make(chrome);
  const shortsPlayer = make();
  doc.body.append(watchPlayer, shortsPlayer);
  doc.found[BAR] = bar;
  const controls = new Controls(() => (where.pathname.startsWith('/shorts/') ? shortsPlayer : watchPlayer) as unknown as HTMLElement);
  const buttons = [doc.createElement('button'), doc.createElement('button')];
  const mount = () => controls.mount(buttons as unknown as HTMLElement[]);
  /** The capsule the buttons are in. */
  const capsule = () => fake(buttons[0]!.parentElement);
  return { doc, where, bar, chrome, watchPlayer, shortsPlayer, controls, buttons, mount, capsule };
}

test('a video\'s page on a computer: the buttons are in the player\'s bar, before YouTube\'s right controls', () => {
  const { bar, chrome, controls, buttons, mount, capsule } = youtube('/watch');
  mount();
  assert.deepEqual(chrome.children, [capsule(), bar]);
  assert.equal(capsule().dataset.vot, 'bar');
  assert.deepEqual(capsule().children, buttons);
  assert.equal(controls.wantsRemount(), false);
});

test('from a video to a short and back without a load: the buttons go to the player that is shown', () => {
  const { where, chrome, bar, shortsPlayer, controls, buttons, mount, capsule } = youtube('/watch');
  mount();
  where.pathname = '/shorts/abc'; // the video's player stays in the page, hidden, with the buttons in it
  assert.equal(controls.wantsRemount(), true);
  mount();
  assert.deepEqual([capsule().parentElement, capsule().dataset.vot], [shortsPlayer, 'overlay']);
  assert.equal(controls.panelAtTop(), false); // a short without YouTube's row (a phone): the quick settings stay where they were
  assert.deepEqual(chrome.children, [bar]); // nothing of ours is left in the hidden player
  assert.equal(controls.wantsRemount(), false);

  where.pathname = '/watch'; // and back: now the short's player is the hidden one
  assert.equal(controls.wantsRemount(), true);
  mount();
  assert.deepEqual(chrome.children, [capsule(), bar]);
  assert.deepEqual(shortsPlayer.children, []);
  assert.deepEqual(capsule().children, buttons);
  assert.equal(controls.wantsRemount(), false);
});

test('a short on a computer: the buttons are in YouTube\'s own row over the player, before its buttons', () => {
  // seen on youtube.com: that row lies over the player's top right corner, where the capsule was, and took its clicks
  const { doc, where, chrome, bar, shortsPlayer, controls, buttons, mount, capsule } = youtube('/watch');
  const row = doc.createElement('div');
  const menu = doc.createElement('div');
  row.append(menu);
  doc.body.append(row);
  doc.found[SHORT_TOP] = row;
  mount();
  assert.equal(capsule().dataset.vot, 'bar'); // a video's page does not look at the shorts' row
  where.pathname = '/shorts/abc';
  assert.equal(controls.wantsRemount(), true);
  mount();
  assert.deepEqual([row.children, capsule().dataset.vot], [[capsule(), menu], 'top']);
  assert.deepEqual([chrome.children, shortsPlayer.children], [[bar], []]);
  assert.deepEqual(buttons.map((b) => [b.style.width, b.style.height, b.style.background]), Array(2).fill(['48px', '48px', 'transparent']));
  assert.equal(capsule().style.pointerEvents, 'auto'); // the row itself takes no presses (seen: ours fell through to the video)
  assert.equal(controls.wantsRemount(), false);
  assert.equal(controls.panelAtTop(), true); // the short's name and channel lie over the player's bottom
  where.pathname = '/watch';
  mount();
  assert.deepEqual([chrome.children, row.children], [[capsule(), bar], [menu]]);
  assert.equal(controls.panelAtTop(), false);
});

test('a phone: the buttons wait in a capsule over the player and move into the top row once the page has it', () => {
  const { doc, watchPlayer, controls, mount, capsule } = youtube('/watch');
  doc.found[BAR] = null; // m.youtube.com has no such bar
  mount();
  assert.deepEqual([capsule().parentElement, capsule().dataset.vot], [watchPlayer, 'overlay']);
  assert.equal(controls.wantsRemount(), false);
  const top = doc.createElement('div');
  top.append(doc.createElement('button'));
  doc.body.append(top);
  doc.found[TOP] = top;
  assert.equal(controls.wantsRemount(), true);
  mount();
  assert.deepEqual([top.children[0], capsule().dataset.vot], [capsule(), 'top']);
  assert.equal(controls.wantsRemount(), false);
});

test('nothing mounted yet: nothing to move', () => {
  assert.equal(youtube('/watch').controls.wantsRemount(), false);
});
