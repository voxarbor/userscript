#!/bin/sh
# Everything CI checks, in its order: the types generated from the server's script API are up to date, the types
# hold, the UI is built with DOM calls only, the build works and the tests pass. Stops at the first failure.
set -eu
cd "$(dirname "$0")"
step() { printf '\n== %s\n' "$*"; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

[ -d node_modules ] && [ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --no-audit --no-fund --loglevel=error

step "API types match api/script-openapi.json (the server's script API)"
cp src/api/schema.d.ts "$tmp/"
npm run -s schema > /dev/null
cmp "$tmp/schema.d.ts" src/api/schema.d.ts

step "types"
npx tsc --noEmit

step "the UI is built with DOM calls only"
# YouTube's pages enforce Trusted Types: HTML from a string is refused there
if grep -rnE '\.(innerHTML|outerHTML|insertAdjacentHTML)\b' src; then
  echo "use DOM calls (el(...)), not HTML strings"; exit 1
fi

step "build"
node build.mjs
node --check dist/voxarbor.user.js

step "tests"
npx vitest run --reporter=dot

printf '\nAll checks passed.\n'
