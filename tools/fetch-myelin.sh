#!/bin/bash
# Myelin engine into apps/lms/public/myelin-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive myelin-web-<version>.tar.gz (now 1.2.0). Override for a one-off with MYELIN_SHA256.
export ENGINE_APP=myelin
export ENGINE_PINNED_SHA256="ba1be4537482f6fccf9d06cdc7785f5bc9ea980b6607a2b9baa376d108902a18"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
