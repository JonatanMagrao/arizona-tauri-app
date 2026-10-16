param(
  [Parameter(Mandatory = $true)][string]$InstallerRoot,
  [Parameter(Mandatory = $true)][string]$TargetPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
  . (Join-Path $PSScriptRoot 'common.ps1')
  . (Join-Path $PSScriptRoot 'cep-system-update-core.ps1')
  . (Join-Path $PSScriptRoot 'verify-full-cep-commit-core.ps1')
  Invoke-VerifyFullCepCommit -InstallerRoot $InstallerRoot -TargetPath $TargetPath | Out-Null
  Write-Output 'FULL CEP commit verified'
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
