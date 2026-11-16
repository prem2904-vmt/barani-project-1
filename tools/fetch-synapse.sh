#!/bin/bash
# Synapse engine into apps/lms/public/synapse-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive synapse-web-<version>.tar.gz (now 1.1.0). Override for a one-off with SYNAPSE_SHA256.
export ENGINE_APP=synapse
export ENGINE_PINNED_SHA256="541e177b0d3a36ca0f25e49f5bf8e7c1622c89ec1ebae6ae9e5d00ff47ab2f2e"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
