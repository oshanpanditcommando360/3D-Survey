#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$(pwd)/storage/nodeodm"

docker run --rm \
  --name 3d-survey-nodeodm \
  -p "${NODEODM_PORT:-3001}:3000" \
  -v "$(pwd)/storage/nodeodm:/var/www/data" \
  opendronemap/nodeodm
