#!/bin/bash
# Retina engine into apps/lms/public/retina-engine/ (see fetch-engine.sh). The pinned sha256 is the archive the app is tested against;
# it stays "pending" until the engine exists: until then pass RETINA_SHA256 with RETINA_URL / RETINA_DIST.
export ENGINE_APP=retina
export ENGINE_PINNED_SHA256="pending"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
