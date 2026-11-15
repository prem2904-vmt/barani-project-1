#!/bin/bash
# Axon engine into apps/lms/public/axon-engine/ (see fetch-engine.sh). The pinned sha256 is the archive the app is tested against;
# it stays "pending" until the engine exists: until then pass AXON_SHA256 with AXON_URL / AXON_DIST.
export ENGINE_APP=axon
export ENGINE_PINNED_SHA256="pending"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
