#!/bin/bash
# Neuron engine into apps/lms/public/neuron-engine/ (see fetch-engine.sh). The pinned sha256 is the archive the app is tested against;
# bump it with every engine rebuild.
export ENGINE_APP=neuron
export ENGINE_PINNED_SHA256="5284797e261ee579951e92552ec9497488a683133a05c22559fe9356ed88be65"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
