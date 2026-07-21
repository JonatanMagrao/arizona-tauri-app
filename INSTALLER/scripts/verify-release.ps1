param(
  [switch]$RequirePayload,
  [switch]$RequireSignedTauri
)

. "$PSScriptRoot\common.ps1"

$repoRoot = Get-FullPath (Join-Path $PSScriptRoot "..\..")
$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$hooksPath = Join-Path $repoRoot "INSTALLER\nsis\hooks.nsh"
$payloadRoot = Join-Path $repoRoot "INSTALLER\payload"

if (!(Test-Path -LiteralPath $tauriConfigPath -PathType Leaf)) {
  throw "Tauri config not found: $tauriConfigPath"
}

if (!(Test-Path -LiteralPath $hooksPath -PathType Leaf)) {
  throw "NSIS hooks file not found: $hooksPath"
}

$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$nsis = $tauriConfig.bundle.windows.nsis
if (!$nsis -or $nsis.installerHooks -ne "../INSTALLER/nsis/hooks.nsh") {
  throw "tauri.conf.json does not point to INSTALLER/nsis/hooks.nsh"
}

if ($tauriConfig.bundle.windows.nsis.installMode -ne "perMachine") {
  throw "NSIS installMode must be perMachine for AEX installation in Program Files."
}

if ($tauriConfig.bundle.windows.allowDowngrades -ne $false) {
  throw "bundle.windows.allowDowngrades must be false for official releases."
}

$resourceMap = $tauriConfig.bundle.resources
if (!$resourceMap) {
  throw "bundle.resources must include installer scripts and payload."
}

$resourceNames = @($resourceMap.PSObject.Properties | ForEach-Object { $_.Name })
if (!($resourceNames -contains "../INSTALLER/scripts")) {
  throw "bundle.resources must include ../INSTALLER/scripts."
}
if (!($resourceNames -contains "../INSTALLER/payload")) {
  throw "bundle.resources must include ../INSTALLER/payload."
}

if ($RequirePayload) {
  $cepPayload = Join-Path $payloadRoot "cep\com.arizona-carrefour.cep"
  $aexPayload = Join-Path $payloadRoot "aex\ArizonaBridgeTest.aex"
  $manifestPath = Join-Path $payloadRoot "release-manifest.json"

  if (!(Test-Path -LiteralPath $cepPayload -PathType Container)) {
    throw "CEP payload missing: $cepPayload"
  }
  if (!(Test-Path -LiteralPath $aexPayload -PathType Leaf)) {
    throw "AEX payload missing: $aexPayload"
  }
  if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Release manifest missing: $manifestPath"
  }
}

if ($RequireSignedTauri) {
  $exePath = Join-Path $repoRoot "src-tauri\target\release\arizona-app.exe"
  if (!(Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Tauri release exe not found: $exePath"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $exePath
  if ($signature.Status -ne "Valid") {
    throw "Tauri release exe is not signed with a valid certificate: $exePath"
  }
}

Write-Host "Release scaffolding checks passed."
