param(
  [switch]$RequirePayload,
  [switch]$RequireSignedTauri
)

. "$PSScriptRoot\common.ps1"

$repoRoot = Get-FullPath (Join-Path $PSScriptRoot "..\..")
$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$hooksPath = Join-Path $repoRoot "INSTALLER\nsis\hooks.nsh"
$payloadRoot = Join-Path $repoRoot "INSTALLER\payload"
$embeddedScriptPath = Join-Path $repoRoot "src-tauri\src\after_effects\arizona_actions.jsx"
$afterEffectsModulePath = Join-Path $repoRoot "src-tauri\src\after_effects.rs"
$tauriBuildScriptPath = Join-Path $repoRoot "src-tauri\build.rs"

if (!(Test-Path -LiteralPath $tauriConfigPath -PathType Leaf)) {
  throw "Tauri config not found: $tauriConfigPath"
}
if (!(Test-Path -LiteralPath $hooksPath -PathType Leaf)) {
  throw "NSIS hooks file not found: $hooksPath"
}
if (!(Test-Path -LiteralPath $embeddedScriptPath -PathType Leaf)) {
  throw "Embedded After Effects JSX not found: $embeddedScriptPath"
}
if (!(Test-Path -LiteralPath $afterEffectsModulePath -PathType Leaf)) {
  throw "Tauri After Effects runner not found: $afterEffectsModulePath"
}
if (!(Test-Path -LiteralPath $tauriBuildScriptPath -PathType Leaf)) {
  throw "Tauri build script not found: $tauriBuildScriptPath"
}
if (Test-Path -LiteralPath (Join-Path $repoRoot "src-tauri\src\aegp_bridge.rs")) {
  throw "The retired AEX named-pipe bridge must not be part of the Tauri source."
}

$afterEffectsModule = Get-Content -LiteralPath $afterEffectsModulePath -Raw
if (!$afterEffectsModule.Contains('include_str!("after_effects/arizona_actions.jsx")') -or
    !$afterEffectsModule.Contains("after-effects-jsxbin") -or
    !$afterEffectsModule.Contains('.arg("-r")')) {
  throw "The Tauri After Effects runner must use readable JSX in dev, JSXBIN in release, and AfterFX -r."
}

$tauriBuildScript = Get-Content -LiteralPath $tauriBuildScriptPath -Raw
if (!$tauriBuildScript.Contains('env::var("PROFILE").as_deref() == Ok("release")') -or
    !$tauriBuildScript.Contains("build-after-effects-jsxbin.mjs")) {
  throw "The release build must generate the embedded After Effects JSXBIN assets."
}

$hooks = Get-Content -LiteralPath $hooksPath -Raw
foreach ($requiredHookText in @(
  "NSIS_HOOK_PREINSTALL",
  "NSIS_HOOK_POSTINSTALL",
  "NSIS_HOOK_PREUNINSTALL",
  "ARIZONA_LEGACY_UNINSTALL_KEY",
  'ReadRegStr $R8 HKCU "${ARIZONA_LEGACY_UNINSTALL_KEY}" "DisplayName"',
  'ReadRegStr $R9 HKCU "${ARIZONA_LEGACY_UNINSTALL_KEY}" "Publisher"',
  '$LOCALAPPDATA\${ARIZONA_LEGACY_PRODUCT_NAME}',
  '"$R6\uninstall.exe" /S /UPDATE _?=$R6',
  'DeleteRegKey HKCU "${ARIZONA_LEGACY_UNINSTALL_KEY}"',
  'SetShellVarContext current',
  "Arizona stopped before installing a second copy.",
  '!define ARIZONA_INSTALLER_ROOT "$INSTDIR\installer"',
  '!define ARIZONA_PAYLOAD_ROOT "$INSTDIR\installer\payload"',
  '!define ARIZONA_SCRIPT_ROOT "$INSTDIR\installer\scripts"',
  "--release-device-for-uninstall",
  "--clear-local-auth-for-uninstall",
  "nsExec::ExecToStack",
  "-WindowStyle Hidden",
  "Online device release was unavailable",
  'DeleteRegKey HKLM "Software\Classes\arizona"',
  "-PreflightOnly",
  "uninstall-adobe-assets.ps1",
  "arizona_uninstall_adobe_abort"
)) {
  if (!$hooks.Contains($requiredHookText)) {
    throw "NSIS hooks are missing required install/uninstall guard: $requiredHookText"
  }
}

