#!/bin/bash
# Retina engine into apps/lms/public/retina-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive retina-web-<version>.tar.gz (now 0.23.1). Override for a one-off with RETINA_SHA256.
export ENGINE_APP=retina
export ENGINE_PINNED_SHA256="d394d45f8a962b79ffb9f942dbae3b17323cab63eac5eb6397944ebde02c0304"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
