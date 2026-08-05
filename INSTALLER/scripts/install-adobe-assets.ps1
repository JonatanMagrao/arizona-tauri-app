param(
  [Parameter(Mandatory = $true)][string]$PayloadRoot,
  [string]$InstallDir = "",
  [string]$CepExtensionsRoot = "",
  [string]$LogRoot = "",
  [string]$StatePath = "",
  [string]$TrustedCertPath = "",
  [string]$AfterEffectsProcessName = "AfterFX",
  [string[]]$AdobeRoots = @()
)

. "$PSScriptRoot\common.ps1"

$logRoot = Get-InstallerLogRoot $LogRoot
$payloadRootFull = Get-FullPath $PayloadRoot

trap {
  Write-InstallerLog "ERROR installing Adobe assets: $($_.Exception.Message)" $logRoot
  Write-Error $_
  exit 1
}

if (!(Test-Path -LiteralPath $payloadRootFull -PathType Container)) {
  throw "Installer payload not found: $payloadRootFull"
}

if ([string]::IsNullOrWhiteSpace($StatePath)) {
  if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    throw "InstallDir or StatePath is required to persist installed asset paths."
  }
  $StatePath = Join-Path $InstallDir "installer\installed-assets.json"
}
$statePathFull = Get-FullPath $StatePath

$manifestPath = Join-Path $payloadRootFull "release-manifest.json"
if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Installer release manifest not found: $manifestPath"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ([int](Get-JsonProperty $manifest "schemaVersion") -ne 3 -or
    [string](Get-JsonProperty $manifest "cepExtensionId") -ne "com.arizona-carrefour.cep" -or
    $null -eq (Get-JsonProperty $manifest "includesAfterEffectsPlugin") -or
    [bool]$manifest.includesAfterEffectsPlugin) {
  throw "Installer release manifest must describe the plugin-free signed CEP payload."
}

if (![string]::IsNullOrWhiteSpace($InstallDir)) {
  Assert-PathInside -Path $statePathFull -Parent $InstallDir -Label "installed asset state"
}

