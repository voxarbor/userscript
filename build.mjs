// Builds dist/voxarbor.user.js: the userscript header (src/meta.ts) above one strict-mode closure with
// everything src/main.ts pulls in. Not minified: the file the server serves stays reviewable.
import { Buffer } from 'node:buffer';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const shared = { bundle: true, charset: 'utf8', target: 'es2020', logLevel: 'warning', absWorkingDir: root };

const meta = await build({ ...shared, entryPoints: ['src/meta.ts'], format: 'esm', write: false });
const { header } = await import('data:text/javascript;base64,' + Buffer.from(meta.outputFiles[0].text).toString('base64'));

const out = join(root, 'dist', 'voxarbor.user.js');
await build({
  ...shared,
  entryPoints: ['src/main.ts'],
  outfile: out,
  format: 'iife',
  minify: false,
  legalComments: 'none',
  banner: { js: header + '\n' },
});
console.log(`built dist/voxarbor.user.js (${statSync(out).size} bytes)`);
