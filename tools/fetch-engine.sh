#!/bin/bash
# Put an engine's web build (a static wasm app: Neuron sheets, Synapse documents, Axon slides, Myelin PDFs, Retina images) into
# apps/lms/public/<app>-engine/ so the LMS can frame it same-origin at /<app>-engine/index.html. The folder is gitignored (the wasm is
# tens of MB); every dev / CI / deploy run fetches it. Used through the one-line wrappers fetch-<app>.sh (each holds its pinned sha256):
#
#   <APP>_DIST=<dir>                       copy a build folder (index.html + .js + _bg.wasm), or
#   <APP>_URL=<https://…/<app>-web.tar.gz> download a .zip / .tar.gz, and
#   <APP>_SHA256=<hex>                     with <APP>_URL: the checksum of the ARCHIVE (default: the wrapper's pinned sha). With <APP>_DIST it is
#                                          optional and, when set, must match the build's *_bg.wasm file.
#
#   NEURON_DIST=~/neuron-web tools/fetch-neuron.sh
#   SYNAPSE_URL=https://example.test/synapse-web-1.0.tar.gz SYNAPSE_SHA256=ab12… tools/fetch-synapse.sh
#   (a wrapper whose pinned sha is still "pending" refuses a URL download without an explicit <APP>_SHA256)
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${ENGINE_APP:?use tools/fetch-<app>.sh}"
APPU="$(echo "$APP" | tr 'a-z' 'A-Z')"
NAME="$(echo "${APP:0:1}" | tr 'a-z' 'A-Z')${APP:1}"
eval "DIST_IN=\"\${${APPU}_DIST:-}\"; URL_IN=\"\${${APPU}_URL:-}\"; SHA_IN=\"\${${APPU}_SHA256:-}\""

# The engine build this app is tested against: the sha256 of the ARCHIVE (<app>-web-<version>.tar.gz) the fork's build-web.sh produces.
# URL downloads are checked against it unless <APP>_SHA256 says otherwise. Bump it with every engine rebuild (and re-run the screens suite).
PINNED="${ENGINE_PINNED_SHA256:-pending}"

dest="apps/lms/public/${APP}-engine"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

src=""
if [ -n "$DIST_IN" ]; then
  src="${DIST_IN/#\~/$HOME}"
  [ -d "$src" ] || { echo "${APPU}_DIST is not a folder: $src" >&2; exit 1; }
elif [ -n "$URL_IN" ]; then
  SHA256="${SHA_IN:-$PINNED}"
  [ "$SHA256" != "pending" ] || { echo "$NAME has no pinned checksum yet: set ${APPU}_SHA256 (the engine's archive sha256)." >&2; exit 1; }
  arc="$work/archive"
  curl -fsSL --retry 3 -o "$arc" "$URL_IN"
  got="$(sha_of "$arc")"
  [ "$got" = "$(echo "$SHA256" | tr 'A-F' 'a-f')" ] || { echo "Checksum mismatch for $URL_IN (got $got)" >&2; exit 1; }
  mkdir -p "$work/x"
  case "$URL_IN" in
    *.zip) unzip -q "$arc" -d "$work/x" ;;
    *.tar.gz|*.tgz) tar -xzf "$arc" -C "$work/x" ;;
    *) echo "${APPU}_URL must end in .zip, .tar.gz or .tgz" >&2; exit 1 ;;
  esac
  src="$work/x"
else
  echo "Set ${APPU}_DIST=<folder> or ${APPU}_URL=<archive> with ${APPU}_SHA256." >&2
  exit 1
fi

# The build may sit one folder down (neuron-web-<version>/index.html): find the folder that holds index.html.
idx="$(find "$src" -maxdepth 3 -name index.html -print -quit)"
[ -n "$idx" ] || { echo "No index.html found under $src" >&2; exit 1; }
root="$(dirname "$idx")"
ls "$root"/*_bg.wasm >/dev/null 2>&1 || { echo "No *_bg.wasm next to index.html — not a $NAME web build" >&2; exit 1; }
if [ -n "$SHA_IN" ] && [ -n "$DIST_IN" ]; then
  wasm="$(ls "$root"/*_bg.wasm | head -n1)"
  [ "$(sha_of "$wasm")" = "$(echo "$SHA_IN" | tr 'A-F' 'a-f')" ] || { echo "${APPU}_SHA256 does not match $(basename "$wasm")" >&2; exit 1; }
fi

rm -rf "$dest"
mkdir -p "$dest"
# Only what the app needs (the page, its script + wasm, the icon, snippets/) plus the licence files. README / HOSTING and
# the sample header files are documentation for other hosts and stay out.
for f in index.html LICENSE-MIT LICENSE-APACHE NOTICE; do [ -f "$root/$f" ] && cp "$root/$f" "$dest/$f"; done
cp "$root"/*.js "$root"/*_bg.wasm "$dest"/
for f in "$root"/*.svg "$root"/*.ico; do [ -f "$f" ] && cp "$f" "$dest/"; done
[ -d "$root/snippets" ] && cp -R "$root/snippets" "$dest/snippets"
echo "$NAME build ready in $dest ($(du -sh "$dest" | cut -f1))"
