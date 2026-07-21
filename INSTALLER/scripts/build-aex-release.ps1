param(
  [string]$RepoRoot = "",
  [string]$TauriCertSha256 = $env:ARIZONA_TAURI_CERT_SHA256
)

. "$PSScriptRoot\common.ps1"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = Get-FullPath (Join-Path $PSScriptRoot "..\..")
}

if ([string]::IsNullOrWhiteSpace($TauriCertSha256)) {
  throw "ARIZONA_TAURI_CERT_SHA256 is required to build AEX Release."
}

$keyPath = Join-Path $RepoRoot "ADMIN\supabase\aex-bridge-token-public-key.v1.json"
if (!(Test-Path -LiteralPath $keyPath -PathType Leaf)) {
  throw "AEX bridge public key not found: $keyPath"
}

$key = Get-Content -LiteralPath $keyPath -Raw | ConvertFrom-Json
$env:ARIZONA_TAURI_CERT_SHA256 = $TauriCertSha256
$env:ARIZONA_AEX_JWT_ES256_PUBLIC_X = $key.x
$env:ARIZONA_AEX_JWT_ES256_PUBLIC_Y = $key.y
$env:ARIZONA_AEX_JWT_KID = $key.kid

$buildScript = Join-Path $RepoRoot "AE-PLUGIN-ARIZONA\sample\Win\build.ps1"
if (!(Test-Path -LiteralPath $buildScript -PathType Leaf)) {
  throw "AEX build script not found: $buildScript"
}

& $buildScript -Configuration Release
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
