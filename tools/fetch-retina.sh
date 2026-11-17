#!/bin/bash
# Retina engine into apps/lms/public/retina-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive retina-web-<version>.tar.gz (now 1.2.0). Override for a one-off with RETINA_SHA256.
export ENGINE_APP=retina
export ENGINE_PINNED_SHA256="481f7580ab19efbe187100579329e09b9ff412e8bc9bc1d89e8b46efc26d3c0c"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
