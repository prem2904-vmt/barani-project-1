#!/bin/bash
# Axon engine into apps/lms/public/axon-engine/ (see fetch-engine.sh). ONE line to bump with every engine rebuild: the sha256 of the
# archive axon-web-<version>.tar.gz (now 1.2.0). Override for a one-off with AXON_SHA256.
export ENGINE_APP=axon
export ENGINE_PINNED_SHA256="8cac6cf7a52ad48dc5d0dac32a55eea85a1b353a96e55678635b8362166c0879"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
