#!/bin/bash
# Run the screens suite's BROWSER projects (Safari phone/tablet/desktop, Firefox, Chrome, Edge) inside the Playwright
# image, against a production build already served on the host:
#   BASE_URL=http://127.0.0.1:<port> tools/e2e-browsers.sh [extra playwright args]
# PW_BROWSERS defaults to all; PW_PROJECTS="desktop-webkit desktop-firefox" narrows the projects. Needs docker. Uses the repo's node_modules (same Playwright version as the image).
set -euo pipefail
cd "$(dirname "$0")/.."
img=pf-e2e-browsers:1.59.1
docker image inspect "$img" >/dev/null 2>&1 || docker build -q -t "$img" -f tools/e2e-browsers.Dockerfile tools
projects=()
for p in ${PW_PROJECTS:-phone-webkit tablet-webkit desktop-webkit desktop-firefox desktop-chrome desktop-edge}; do projects+=("--project=$p"); done
# A git worktree usually borrows node_modules from the main checkout: node_modules is a symlink, or a folder of
# symlinks, pointing OUTSIDE this repo. Only $PWD is mounted at /work, so those links dangle in the container
# ("exec ./node_modules/.bin/playwright failed: No such file or directory"). Mount every outside target read-only
# at its own absolute path so the links resolve the same way inside.
mounts=(); seen=" "
add_mount() { case "$seen" in *" $1 "*) return;; esac; seen="$seen$1 "; mounts+=(-v "$1:$1:ro"); }
nm="$PWD/node_modules"
if [ -L "$nm" ]; then
  add_mount "$(readlink -f "$nm")"
elif [ -d "$nm" ]; then
  for e in "$nm"/* "$nm"/.bin; do
    [ -L "$e" ] || continue
    t="$(readlink -f "$e")"
    case "$t" in "$PWD"/*) ;; *) add_mount "$(dirname "$t")";; esac
  done
fi
exec docker run --rm --network host --ipc host --init --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE_URL="${BASE_URL:?set BASE_URL}" -e PW_BROWSERS="${PW_BROWSERS:-all}" -e PW_WORKERS="${PW_WORKERS:-4}" \
  -e SHOTS_DIR="${SHOTS_DIR:-/work/test-results/shots}" -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$PWD:/work" ${mounts[@]+"${mounts[@]}"} -w /work "$img" \
  ./node_modules/.bin/playwright test --config=apps/lms-e2e/playwright.screens.config.ts "${projects[@]}" "$@"
