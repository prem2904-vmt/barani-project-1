#!/bin/bash
# Myelin engine into apps/lms/public/myelin-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive myelin-web-<version>.tar.gz (now 1.1.0). Override for a one-off with MYELIN_SHA256.
export ENGINE_APP=myelin
export ENGINE_PINNED_SHA256="c4bb87b301b696fbf5f863f353f29f5dcf19dfd438ca8e7a22fd53ab3fa6eab7"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
