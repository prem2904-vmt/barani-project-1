#!/bin/bash
# Axon engine into apps/lms/public/axon-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive axon-web-<version>.tar.gz (now 0.18.1). Override for a one-off with AXON_SHA256.
export ENGINE_APP=axon
export ENGINE_PINNED_SHA256="13ef54c2bbb1bfcfea092178baff9b59166a613b2c5fb9194577514662f87e9f"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
