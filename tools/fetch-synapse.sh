#!/bin/bash
# Synapse engine into apps/lms/public/synapse-engine/ (see fetch-engine.sh). The pinned sha256 is the archive the app is tested against;
# it stays "pending" until the engine exists: until then pass SYNAPSE_SHA256 with SYNAPSE_URL / SYNAPSE_DIST.
export ENGINE_APP=synapse
export ENGINE_PINNED_SHA256="pending"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
