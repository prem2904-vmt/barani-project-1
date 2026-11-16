#!/bin/bash
# Neuron engine into apps/lms/public/neuron-engine/ (see fetch-engine.sh). The pinned sha256 is the archive the app is tested against;
# bump it with every engine rebuild.
export ENGINE_APP=neuron
export ENGINE_PINNED_SHA256="f06d22e398e23e2c38797c2bb598b820dd9434216b41324a7e6dd0dbd53e199c"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
