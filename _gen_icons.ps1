$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Gera todos os ícones do bundle (png, ico, icns, Store/Android/iOS) a partir do SVG da raiz.
$sourcePath = Join-Path $PSScriptRoot 'circle-check-solid-full.svg'
if (-not (Test-Path $sourcePath)) {
    throw "Ícone fonte não encontrado em $sourcePath"
}

Write-Host "Gerando ícones a partir de $sourcePath..."
cargo tauri icon $sourcePath -o (Join-Path $PSScriptRoot 'src-tauri\icons')
if ($LASTEXITCODE -ne 0) { throw "cargo tauri icon falhou ($LASTEXITCODE)" }
Write-Host "Done."
