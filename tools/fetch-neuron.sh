#!/bin/bash
# Neuron engine into apps/lms/public/neuron-engine/ (see fetch-engine.sh). The pinned sha256 is the archive the app is tested against;
# bump it with every engine rebuild.
export ENGINE_APP=neuron
export ENGINE_PINNED_SHA256="843db958ed94ac8337e5fee6f23f8ab031fed77e2433ace611de402dc00ba3d4"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
