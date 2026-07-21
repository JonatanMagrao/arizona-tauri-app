param(
  [string]$RepoRoot = "",
  [string]$PayloadRoot = ""
)

. "$PSScriptRoot\common.ps1"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = Get-FullPath (Join-Path $PSScriptRoot "..\..")
}

if ([string]::IsNullOrWhiteSpace($PayloadRoot)) {
  $PayloadRoot = Join-Path $RepoRoot "INSTALLER\payload"
}

$cepDist = Join-Path $RepoRoot "ARIZONA-EXTENSION\dist\cep"
$aexFile = Join-Path $RepoRoot "AE-PLUGIN-ARIZONA\plugin\ArizonaBridgeTest.aex"

if (!(Test-Path -LiteralPath $cepDist -PathType Container)) {
  throw "CEP build not found: $cepDist. Run npm run release:cep first."
}

if (!(Test-Path -LiteralPath $aexFile -PathType Leaf)) {
  throw "AEX build not found: $aexFile. Run npm run release:aex first."
}

$payloadRootFull = Get-FullPath $PayloadRoot
Assert-PathInside -Path $payloadRootFull -Parent (Join-Path $RepoRoot "INSTALLER") -Label "payload root"

New-Item -ItemType Directory -Force -Path $payloadRootFull | Out-Null

foreach ($child in @("cep", "aex", "release-manifest.json")) {
  $path = Join-Path $payloadRootFull $child
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

$cepPayload = Join-Path $payloadRootFull "cep\com.arizona-carrefour.cep"
$aexPayload = Join-Path $payloadRootFull "aex"
New-Item -ItemType Directory -Force -Path $cepPayload | Out-Null
New-Item -ItemType Directory -Force -Path $aexPayload | Out-Null

Copy-DirectoryContents -Source $cepDist -Destination $cepPayload
Copy-Item -LiteralPath $aexFile -Destination (Join-Path $aexPayload "ArizonaBridgeTest.aex") -Force

$packageJson = Get-Content -LiteralPath (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
$tauriConfig = Get-Content -LiteralPath (Join-Path $RepoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$bridgePublicKey = Get-Content -LiteralPath (Join-Path $RepoRoot "ADMIN\supabase\aex-bridge-token-public-key.v1.json") -Raw | ConvertFrom-Json

$manifest = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  appPackageVersion = $packageJson.version
  tauriVersion = $tauriConfig.version
  cepFingerprint = Get-DirectoryFingerprint $cepPayload
  aexSha256 = Get-FileSha256 (Join-Path $aexPayload "ArizonaBridgeTest.aex")
  aexBridgeKeyId = $bridgePublicKey.kid
  includesAdminApp = $false
}

$manifestPath = Join-Path $payloadRootFull "release-manifest.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-InstallerLog "Collected installer payload at $payloadRootFull"
