#!/bin/bash
# Neuron engine into apps/lms/public/neuron-engine/ (see fetch-engine.sh). The pinned sha256 is the archive the app is tested against;
# bump it with every engine rebuild.
export ENGINE_APP=neuron
export ENGINE_PINNED_SHA256="04f761e7d522ab885f8d56ff379f1afd7531a6da0be039cc820dc5bcad2e7b4e"
exec "$(dirname "$0")/fetch-engine.sh" "$@"
