#!/bin/bash
# Myelin engine into apps/lms/public/myelin-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive myelin-web-<version>.tar.gz (now 0.21.1). Override for a one-off with MYELIN_SHA256.
export ENGINE_APP=myelin
export ENGINE_PINNED_SHA256="4bce872bc293dbc58a7d836a2cc0b25bfa2fb353f311599de9b7367f4e92de93"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
