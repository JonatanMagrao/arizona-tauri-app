param(
  [switch]$RequirePayload,
  [switch]$RequireSignedTauri,
  [string]$PayloadRoot = "",
  [string]$TrustedCertPath = "",
  [string]$CepVerifierScript = "",
  [string]$TauriExePath = "",
  [string]$NsisBundlePath = ""
)

. "$PSScriptRoot\common.ps1"

$repoRoot = Get-FullPath (Join-Path $PSScriptRoot "..\..")
$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$extensionPackageJsonPath = Join-Path $repoRoot "ARIZONA-EXTENSION\package.json"
$hooksPath = Join-Path $repoRoot "INSTALLER\nsis\hooks.nsh"
$payloadRoot = if ([string]::IsNullOrWhiteSpace($PayloadRoot)) {
  Join-Path $repoRoot "INSTALLER\payload"
} else {
  Get-FullPath $PayloadRoot
}
$trustedCertPath = if ([string]::IsNullOrWhiteSpace($TrustedCertPath)) {
  Join-Path $repoRoot "INSTALLER\cep-trusted-cert.json"
} else {
  Get-FullPath $TrustedCertPath
}
$embeddedScriptPath = Join-Path $repoRoot "src-tauri\src\after_effects\arizona_actions.jsx"
$afterEffectsModulePath = Join-Path $repoRoot "src-tauri\src\after_effects.rs"
$tauriBuildScriptPath = Join-Path $repoRoot "src-tauri\build.rs"
$commonInstallerScriptPath = Join-Path $repoRoot "INSTALLER\scripts\common.ps1"
$installAdobeAssetsPath = Join-Path $repoRoot "INSTALLER\scripts\install-adobe-assets.ps1"
$uninstallAdobeAssetsPath = Join-Path $repoRoot "INSTALLER\scripts\uninstall-adobe-assets.ps1"
$collectArtifactsPath = Join-Path $repoRoot "INSTALLER\scripts\collect-artifacts.ps1"

function Invoke-CepZxpVerification {
  param(
    [Parameter(Mandatory = $true)][string]$ZxpPath,
    [Parameter(Mandatory = $true)][string]$VerifierScript
  )

  if (!(Test-Path -LiteralPath $VerifierScript -PathType Leaf)) {
    throw "CEP ZXP verifier not found: $VerifierScript"
  }

  $nodeCommand = Get-Command "node" -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $nodeCommand) {
    throw "Node.js is required to run the CEP ZXP verifier."
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $nodeCommand.Source $VerifierScript $ZxpPath 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $outputText = (($output | ForEach-Object { [string]$_ }) -join "`n")

  if ($exitCode -ne 0) {
    throw "CEP ZXP cryptographic verification failed (exit $exitCode):`n$outputText"
  }
  if ($outputText -notmatch "(?m)^CEP ZXP verification passed:") {
    throw "CEP ZXP verifier exited successfully without its success marker:`n$outputText"
  }

  return $outputText
}

function Assert-ValidAuthenticodeSignature {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label not found: $Path"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ([string]$signature.Status -cne "Valid") {
    throw "$Label does not have a valid Authenticode signature (Status=$($signature.Status)): $Path"
  }

  Write-Host "$Label Authenticode signature is valid: $Path"
}

