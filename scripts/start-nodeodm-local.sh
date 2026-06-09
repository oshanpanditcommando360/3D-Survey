#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$(pwd)/storage/nodeodm"

docker run --rm \
  --name 3d-survey-nodeodm \
  -p 3000:3000 \
  -v "$(pwd)/storage/nodeodm:/var/www/data" \
  opendronemap/nodeodm
