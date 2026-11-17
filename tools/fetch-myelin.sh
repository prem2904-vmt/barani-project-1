#!/bin/bash
# Myelin engine into apps/lms/public/myelin-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive myelin-web-<version>.tar.gz (now 1.2.1). Override for a one-off with MYELIN_SHA256.
export ENGINE_APP=myelin
export ENGINE_PINNED_SHA256="7f153bf6e44738c4967aed02f961e9b3c9e485f6a71d0df16d853e4bc24ef08e"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
