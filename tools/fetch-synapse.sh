#!/bin/bash
# Synapse engine into apps/lms/public/synapse-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive synapse-web-<version>.tar.gz (now 1.2.0). Override for a one-off with SYNAPSE_SHA256.
export ENGINE_APP=synapse
export ENGINE_PINNED_SHA256="7695f91398d81e83149626a426ae27cc59bef42ef73f56e65701a51af3178cb8"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