# The payload is the signed .zxp. Everything below verifies it BEFORE anything
# on the machine is touched, so a corrupted or swapped payload aborts the
# install with the previous extension still in place.
$cepSource = Join-Path $payloadRootFull "cep\com.arizona-carrefour.cep.zxp"
if (!(Test-Path -LiteralPath $cepSource -PathType Leaf)) {
  throw "Signed CEP payload not found: $cepSource"
}
$cepSourceSha256 = Get-FileSha256 $cepSource
$expectedCepSha256 = [string](Get-JsonProperty $manifest "cepZxpSha256")
if ([string]::IsNullOrWhiteSpace($expectedCepSha256) -or
    !$cepSourceSha256.Equals($expectedCepSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "CEP payload SHA-256 does not match release-manifest.json: $cepSource"
}

if ([string](Get-JsonProperty $manifest "cepZxpFileName") -ne "com.arizona-carrefour.cep.zxp") {
  throw "Installer release manifest has an unexpected CEP package filename."
}

$cepEntries = @(Get-ZipEntryNames $cepSource)
Assert-NoZipSourceMapEntries -EntryNames $cepEntries -Label "CEP payload"
foreach ($requiredEntry in @("META-INF/signatures.xml", "mimetype", "CSXS/manifest.xml", ".debug")) {
  if ($cepEntries -notcontains $requiredEntry) {
    throw "CEP payload is incomplete or unsigned: $requiredEntry is missing from $cepSource"
  }
}

$zxpInfo = Get-ZxpManifestInfo $cepSource
if ($zxpInfo.BundleId -ne "com.arizona-carrefour.cep") {
  throw "CEP payload has an unexpected ExtensionBundleId: $($zxpInfo.BundleId)"
}
$expectedBundleVersion = [string](Get-JsonProperty $manifest "cepBundleVersion")
if ([string]::IsNullOrWhiteSpace($expectedBundleVersion) -or
    $zxpInfo.BundleVersion -ne $expectedBundleVersion) {
  throw "CEP payload ExtensionBundleVersion does not match release-manifest.json."
}

if ([string]::IsNullOrWhiteSpace($TrustedCertPath)) {
  $TrustedCertPath = Join-Path (Split-Path -Parent $payloadRootFull) "cep-trusted-cert.json"
}
$trustedCertPathFull = Get-FullPath $TrustedCertPath
$trustedCertificates = @(Get-TrustedCepCertificateFingerprints $trustedCertPathFull)
if ($trustedCertificates.Count -eq 0) {
  throw "No trusted CEP signing certificate is pinned in $trustedCertPathFull."
}
$payloadCertificate = Get-ZxpSigningCertificateFingerprint $cepSource
if ($trustedCertificates -notcontains $payloadCertificate) {
  throw "CEP payload is not signed by a pinned Arizona certificate ($payloadCertificate)."
}
$contentVerification = Assert-ZxpContentSignature -Path $cepSource
if ($contentVerification.CertificateFingerprint -cne $payloadCertificate) {
  throw "CEP payload certificate changed while its content signature was being verified."
}

if (Test-Path -LiteralPath (Join-Path $payloadRootFull "aex")) {
  throw "The plugin-free installer must not contain an AEX payload directory."
}

$legacyAexTargets = @()
if (Test-Path -LiteralPath $statePathFull -PathType Leaf) {
  try {
    $previousState = Get-Content -LiteralPath $statePathFull -Raw | ConvertFrom-Json
    if ([int]$previousState.schemaVersion -eq 1 -and $null -ne $previousState.aex) {
      foreach ($entry in @($previousState.aex)) {
        if (![string]::IsNullOrWhiteSpace([string]$entry.path)) {
          $legacyAexTargets += [string]$entry.path
        }
      }
    }
  } catch {
    Write-InstallerLog "Previous install state could not be read; legacy AEX discovery will be used." $logRoot
  }
}

if ($AdobeRoots.Count -gt 0) {
  $afterInstallationsJson = & "$PSScriptRoot\detect-after-effects.ps1" -Json -AdobeRoots $AdobeRoots -IncludeArizonaPluginOnly
} else {
  $afterInstallationsJson = & "$PSScriptRoot\detect-after-effects.ps1" -Json -IncludeArizonaPluginOnly
}
$afterInstallations = $afterInstallationsJson | ConvertFrom-Json
foreach ($installation in @($afterInstallations)) {
  if ($null -ne $installation -and ![string]::IsNullOrWhiteSpace([string]$installation.pluginPath)) {
    $legacyAexTargets += [string]$installation.pluginPath
  }
}
$legacyAexTargets = @($legacyAexTargets | Sort-Object -Unique)

if (Test-AfterEffectsRunning -ProcessName $AfterEffectsProcessName) {
  Write-InstallerLog "After Effects is running; close it before installing or upgrading the Arizona CEP extension." $logRoot
  exit 20
}

foreach ($pluginPath in $legacyAexTargets) {
  $pluginDir = Assert-ArizonaAexPath -Path $pluginPath -AdobeRoots $AdobeRoots
  $pluginsRoot = Split-Path -Parent $pluginDir
  $aexWasPresent = $null -ne (Get-PathItem $pluginPath)
  Remove-PathSafe -Path $pluginPath -AllowedParent $pluginDir -Label "legacy Arizona AEX plugin"
  if ($aexWasPresent) {
    Write-InstallerLog "Removed legacy AEX plugin from $pluginPath" $logRoot
  }

  if (Remove-DirectoryIfEmptySafe -Path $pluginDir -AllowedParent $pluginsRoot -Label "legacy Arizona AEX directory") {
    Write-InstallerLog "Removed empty legacy Arizona plugin directory from $pluginDir" $logRoot
  } elseif ($null -ne (Get-PathItem $pluginDir)) {
    Write-InstallerLog "Preserved non-empty legacy Arizona plugin directory at $pluginDir" $logRoot
  }
}

if ([string]::IsNullOrWhiteSpace($CepExtensionsRoot)) {
  $systemCommonProgramFiles = Get-SystemCommonProgramFiles
  $CepExtensionsRoot = Join-Path $systemCommonProgramFiles "Adobe\CEP\extensions"
  $cepRootTrustAnchor = $systemCommonProgramFiles
} else {
  # Explicit roots exist for isolated tests. Anchor one level above
  # `extensions` so the sibling transaction root can be validated too.
  $CepExtensionsRoot = Get-FullPath $CepExtensionsRoot
  $cepRootTrustAnchor = Split-Path -Parent $CepExtensionsRoot
}

Write-InstallerLog "Installing Arizona CEP extension from $payloadRootFull" $logRoot

$cepDestination = Join-Path $CepExtensionsRoot "com.arizona-carrefour.cep"
$cepExtensionsRootFull = Assert-ArizonaCepPath -Path $cepDestination -ExpectedExtensionsRoot $CepExtensionsRoot
$cepContainerRoot = Split-Path -Parent $cepExtensionsRootFull
$cepWorkRoot = Join-Path $cepContainerRoot ".arizona-install-work"
Assert-PathInside -Path $cepWorkRoot -Parent $cepContainerRoot -Label "CEP installer work root"

# Validate all existing ancestors before creating either directory, then again
# afterwards. In production the anchor is CommonProgramFiles; isolated tests
# deliberately inject their own Adobe\CEP\extensions root.
Assert-NoIntermediateReparsePoint `
  -Path $cepExtensionsRootFull `
  -TrustedRoot $cepRootTrustAnchor `
  -IncludePath
Assert-NoIntermediateReparsePoint `
  -Path $cepWorkRoot `
  -TrustedRoot $cepRootTrustAnchor `
  -IncludePath
New-Item -ItemType Directory -Force -Path $cepExtensionsRootFull | Out-Null
New-Item -ItemType Directory -Force -Path $cepWorkRoot | Out-Null
Assert-NoIntermediateReparsePoint `
  -Path $cepExtensionsRootFull `
  -TrustedRoot $cepRootTrustAnchor `
  -IncludePath
Assert-NoIntermediateReparsePoint `
  -Path $cepWorkRoot `
  -TrustedRoot $cepRootTrustAnchor `
  -IncludePath

# The transaction root is a sibling of `extensions` on the same volume. Adobe
# scans every direct child of `extensions`, so staging and recovery backups must
# never live there, even if the process or machine crashes between renames.
$stamp = "{0}-{1}-{2}" -f `
  (Get-Date -Format "yyyyMMdd-HHmmssfff"), `
  $PID, `
  [guid]::NewGuid().ToString("N")
$cepStaging = Join-Path $cepWorkRoot "com.arizona-carrefour.cep.tmp-$stamp"
$cepBackup = Join-Path $cepWorkRoot "com.arizona-carrefour.cep.bak"
Assert-PathInside -Path $cepStaging -Parent $cepWorkRoot -Label "CEP staging directory"
Assert-PathInside -Path $cepBackup -Parent $cepWorkRoot -Label "CEP backup directory"

# Migrate working directories left by older installer versions out of
# `extensions` before recovery. Proper backups are quarantined when no final
# destination exists; incomplete staging, invalid files and reparse points are
# removed without traversing them. Thus even an ambiguity failure leaves no
# duplicate BundleId in Adobe's scanned directory.
$destinationItem = Get-PathItem $cepDestination
$legacyVisibleItems = @(Get-ChildItem -LiteralPath $cepExtensionsRootFull -Force -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -eq "com.arizona-carrefour.cep.bak" -or
    $_.Name -like "com.arizona-carrefour.cep.bak-*" -or
    $_.Name -like "com.arizona-carrefour.cep.tmp-*"
  })
foreach ($legacyItem in $legacyVisibleItems) {
  $isBackup = $legacyItem.Name -eq "com.arizona-carrefour.cep.bak" -or
    $legacyItem.Name -like "com.arizona-carrefour.cep.bak-*"
  $isReparsePoint = ($legacyItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
  if (!$isBackup -or !$legacyItem.PSIsContainer -or $isReparsePoint -or $null -ne $destinationItem) {
    Remove-PathSafe `
      -Path $legacyItem.FullName `
      -AllowedParent $cepExtensionsRootFull `
      -Label "legacy CEP working directory"
    Write-InstallerLog "Removed legacy CEP working directory from the scanned extensions root: $($legacyItem.FullName)" $logRoot
    continue
  }

  Assert-NoIntermediateReparsePoint `
    -Path $legacyItem.FullName `
    -TrustedRoot $cepRootTrustAnchor `
    -IncludePath
  $quarantinedBackup = Join-Path $cepWorkRoot `
    "com.arizona-carrefour.cep.legacy-recovery-$([guid]::NewGuid().ToString('N'))"
  Assert-PathInside -Path $quarantinedBackup -Parent $cepWorkRoot -Label "quarantined CEP recovery backup"
  [System.IO.Directory]::Move($legacyItem.FullName, $quarantinedBackup)
  Write-InstallerLog "Moved legacy CEP recovery backup outside the scanned extensions root: $quarantinedBackup" $logRoot
}

