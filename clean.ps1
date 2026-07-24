$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot 'src-tauri')

Write-Host "Limpando artefatos de compilação (src-tauri/target)..." -ForegroundColor Yellow
cargo clean

Write-Host "Limpeza concluída com sucesso!" -ForegroundColor Green
