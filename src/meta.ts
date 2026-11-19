// The userscript header. build.mjs prints it above the bundle; the server rewrites the two URL lines and the
// __VOXARBOR_SERVER__ placeholder when it serves the file.
export const VERSION = '0.10.4';

const FIELDS: [string, string][] = [
  ['name', 'VoxArbor UA'],
  ['namespace', 'voxarbor'],
  ['version', VERSION],
  ['description', 'Ukrainian voice-over for videos via a self-hosted VoxArbor UA server'],
  ['match', '*://*.youtube.com/*'],
  ['match', '__VOXARBOR_SERVER__/panel/install*'], // «Скрипт»: connects there by itself (core/autolink.ts)
  ['grant', 'GM_xmlhttpRequest'],
  ['grant', 'GM_getValue'],
  ['grant', 'GM_setValue'],
  ['grant', 'GM_registerMenuCommand'],
  ['grant', 'GM_openInTab'],
  ['grant', 'GM_setClipboard'],
  ['connect', '*'],
  ['run-at', 'document-idle'],
  ['noframes', ''],
  ['downloadURL', '__VOXARBOR_SERVER__/voxarbor.user.js'],
  ['updateURL', '__VOXARBOR_SERVER__/voxarbor.user.js'],
];

export const header: string = [
  '// ==UserScript==',
  ...FIELDS.map(([name, value]) => `// @${name.padEnd(12)} ${value}`.trimEnd()),
  '// ==/UserScript==',
].join('\n');