if (!(Test-Path -LiteralPath $tauriConfigPath -PathType Leaf)) {
  throw "Tauri config not found: $tauriConfigPath"
}
if (!(Test-Path -LiteralPath $extensionPackageJsonPath -PathType Leaf)) {
  throw "CEP extension package.json not found: $extensionPackageJsonPath"
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
foreach ($installerScriptPath in @(
    $commonInstallerScriptPath,
    $installAdobeAssetsPath,
    $uninstallAdobeAssetsPath,
    $collectArtifactsPath
  )) {
  if (!(Test-Path -LiteralPath $installerScriptPath -PathType Leaf)) {
    throw "Required installer script not found: $installerScriptPath"
  }
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

$commonInstallerScript = Get-Content -LiteralPath $commonInstallerScriptPath -Raw
$installAdobeAssets = Get-Content -LiteralPath $installAdobeAssetsPath -Raw
$uninstallAdobeAssets = Get-Content -LiteralPath $uninstallAdobeAssetsPath -Raw
$collectArtifacts = Get-Content -LiteralPath $collectArtifactsPath -Raw

if (!$commonInstallerScript.Contains('CommonProgramW6432') -or
    !$commonInstallerScript.Contains('CommonProgramFiles')) {
  throw "Full installer must resolve native Common Files through CommonProgramW6432 with a CommonProgramFiles fallback."
}
foreach ($fullHelper in @($installAdobeAssets, $uninstallAdobeAssets)) {
  if (!$fullHelper.Contains('Get-SystemCommonProgramFiles') -or
      !$fullHelper.Contains('Adobe\CEP\extensions') -or
      !$fullHelper.Contains('.arizona-install-work')) {
    throw "Full install/uninstall helpers must use the native system CEP root and its sibling transaction root."
  }
  if ($fullHelper.Contains('CsxsRegistryBasePath') -or
      $fullHelper.Contains('Disable-CepPlayerDebugMode') -or
      $fullHelper.Contains('Join-Path $env:APPDATA "Adobe\CEP\extensions"')) {
    throw "Elevated Full helpers must not install CEP per-user or mutate per-user CEP debug registry state."
  }
}
if ($installAdobeAssets.Contains('$env:APPDATA')) {
  throw "Elevated Full install helper must not write into APPDATA."
}
if ($installAdobeAssets.Contains('Join-Path $cepExtensionsRootFull "com.arizona-carrefour.cep.tmp-') -or
    $installAdobeAssets.Contains('Join-Path $cepExtensionsRootFull "com.arizona-carrefour.cep.bak')) {
  throw "CEP staging and backups must remain outside Adobe's scanned extensions directory."
}
if (!$collectArtifacts.Contains('ARIZONA-EXTENSION\package.json') -or
    !$collectArtifacts.Contains('dist-cep\arizona-cep-v$extensionVersion.zxp') -or
    !$collectArtifacts.Contains('$zxpInfo.BundleVersion -cne $extensionVersion')) {
  throw "Artifact collection must select only the CEP extension-version ZXP and verify its BundleVersion."
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
$trustedCertResource = $resourceMap.PSObject.Properties["../INSTALLER/cep-trusted-cert.json"]
if ($null -eq $trustedCertResource -or
    [string]$trustedCertResource.Value -ne "installer/cep-trusted-cert.json") {
  throw "bundle.resources must include ../INSTALLER/cep-trusted-cert.json at installer/cep-trusted-cert.json."
}

if ($RequirePayload) {
  $cepPayloadZxp = Join-Path $payloadRoot "cep\com.arizona-carrefour.cep.zxp"
  $legacyCepPayloadFolder = Join-Path $payloadRoot "cep\com.arizona-carrefour.cep"
  $manifestPath = Join-Path $payloadRoot "release-manifest.json"
  $aexPayload = Join-Path $payloadRoot "aex"

  if (!(Test-Path -LiteralPath $cepPayloadZxp -PathType Leaf)) {
    throw "Signed CEP payload missing: $cepPayloadZxp. Run npm run cep:zxp and npm run release:collect."
  }
  if (Test-Path -LiteralPath $legacyCepPayloadFolder) {
    throw "The payload must ship the signed .zxp, never an unsigned build folder: $legacyCepPayloadFolder"
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

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
  $extensionPackageJson = Get-Content -LiteralPath $extensionPackageJsonPath -Raw | ConvertFrom-Json

  if ([int](Get-JsonProperty $manifest "schemaVersion") -ne 3) {
    throw "Unsupported release manifest schema: $(Get-JsonProperty $manifest 'schemaVersion')"
  }
  if ([string](Get-JsonProperty $manifest "appPackageVersion") -ne [string]$packageJson.version) {
    throw "Release manifest appPackageVersion does not match package.json."
  }
  if ([string](Get-JsonProperty $manifest "tauriVersion") -ne [string]$tauriConfig.version) {
    throw "Release manifest tauriVersion does not match tauri.conf.json."
  }
  if ([string](Get-JsonProperty $manifest "cepExtensionId") -ne "com.arizona-carrefour.cep") {
    throw "Release manifest has an unexpected CEP extension identity."
  }
  if ([string](Get-JsonProperty $manifest "cepZxpFileName") -ne "com.arizona-carrefour.cep.zxp") {
    throw "Release manifest has an unexpected CEP package filename."
  }
  if ($null -eq (Get-JsonProperty $manifest "includesAfterEffectsPlugin")) {
    throw "Release manifest must explicitly declare includesAfterEffectsPlugin=false."
  }
  if ([bool]$manifest.includesAfterEffectsPlugin) {
    throw "Release manifest must explicitly declare that no After Effects plugin is included."
  }

  $actualCepSha256 = Get-FileSha256 $cepPayloadZxp
  $expectedCepSha256 = [string](Get-JsonProperty $manifest "cepZxpSha256")
  if ([string]::IsNullOrWhiteSpace($expectedCepSha256) -or
      !$expectedCepSha256.Equals($actualCepSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "CEP payload SHA-256 does not match release manifest: $cepPayloadZxp"
  }

  # Positive gates. The package must still BE a signed .zxp when it reaches the
  # payload: CEP verifies the signature against the installed tree, so a missing
  # entry here is exactly the bug that forced PlayerDebugMode on every client.
  $cepEntries = @(Get-ZipEntryNames $cepPayloadZxp)
  Assert-NoZipSourceMapEntries -EntryNames $cepEntries -Label "CEP release payload"
  foreach ($requiredEntry in @("META-INF/signatures.xml", "mimetype", "CSXS/manifest.xml", ".debug")) {
    if ($cepEntries -notcontains $requiredEntry) {
      throw "The CEP payload is not a signed .zxp: $requiredEntry is missing from $cepPayloadZxp"
    }
  }

  $payloadBundleInfo = Get-ZxpManifestInfo $cepPayloadZxp
  if ($payloadBundleInfo.BundleId -ne "com.arizona-carrefour.cep") {
    throw "CSXS/manifest.xml in the payload has an unexpected ExtensionBundleId."
  }
  $payloadBundleVersion = $payloadBundleInfo.BundleVersion
  if ([string](Get-JsonProperty $manifest "cepBundleVersion") -ne $payloadBundleVersion) {
    throw "Release manifest cepBundleVersion does not match CSXS/manifest.xml in the payload."
  }
  if ($payloadBundleVersion -cne [string]$extensionPackageJson.version) {
    throw "CEP payload ExtensionBundleVersion does not match ARIZONA-EXTENSION/package.json."
  }

  # Defense-in-depth identity gate. The shared verifier below repeats the pin
  # check and also validates the actual Adobe XML signature plus the embedded
  # RFC 3161 token, including its CMS signature, TSA chain/EKU, genTime and
  # messageImprint. ZXPSignCmd 4.1.3's human-readable timestamp line is not used
  # because it reports "Invalid timestamp" even for corrected packages.
  $payloadCertificate = Get-ZxpSigningCertificateFingerprint $cepPayloadZxp
  $trustedCertificates = @(Get-TrustedCepCertificateFingerprints $trustedCertPath)
  if ($trustedCertificates.Count -eq 0) {
    throw "No trusted CEP signing certificate is pinned in $trustedCertPath. Generate the stable Arizona certificate (npm run cep:cert) and record its fingerprint before releasing."
  }
  if ($trustedCertificates -notcontains $payloadCertificate) {
    throw @"
The CEP payload is signed by a certificate that this release does not trust.
  Payload:  $cepPayloadZxp
  Signed by: $payloadCertificate
  Pinned:    $($trustedCertificates -join ', ') (from $trustedCertPath)
Rebuild the package with the stable Arizona certificate (npm run cep:zxp), or,
when rotating, ADD the new fingerprint to $trustedCertPath and ship the app that
trusts both before signing with the new certificate.
"@
  }

  $resolvedVerifierScript = if ([string]::IsNullOrWhiteSpace($CepVerifierScript)) {
    Join-Path $repoRoot "scripts\verify-cep-zxp.mjs"
  } else {
    Get-FullPath $CepVerifierScript
  }
  $verificationSummary = Invoke-CepZxpVerification `
    -ZxpPath $cepPayloadZxp `
    -VerifierScript $resolvedVerifierScript

  Write-Host $verificationSummary
  Write-Host "CEP payload carries the pinned Arizona certificate ($payloadCertificate), a valid Adobe signature, and a validated RFC 3161 timestamp."
}

if ($RequireSignedTauri) {
  $packageJsonPath = Join-Path $repoRoot "package.json"
  $packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
  $releaseVersion = [string]$tauriConfig.version
  if ([string]$packageJson.version -cne $releaseVersion) {
    throw "Public release version mismatch: package.json is $($packageJson.version), but tauri.conf.json is $releaseVersion."
  }

  $resolvedTauriExePath = if ([string]::IsNullOrWhiteSpace($TauriExePath)) {
    Join-Path $repoRoot "src-tauri\target\release\arizona-app.exe"
  } else {
    Get-FullPath $TauriExePath
  }
  $resolvedNsisBundlePath = if ([string]::IsNullOrWhiteSpace($NsisBundlePath)) {
    Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
  } else {
    Get-FullPath $NsisBundlePath
  }

  Assert-ValidAuthenticodeSignature `
    -Path $resolvedTauriExePath `
    -Label "Tauri release executable"

  if (!(Test-Path -LiteralPath $resolvedNsisBundlePath -PathType Container)) {
    throw "NSIS release bundle directory not found: $resolvedNsisBundlePath"
  }

  $productName = [string]$tauriConfig.productName
  $setupNamePattern = "^{0}_{1}_.+-setup\.exe$" -f `
    [regex]::Escape($productName), `
    [regex]::Escape($releaseVersion)
  $matchingSetups = @(
    Get-ChildItem -LiteralPath $resolvedNsisBundlePath -File -Filter "*-setup.exe" |
      Where-Object { $_.Name -cmatch $setupNamePattern }
  )

  if ($matchingSetups.Count -eq 0) {
    throw "NSIS setup for $productName version $releaseVersion not found in: $resolvedNsisBundlePath"
  }
  if ($matchingSetups.Count -ne 1) {
    $setupNames = ($matchingSetups | ForEach-Object { $_.Name } | Sort-Object) -join ", "
    throw "Ambiguous NSIS setups for $productName version $releaseVersion; expected exactly one, found $($matchingSetups.Count): $setupNames"
  }

  Assert-ValidAuthenticodeSignature `
    -Path $matchingSetups[0].FullName `
    -Label "NSIS setup $releaseVersion"
}

Write-Host "Release scaffolding checks passed."
