#!/usr/bin/env bash
# Arma la carpeta lista para subir al Space de Hugging Face (copia el código del worker).
#   bash infra/huggingface-worker/prepare_space.sh  →  crea ./hf-space/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/hf-space}"
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$ROOT/infra/huggingface-worker/README.md" "$ROOT/infra/huggingface-worker/Dockerfile" "$OUT/"
cp "$ROOT/services/api/requirements.txt" "$ROOT/services/api/requirements-worker.txt" "$OUT/"
cp -r "$ROOT/services/api/app" "$OUT/app"
find "$OUT" -name "__pycache__" -prune -exec rm -rf {} +
echo "Listo: $OUT  (súbelo al Space con git o arrastrando los archivos)"
