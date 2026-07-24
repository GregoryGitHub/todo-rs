#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Iniciando Build de Release para Linux ==="

if ! command -v cargo-tauri &> /dev/null && ! cargo tauri --version &> /dev/null; then
    echo "Instalando tauri-cli..."
    cargo install tauri-cli --version '^2.0' --locked
fi

echo "Executando cargo tauri build..."
cargo tauri build

echo ""
echo "=== Build para Linux concluído com sucesso! ==="
echo "Arquivos e empacotamento gerados em: src-tauri/target/release/bundle/"
