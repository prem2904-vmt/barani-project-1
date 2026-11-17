#!/bin/bash
# Synapse engine into apps/lms/public/synapse-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive synapse-web-<version>.tar.gz (now 1.2.1). Override for a one-off with SYNAPSE_SHA256.
export ENGINE_APP=synapse
export ENGINE_PINNED_SHA256="c70fff75848a03470a7f52597942d479e4ffffbc48b021137f2dd36a08b8ad35"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
