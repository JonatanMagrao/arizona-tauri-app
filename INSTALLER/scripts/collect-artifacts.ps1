param(
  [string]$RepoRoot = "",
  [string]$PayloadRoot = "",
  [string]$ZxpPath = ""
)

. "$PSScriptRoot\common.ps1"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = Get-FullPath (Join-Path $PSScriptRoot "..\..")
} else {
  $RepoRoot = Get-FullPath $RepoRoot
}

if ([string]::IsNullOrWhiteSpace($PayloadRoot)) {
  $PayloadRoot = Join-Path $RepoRoot "INSTALLER\payload"
}

$packageJson = Get-Content -LiteralPath (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
$tauriConfig = Get-Content -LiteralPath (Join-Path $RepoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$extensionPackageJson = Get-Content -LiteralPath (Join-Path $RepoRoot "ARIZONA-EXTENSION\package.json") -Raw | ConvertFrom-Json

# The installer ships the SIGNED package, never a build folder: CEP verifies the
# signature against the installed tree, and a copied folder never matches it.
# The CEP package version is independent from the desktop app version. There is
# exactly one acceptable source path, derived from ARIZONA-EXTENSION/package.json;
# never fall back to an app-version artifact or another stale dist-cep file.
$extensionVersion = [string]$extensionPackageJson.version
if ([string]::IsNullOrWhiteSpace($extensionVersion)) {
  throw "ARIZONA-EXTENSION/package.json has no version."
}
$expectedZxpSource = Get-FullPath (Join-Path $RepoRoot "dist-cep\arizona-cep-v$extensionVersion.zxp")

if (![string]::IsNullOrWhiteSpace($ZxpPath)) {
  $suppliedZxpSource = Get-FullPath $ZxpPath
  if (!$suppliedZxpSource.Equals($expectedZxpSource, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Only the CEP extension-version artifact may be collected: $expectedZxpSource (received $suppliedZxpSource)"
  }
} else {
  Push-Location $RepoRoot
  try {
    & npm run cep:zxp
    if ($LASTEXITCODE -ne 0) {
      throw "npm run cep:zxp failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

$zxpSource = $expectedZxpSource
if (!(Test-Path -LiteralPath $zxpSource -PathType Leaf)) {
  throw "Signed CEP extension-version package not found: $zxpSource. Run npm run cep:zxp first."
}

$zxpInfo = Get-ZxpManifestInfo $zxpSource
if ($zxpInfo.BundleId -ne "com.arizona-carrefour.cep") {
  throw "The signed CEP package has an unexpected extension id: $($zxpInfo.BundleId) ($zxpSource)"
}
if ($zxpInfo.BundleVersion -cne $extensionVersion) {
  throw "The signed CEP package bundle version ($($zxpInfo.BundleVersion)) does not match ARIZONA-EXTENSION/package.json ($extensionVersion): $zxpSource"
}

# Fails here when the package is unsigned, before the payload is touched. The
# identity of that certificate is gated by verify-release.ps1 -RequirePayload.
$signingFingerprint = Get-ZxpSigningCertificateFingerprint $zxpSource

$payloadRootFull = Get-FullPath $PayloadRoot
Assert-PathInside -Path $payloadRootFull -Parent (Join-Path $RepoRoot "INSTALLER") -Label "payload root"

New-Item -ItemType Directory -Force -Path $payloadRootFull | Out-Null

foreach ($child in @("cep", "aex", "release-manifest.json")) {
  $path = Join-Path $payloadRootFull $child
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

$cepPayloadRoot = Join-Path $payloadRootFull "cep"
New-Item -ItemType Directory -Force -Path $cepPayloadRoot | Out-Null

# Copied byte for byte. Nothing may be scrubbed from the package: .debug,
# mimetype and META-INF/signatures.xml are all covered by the signature
# manifest, so removing any of them breaks the Adobe verification at load time.
$cepPayloadZxp = Join-Path $cepPayloadRoot "com.arizona-carrefour.cep.zxp"
Copy-Item -LiteralPath $zxpSource -Destination $cepPayloadZxp -Force

$manifest = [pscustomobject]@{
  schemaVersion = 3
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  appPackageVersion = $packageJson.version
  tauriVersion = $tauriConfig.version
  cepExtensionId = "com.arizona-carrefour.cep"
  cepZxpFileName = "com.arizona-carrefour.cep.zxp"
  cepZxpSha256 = Get-FileSha256 $cepPayloadZxp
  cepBundleVersion = $zxpInfo.BundleVersion
  includesAfterEffectsPlugin = $false
  includesAdminApp = $false
}

$manifestPath = Join-Path $payloadRootFull "release-manifest.json"
Write-JsonFileAtomic -Path $manifestPath -Value $manifest

Write-InstallerLog "Collected signed CEP payload from $zxpSource (bundle $($zxpInfo.BundleVersion), signing certificate $signingFingerprint)"
Write-InstallerLog "Collected CEP-only installer payload at $payloadRootFull"
