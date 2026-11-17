#!/bin/bash
# Axon engine into apps/lms/public/axon-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive axon-web-<version>.tar.gz (now 1.2.1). Override for a one-off with AXON_SHA256.
export ENGINE_APP=axon
export ENGINE_PINNED_SHA256="7fd0efbf8000398ee21ef49839e6ad85d2ddeafdc24eca0a3e744d686a2e4622"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
