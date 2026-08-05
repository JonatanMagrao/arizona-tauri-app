$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

& (Join-Path $PSScriptRoot "signature-parser.ps1")
& (Join-Path $PSScriptRoot "zip-safety.ps1")
& (Join-Path $PSScriptRoot "content-signature.ps1")
& (Join-Path $PSScriptRoot "collect-artifacts.ps1")
& (Join-Path $PSScriptRoot "install-lifecycle.ps1")
& (Join-Path $PSScriptRoot "release-gates.ps1")
& (Join-Path $PSScriptRoot "test-nsis-hooks.ps1")

Write-Host "All installer tests passed."
