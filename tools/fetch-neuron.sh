#!/bin/bash
# Put a Neuron web build (the static spreadsheet engine) into apps/lms/public/neuron-engine/ so the LMS can frame it
# same-origin at /neuron-engine/index.html. The folder is gitignored (the wasm is ~26 MB); every dev / CI / deploy run fetches it.
#
#   NEURON_DIST=<dir>                      copy a build folder (index.html + .js + _bg.wasm), or
#   NEURON_URL=<https://…/neuron-web.zip>  download a .zip / .tar.gz, and
#   NEURON_SHA256=<hex>                    REQUIRED with NEURON_URL (the pinned checksum of the ARCHIVE). With NEURON_DIST it is
#                                          optional and, when set, must match the build's *_bg.wasm file.
#
#   NEURON_DIST=~/neuron-web tools/fetch-neuron.sh
#   NEURON_URL=https://example.test/neuron-web-1.0.zip NEURON_SHA256=ab12… tools/fetch-neuron.sh
set -euo pipefail
cd "$(dirname "$0")/.."
dest="apps/lms/public/neuron-engine"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

src=""
if [ -n "${NEURON_DIST:-}" ]; then
  src="${NEURON_DIST/#\~/$HOME}"
  [ -d "$src" ] || { echo "NEURON_DIST is not a folder: $src" >&2; exit 1; }
elif [ -n "${NEURON_URL:-}" ]; then
  : "${NEURON_SHA256:?NEURON_SHA256 is required with NEURON_URL (pin the archive checksum)}"
  arc="$work/archive"
  curl -fsSL --retry 3 -o "$arc" "$NEURON_URL"
  got="$(sha_of "$arc")"
  [ "$got" = "$(echo "$NEURON_SHA256" | tr 'A-F' 'a-f')" ] || { echo "Checksum mismatch for $NEURON_URL (got $got)" >&2; exit 1; }
  mkdir -p "$work/x"
  case "$NEURON_URL" in
    *.zip) unzip -q "$arc" -d "$work/x" ;;
    *.tar.gz|*.tgz) tar -xzf "$arc" -C "$work/x" ;;
    *) echo "NEURON_URL must end in .zip, .tar.gz or .tgz" >&2; exit 1 ;;
  esac
  src="$work/x"
else
  echo "Set NEURON_DIST=<folder> or NEURON_URL=<archive> with NEURON_SHA256." >&2
  exit 1
fi

# The build may sit one folder down (neuron-web-<version>/index.html): find the folder that holds index.html.
idx="$(find "$src" -maxdepth 3 -name index.html -print -quit)"
[ -n "$idx" ] || { echo "No index.html found under $src" >&2; exit 1; }
root="$(dirname "$idx")"
ls "$root"/*_bg.wasm >/dev/null 2>&1 || { echo "No *_bg.wasm next to index.html — not a Neuron web build" >&2; exit 1; }
if [ -n "${NEURON_SHA256:-}" ] && [ -n "${NEURON_DIST:-}" ]; then
  wasm="$(ls "$root"/*_bg.wasm | head -n1)"
  [ "$(sha_of "$wasm")" = "$(echo "$NEURON_SHA256" | tr 'A-F' 'a-f')" ] || { echo "NEURON_SHA256 does not match $(basename "$wasm")" >&2; exit 1; }
fi

rm -rf "$dest"
mkdir -p "$dest"
# Only what the app needs (the page, its script + wasm, the icon, snippets/) plus the licence files. README / HOSTING and
# the sample header files are documentation for other hosts and stay out.
for f in index.html LICENSE-MIT LICENSE-APACHE NOTICE; do [ -f "$root/$f" ] && cp "$root/$f" "$dest/$f"; done
cp "$root"/*.js "$root"/*_bg.wasm "$dest"/
for f in "$root"/*.svg "$root"/*.ico; do [ -f "$f" ] && cp "$f" "$dest/"; done
[ -d "$root/snippets" ] && cp -R "$root/snippets" "$dest/snippets"
echo "Neuron build ready in $dest ($(du -sh "$dest" | cut -f1))"
