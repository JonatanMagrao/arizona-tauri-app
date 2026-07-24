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
if (!(Test-Path -LiteralPath $cepDist -PathType Container)) {
  throw "CEP build not found: $cepDist. Run npm run release:cep first."
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
New-Item -ItemType Directory -Force -Path $cepPayload | Out-Null
Copy-DirectoryContents -Source $cepDist -Destination $cepPayload

# The development build keeps CEP debugging metadata close to the symlink used
# by After Effects. The release payload must never expose DevTools or source
# maps, even when collect-artifacts is run immediately after a dev/watch build.
Get-ChildItem -LiteralPath $cepPayload -Recurse -Force -File |
  Where-Object { $_.Name -eq ".debug" -or $_.Extension -eq ".map" } |
  Remove-Item -Force

$packageJson = Get-Content -LiteralPath (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
$tauriConfig = Get-Content -LiteralPath (Join-Path $RepoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json

$manifest = [pscustomobject]@{
  schemaVersion = 2
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  appPackageVersion = $packageJson.version
  tauriVersion = $tauriConfig.version
  cepExtensionId = "com.arizona-carrefour.cep"
  cepFingerprint = Get-DirectoryFingerprint $cepPayload
  includesAfterEffectsPlugin = $false
  includesAdminApp = $false
}

$manifestPath = Join-Path $payloadRootFull "release-manifest.json"
Write-JsonFileAtomic -Path $manifestPath -Value $manifest
Write-InstallerLog "Collected CEP-only installer payload at $payloadRootFull"