if ($hooks.Contains("ExecWait") -or
    $hooks.Contains("MB_ABORTRETRYIGNORE") -or
    $hooks.Contains("arizona_release_device_retry")) {
  throw "NSIS hooks must run helpers invisibly and must not block uninstall on online device release."
}
if ($hooks.Contains('Delete /REBOOTOK "$LOCALAPPDATA\arizona-app\arizona-app.exe"') -or
    $hooks.Contains('RMDir /r "$LOCALAPPDATA\arizona-app"')) {
  throw "Legacy upgrade must use the registered 2.0.0 uninstaller and preserve unrelated user data."
}
if ($hooks.Contains("ARIZONA_PROTOCOL") -or
    $hooks.Contains("WriteRegStr") -or
    $hooks.Contains("URL Protocol")) {
  throw "The retired arizona:// deep-link protocol must not be registered by NSIS."
}

$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$nsis = $tauriConfig.bundle.windows.nsis
if (!$nsis -or $nsis.installerHooks -ne "../INSTALLER/nsis/hooks.nsh") {
  throw "tauri.conf.json does not point to INSTALLER/nsis/hooks.nsh"
}
if ($tauriConfig.bundle.windows.nsis.installMode -ne "perMachine") {
  throw "NSIS installMode must remain perMachine for the official desktop installation."
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
  $manifestPath = Join-Path $payloadRoot "release-manifest.json"
  $aexPayload = Join-Path $payloadRoot "aex"

  if (!(Test-Path -LiteralPath $cepPayload -PathType Container)) {
    throw "CEP payload missing: $cepPayload"
  }
  if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Release manifest missing: $manifestPath"
  }
  if (Test-Path -LiteralPath $aexPayload) {
    throw "AEX payload directory must not exist in the plugin-free installer: $aexPayload"
  }
  $unexpectedPlugins = @(Get-ChildItem -LiteralPath $payloadRoot -Recurse -File -Filter "*.aex" -ErrorAction SilentlyContinue)
  if ($unexpectedPlugins.Count -gt 0) {
    throw "The plugin-free installer payload contains an unexpected .aex file."
  }
  $debugArtifacts = @(
    Get-ChildItem -LiteralPath $cepPayload -Recurse -Force -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq ".debug" -or $_.Extension -eq ".map" }
  )
  if ($debugArtifacts.Count -gt 0) {
    throw "The production CEP payload contains .debug or source-map files."
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
  $actualCepFingerprint = Get-DirectoryFingerprint $cepPayload

  if ([int]$manifest.schemaVersion -ne 2) {
    throw "Unsupported release manifest schema: $($manifest.schemaVersion)"
  }
  if ([string]$manifest.appPackageVersion -ne [string]$packageJson.version) {
    throw "Release manifest appPackageVersion does not match package.json."
  }
  if ([string]$manifest.tauriVersion -ne [string]$tauriConfig.version) {
    throw "Release manifest tauriVersion does not match tauri.conf.json."
  }
  if ([string]$manifest.cepExtensionId -ne "com.arizona-carrefour.cep") {
    throw "Release manifest has an unexpected CEP extension identity."
  }
  if ([string]$manifest.cepFingerprint -ne $actualCepFingerprint) {
    throw "CEP payload fingerprint does not match release manifest."
  }
  if ($null -eq $manifest.PSObject.Properties["includesAfterEffectsPlugin"]) {
    throw "Release manifest must explicitly declare includesAfterEffectsPlugin=false."
  }
  if ([bool]$manifest.includesAfterEffectsPlugin) {
    throw "Release manifest must explicitly declare that no After Effects plugin is included."
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
