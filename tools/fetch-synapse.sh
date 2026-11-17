#!/bin/bash
# Synapse engine into apps/lms/public/synapse-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive synapse-web-<version>.tar.gz (now 1.2.1). Override for a one-off with SYNAPSE_SHA256.
export ENGINE_APP=synapse
export ENGINE_PINNED_SHA256="36d7a641a410b2abff14b21256f0f1c49477947b9f63dd7324b956bffd7eaca0"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
