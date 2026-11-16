#!/bin/bash
# Retina engine into apps/lms/public/retina-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive retina-web-<version>.tar.gz (now 1.1.0). Override for a one-off with RETINA_SHA256.
export ENGINE_APP=retina
export ENGINE_PINNED_SHA256="52f88a6ee886d59b864bed572a7232b474ec528f40d4fbdf8227b1648d92a2a5"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
