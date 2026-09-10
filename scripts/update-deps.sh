#!/usr/bin/env bash
#
# Update dependencies while ignoring releases that are younger than
# MIN_RELEASE_AGE_DAYS (default 14).
#
# Most registry supply-chain attacks are caught and unpublished within days of
# the malicious version going live. Refusing to resolve anything newer than the
# cutoff means this repo never sees that window. Same idea as pnpm's
# `minimumReleaseAge`, built from flags npm and uv already have:
#   npm --before        https://docs.npmjs.com/cli/using-npm/config#before
#   uv  --exclude-newer https://docs.astral.sh/uv/reference/settings/#exclude-newer
#
# Usage:
#   scripts/update-deps.sh            # stay within the semver ranges in the manifests
#   scripts/update-deps.sh --latest   # also cross major versions (review the diff!)
#   MIN_RELEASE_AGE_DAYS=30 scripts/update-deps.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

export MIN_RELEASE_AGE_DAYS="${MIN_RELEASE_AGE_DAYS:-14}"
CUTOFF="$(python3 -c '
import datetime as dt, os
days = int(os.environ["MIN_RELEASE_AGE_DAYS"])
print((dt.datetime.now(dt.UTC) - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ"))
')"

echo "Minimum release age: ${MIN_RELEASE_AGE_DAYS} days (ignoring anything published after ${CUTOFF})"

echo "==> Python (uv)"
uv lock --upgrade --exclude-newer "$CUTOFF"

echo "==> Frontend (npm)"
cd frontend
if [ "${1:-}" = "--latest" ]; then
  # `npm update` will not cross a major, so ask for @latest by name. --before
  # still applies, so "latest" means latest as of the cutoff.
  # Package names never contain spaces, so plain word splitting is enough here.
  PKGS="$(node -p '
    const p = require("./package.json");
    const all = { ...p.dependencies, ...p.devDependencies };
    Object.keys(all)
      // aliased specs ("npm:other-pkg@x") pin an exact fork; @latest would undo that
      .filter((n) => !String(all[n]).startsWith("npm:"))
      .map((n) => n + "@latest")
      .join(" ");
  ')"
  # shellcheck disable=SC2086
  npm install --before "$CUTOFF" $PKGS
else
  npm update --save --before "$CUTOFF"
fi

echo "Done. Review the lockfile diff, then run the test suites."
