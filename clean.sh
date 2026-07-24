#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/src-tauri"

echo "Limpando artefatos de compilação (src-tauri/target)..."
cargo clean

echo "Limpeza concluída com sucesso!"
