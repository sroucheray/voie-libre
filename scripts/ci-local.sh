#!/usr/bin/env bash
# Runs on this machine the same checks as the `check` job of .github/workflows/ci.yml,
# in the same order: lint, build, test, then the generated API client must not change.
# Run it before pushing a branch or a tag (the pre-push hook in .githooks does).
#
# What is the same as in CI: the commands (`npm run lint | build | test`), no Nx cache
# (CI starts with an empty one), `CI=true`, and the integration tests that need a
# database or BRouter stay skipped (their environment variables are removed).
# What cannot be the same: the machine (CI is slower and more loaded, which is where
# timing-dependent tests have failed) and Node (CI uses 24; a warning says if this
# machine differs). `npm ci` is not run: it would wipe node_modules under a running
# dev server, and `npm ci --dry-run` disagrees with the npm of CI about optional peers
# (npm 10 here, 11 there), so the lockfile is checked by CI only.
#
# Light on the machine: low priority, one Nx task at a time.
set -euo pipefail

cd "$(dirname "$0")/.."

CI_NODE_MAJOR=24
export CI=true
export NX_SKIP_NX_CACHE=true
export NX_PARALLEL=1
unset DATABASE_INTEGRATION BROUTER_INTEGRATION DATABASE_URL

step() { printf '\n==> %s\n' "$1"; }
low() { nice -n 19 "$@"; }

# CI checks out the commit and nothing else: files changed or not yet committed here
# would be tested but never pushed (or the other way round).
if [ -n "$(git status --porcelain)" ]; then
  echo "error: the working tree is not clean; commit or stash first so that what is checked is what is pushed" >&2
  git status --short >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" != "$CI_NODE_MAJOR" ]; then
  echo "warning: Node $(node -v) here, CI uses Node $CI_NODE_MAJOR" >&2
fi

step "Lint"
low npm run lint

step "Build"
low npm run build

step "Test"
low npm test

step "Generated API client is up to date"
low npm run generate-client
if ! git diff --exit-code -- packages/api-client; then
  echo "error: npm run generate-client changed packages/api-client; commit the result" >&2
  exit 1
fi

printf '\nAll the checks of CI passed.\n'
