#!/bin/bash
# Synapse engine into apps/lms/public/synapse-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive synapse-web-<version>.tar.gz (now 0.18.1). Override for a one-off with SYNAPSE_SHA256.
export ENGINE_APP=synapse
export ENGINE_PINNED_SHA256="bed9da17aa055ad10b4b1ab9e5038f69084a21080eb74e64017cadb275ea131c"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