# Staging from a crashed new installer is always disposable. Recovery backups
# remain outside `extensions`; a sole one is restored before extraction, while
# multiple candidates are preserved there for manual diagnosis.
foreach ($staleStaging in @(Get-ChildItem -LiteralPath $cepWorkRoot -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "com.arizona-carrefour.cep.tmp-*" })) {
  Remove-PathSafe -Path $staleStaging.FullName -AllowedParent $cepWorkRoot -Label "stale CEP staging directory"
  Write-InstallerLog "Removed stale CEP staging directory $($staleStaging.FullName)" $logRoot
}

$recoveryBackups = @()
$currentRecoveryBackup = Get-PathItem $cepBackup
if ($null -ne $currentRecoveryBackup) {
  $recoveryBackups += $currentRecoveryBackup
}
$recoveryBackups += @(Get-ChildItem -LiteralPath $cepWorkRoot -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "com.arizona-carrefour.cep.legacy-recovery-*" })

if ($null -eq $destinationItem) {
  if ($recoveryBackups.Count -gt 1) {
    throw "Multiple CEP recovery backups exist outside the scanned extensions root; refusing to choose one automatically."
  }
  if ($recoveryBackups.Count -eq 1) {
    $recoveryBackup = $recoveryBackups[0]
    $recoveryIsReparse = ($recoveryBackup.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
    if (!$recoveryBackup.PSIsContainer -or $recoveryIsReparse) {
      throw "CEP recovery backup is not a regular directory: $($recoveryBackup.FullName)"
    }
    Assert-NoIntermediateReparsePoint `
      -Path $recoveryBackup.FullName `
      -TrustedRoot $cepRootTrustAnchor `
      -IncludePath
    [System.IO.Directory]::Move($recoveryBackup.FullName, $cepDestination)
    Write-InstallerLog "Restored interrupted CEP installation from $($recoveryBackup.FullName)" $logRoot
    $destinationItem = Get-PathItem $cepDestination
  }
} else {
  foreach ($obsoleteBackup in $recoveryBackups) {
    Remove-PathSafe -Path $obsoleteBackup.FullName -AllowedParent $cepWorkRoot -Label "obsolete CEP recovery backup"
    Write-InstallerLog "Removed obsolete CEP recovery backup $($obsoleteBackup.FullName)" $logRoot
  }
}

$backupCreated = $false
try {
  Expand-ZipToDirectory -Path $cepSource -Destination $cepStaging

  # The extracted tree must stay byte-identical to the package: CEP verifies the
  # signature from the installed folder, and these entries are part of it.
  foreach ($requiredEntry in @("META-INF\signatures.xml", "mimetype", "CSXS\manifest.xml", ".debug")) {
    if (!(Test-Path -LiteralPath (Join-Path $cepStaging $requiredEntry) -PathType Leaf)) {
      throw "Extracted CEP extension is missing $requiredEntry; the payload is not a signed .zxp."
    }
  }

  # Re-verify the exact tree that will be committed. This closes the gap between
  # inspecting the archive and extraction, and proves possession of the private
  # key instead of trusting a copied public certificate alone.
  $stagingVerification = Assert-CepDirectoryContentSignature -Directory $cepStaging
  if ($stagingVerification.CertificateFingerprint -cne $payloadCertificate) {
    throw "Extracted CEP certificate does not match the verified package."
  }

  # Extraction can take long enough for After Effects to open in the meantime.
  # Refuse the commit before touching the current destination. This elevated
  # per-machine helper intentionally never changes per-user registry settings.
  if (Test-AfterEffectsRunning -ProcessName $AfterEffectsProcessName) {
    throw "After Effects opened during installation; close it before replacing the CEP extension."
  }

  # Re-check both rename endpoints immediately before the privileged commit.
  # The final destination may itself be a development junction; moving it
  # relocates the link and must never traverse its target.
  Assert-NoIntermediateReparsePoint `
    -Path $cepDestination `
    -TrustedRoot $cepRootTrustAnchor
  Assert-NoIntermediateReparsePoint `
    -Path $cepStaging `
    -TrustedRoot $cepRootTrustAnchor `
    -IncludePath
  $backupCreated = Invoke-CepDirectorySwap `
    -Destination $cepDestination `
    -Staging $cepStaging `
    -Backup $cepBackup `
    -ExtensionsRoot $cepExtensionsRootFull `
    -WorkRoot $cepWorkRoot
  Write-InstallerLog "Installed signed CEP extension to $cepDestination" $logRoot
} catch {
  if ($null -ne (Get-PathItem $cepStaging)) {
    Remove-PathSafe -Path $cepStaging -AllowedParent $cepWorkRoot -Label "partial CEP extension"
  }
  if ($backupCreated -and
      $null -eq (Get-PathItem $cepDestination) -and
      $null -ne (Get-PathItem $cepBackup)) {
    [System.IO.Directory]::Move($cepBackup, $cepDestination)
    Write-InstallerLog "Restored the previous CEP extension at $cepDestination" $logRoot
  }
  Remove-DirectoryIfEmptySafe `
    -Path $cepWorkRoot `
    -AllowedParent $cepContainerRoot `
    -Label "CEP installer work root" | Out-Null
  throw
}

if ($backupCreated) {
  # Remove-PathSafe unlinks a development junction instead of deleting its target.
  Remove-PathSafe -Path $cepBackup -AllowedParent $cepWorkRoot -Label "previous CEP extension"
}

Remove-DirectoryIfEmptySafe `
  -Path $cepWorkRoot `
  -AllowedParent $cepContainerRoot `
  -Label "CEP installer work root" | Out-Null

$state = [pscustomobject]@{
  schemaVersion = 2
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
  releaseManifest = [pscustomobject]@{
    appPackageVersion = [string]$manifest.appPackageVersion
    tauriVersion = [string]$manifest.tauriVersion
    includesAfterEffectsPlugin = $false
  }
  cep = [pscustomobject]@{
    path = Get-FullPath $cepDestination
    zxpSha256 = $cepSourceSha256
    bundleVersion = [string](Get-JsonProperty $manifest "cepBundleVersion")
  }
}

Write-JsonFileAtomic -Path $statePathFull -Value $state
Write-InstallerLog "Recorded installed CEP asset at $statePathFull" $logRoot
exit 0
