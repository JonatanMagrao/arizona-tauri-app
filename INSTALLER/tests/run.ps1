$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

& (Join-Path $PSScriptRoot "install-lifecycle.ps1")
& (Join-Path $PSScriptRoot "test-nsis-hooks.ps1")

Write-Host "All installer tests passed."
