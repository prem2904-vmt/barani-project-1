#!/bin/bash
# Axon engine into apps/lms/public/axon-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive axon-web-<version>.tar.gz (now 1.1.0). Override for a one-off with AXON_SHA256.
export ENGINE_APP=axon
export ENGINE_PINNED_SHA256="b023a090b0eb2e3084a3c0e106497dfde9a9e95e7a991a7cfc8c92049da1ca77"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
