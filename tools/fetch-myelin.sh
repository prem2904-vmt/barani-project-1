#!/bin/bash
# Myelin engine into apps/lms/public/myelin-engine/ (see fetch-engine.sh). The pinned sha256 is the archive the app is tested against;
# it stays "pending" until the engine exists: until then pass MYELIN_SHA256 with MYELIN_URL / MYELIN_DIST.
export ENGINE_APP=myelin
export ENGINE_PINNED_SHA256="pending"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
