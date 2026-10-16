# Read-only evidence that this Full install committed the signed CEP payload.
# Discovery is kept in functions so isolated tests need no CLI trust overrides.
function Get-FullCepInstallerRoot {
  return Get-CepSystemAbsolutePath (Join-Path $PSScriptRoot '..')
}

function Assert-FullCepOrdinaryPath {
  param([string]$Path, [switch]$Directory)
  $full = Get-CepSystemAbsolutePath $Path
  Assert-NoIntermediateReparsePoint -Path $full -TrustedRoot ([IO.Path]::GetPathRoot($full)) -IncludePath
  $item = Get-PathItem $full
  if ($null -eq $item -or [bool]$item.PSIsContainer -ne [bool]$Directory) {
    throw "Full CEP verification requires an existing ordinary path: $full"
  }
}

function Read-FullCepJson {
  param([IO.Stream]$Stream, [string]$Label)
  if ($Stream.Length -le 0 -or $Stream.Length -gt $script:ArizonaMaxCepMetadataBytes) {
    throw "Full CEP metadata exceeds the allowed size or is empty: $Label"
  }
  [long]$readBytes = 0
  $json = Read-TextFromLimitedStream -InputStream $Stream -EntryName $Label `
    -ExpectedLength $Stream.Length -Limit $script:ArizonaMaxCepMetadataBytes -TotalBytes ([ref]$readBytes)
  $value = ConvertFrom-Json -InputObject $json
  if ($null -eq $value -or $value -isnot [pscustomobject]) {
    throw "Full CEP metadata must contain a JSON object: $Label"
  }
  return $value
}

function Assert-FullCepSchema {
  param($Document, [int]$Expected, [string]$Label)
  $schema = Get-JsonProperty $Document 'schemaVersion'
  if (($schema -isnot [int] -and $schema -isnot [long]) -or $schema -ne $Expected) {
    throw "Unsupported Full CEP metadata schema: $Label"
  }
}

function Invoke-VerifyFullCepCommit {
  param(
    [Parameter(Mandatory = $true)][string]$InstallerRoot,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )
  $root = Get-CepSystemAbsolutePath $InstallerRoot
  $target = Get-CepSystemAbsolutePath $TargetPath
  if (!$root.Equals((Get-FullCepInstallerRoot), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Full CEP resources must belong to this installed verifier.'
  }
  Assert-FullCepOrdinaryPath -Path $root -Directory
  $selected = @(Get-CepSystemLocations | Where-Object {
    $_.Target.Equals($target, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($selected.Count -ne 1) { throw 'Full CEP target is not an exact allowed machine destination.' }
  $selected = $selected[0]
  Assert-CepSystemLocation $selected
  Assert-FullCepOrdinaryPath -Path $target -Directory

  $receiptPath = Join-Path $root 'installed-assets.json'
  $manifestPath = Join-Path $root 'payload\release-manifest.json'
  $packagePath = Join-Path $root 'payload\cep\com.arizona-carrefour.cep.zxp'
  $pinsPath = Join-Path $root 'cep-trusted-cert.json'
  $paths = @($receiptPath, $manifestPath, $packagePath, $pinsPath)
  $handles = @()
  try {
    foreach ($path in $paths) {
      Assert-FullCepOrdinaryPath $path
      # Deny writes/deletes throughout verification, without creating lock files.
      $handles += [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    }
    $receipt = Read-FullCepJson -Stream $handles[0] -Label 'installed-assets.json'
    $manifest = Read-FullCepJson -Stream $handles[1] -Label 'release-manifest.json'
    Assert-FullCepSchema -Document $receipt -Expected 2 -Label 'installed-assets.json'
    Assert-FullCepSchema -Document $manifest -Expected 3 -Label 'release-manifest.json'
    $cep = Get-JsonProperty $receipt 'cep'
    if ($null -eq $cep -or $cep -isnot [pscustomobject]) { throw 'Full CEP receipt has no CEP object.' }
    $recordedPath = Get-JsonProperty $cep 'path'
    $recordedVersion = Get-JsonProperty $cep 'bundleVersion'
    $recordedHash = Get-JsonProperty $cep 'zxpSha256'
    if ($recordedPath -isnot [string] -or
        !(Get-CepSystemAbsolutePath $recordedPath).Equals($target, [StringComparison]::OrdinalIgnoreCase) -or
        $recordedVersion -isnot [string] -or
        ($null -ne $recordedHash -and ($recordedHash -isnot [string] -or $recordedHash -cnotmatch '^[0-9a-fA-F]{64}$'))) {
      throw 'Full CEP receipt does not identify the selected installed release.'
    }
    $version = Get-JsonProperty $manifest 'cepBundleVersion'
    $hash = Get-JsonProperty $manifest 'cepZxpSha256'
    $includesPlugin = Get-JsonProperty $manifest 'includesAfterEffectsPlugin'
    if ((Get-JsonProperty $manifest 'cepExtensionId') -cne $script:CepSystemBundleId -or
        (Get-JsonProperty $manifest 'cepZxpFileName') -cne 'com.arizona-carrefour.cep.zxp' -or
        $includesPlugin -isnot [bool] -or $includesPlugin -or
        $version -isnot [string] -or $hash -isnot [string] -or $hash -cnotmatch '^[0-9a-fA-F]{64}$') {
      throw 'Full CEP release manifest does not describe the signed plugin-free payload.'
    }
    ConvertTo-ArizonaSemVer $version | Out-Null
    if ($recordedVersion -cne $version) { throw 'Full CEP receipt version differs from the bundled payload.' }
    if ((Get-FileSha256 $packagePath) -ine $hash) { throw 'Full CEP payload SHA-256 differs from its release manifest.' }
    if ($handles[3].Length -le 0 -or $handles[3].Length -gt $script:ArizonaMaxCepMetadataBytes) {
      throw 'Full CEP pinned certificate manifest has an invalid size.'
    }
    $pins = @(Get-TrustedCepCertificateFingerprints $pinsPath)
    if ($pins.Count -eq 0) { throw 'Full CEP verification has no pinned certificates.' }
    $package = Get-ZxpManifestInfo $packagePath
    if ($package.BundleId -cne $script:CepSystemBundleId -or $package.BundleVersion -cne $version) {
      throw 'Full CEP package bundle/version differs from its release manifest.'
    }
    $entries = @(Get-ZipEntryNames $packagePath)
    foreach ($required in @('META-INF/signatures.xml', 'mimetype', 'CSXS/manifest.xml', '.debug')) {
      if ($entries -cnotcontains $required) { throw "Full CEP package is missing $required." }
    }
    $payload = Assert-ZxpContentSignature -Path $packagePath
    if ($pins -cnotcontains [string]$payload.CertificateFingerprint) { throw 'Full CEP payload publisher is not pinned.' }

    $before = Get-CepDirectorySnapshotToken $target
    $installed = Assert-CepInstalledReleaseIntegrity -Directory $target `
      -ExpectedBundleId $script:CepSystemBundleId -TrustedCertificateFingerprints $pins
    if ($installed.BundleVersion -cne $version -or !(Test-CepVerifiedContentEqual -Left $payload -Right $installed)) {
      throw 'Full CEP installed content differs from the signed bundled payload.'
    }
    # The receipt's package hash may be null after preserving a manual install,
    # or belong to an earlier signing envelope of this exact content. Both
    # signatures and their signed references are the
    # authority; requiring equal ZIP hashes would reject a valid reissue.
    Assert-CepSystemLocation $selected
    Assert-FullCepOrdinaryPath -Path $target -Directory
    foreach ($path in $paths) { Assert-FullCepOrdinaryPath $path }
    if ((Get-CepDirectorySnapshotToken $target) -cne $before) {
      throw 'Full CEP installed content changed during verification.'
    }
    return [pscustomobject]@{ TargetPath = $target; BundleVersion = $version }
  } finally {
    foreach ($handle in $handles) { $handle.Dispose() }
  }
}
