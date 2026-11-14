#!/bin/bash
# Run the screens suite's BROWSER projects (Safari phone/tablet/desktop, Firefox, Chrome, Edge) inside the Playwright
# image, against a production build already served on the host:
#   BASE_URL=http://127.0.0.1:<port> tools/e2e-browsers.sh [extra playwright args]
# PW_BROWSERS defaults to all. Needs docker. Uses the repo's node_modules (same Playwright version as the image).
set -euo pipefail
cd "$(dirname "$0")/.."
img=pf-e2e-browsers:1.59.1
docker image inspect "$img" >/dev/null 2>&1 || docker build -q -t "$img" -f tools/e2e-browsers.Dockerfile tools
projects=()
for p in phone-webkit tablet-webkit desktop-webkit desktop-firefox desktop-chrome desktop-edge; do projects+=("--project=$p"); done
exec docker run --rm --network host --ipc host --init --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE_URL="${BASE_URL:?set BASE_URL}" -e PW_BROWSERS="${PW_BROWSERS:-all}" -e PW_WORKERS="${PW_WORKERS:-4}" \
  -e SHOTS_DIR="${SHOTS_DIR:-/work/test-results/shots}" -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$PWD:/work" -w /work "$img" \
  ./node_modules/.bin/playwright test --config=apps/lms-e2e/playwright.screens.config.ts "${projects[@]}" "$@"
