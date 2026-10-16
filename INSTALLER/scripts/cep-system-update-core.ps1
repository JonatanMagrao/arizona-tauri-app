# Privileged CEP update implementation. The executable wrapper supplies only
# the approved package and exact existing destination; tests replace discovery
# boundaries in their own process, never by adding privileged CLI overrides.
$script:CepSystemBundleId = 'com.arizona-carrefour.cep'

function Get-CepSystemCommonRoots {
  $roots = @(
    [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonProgramFiles),
    [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonProgramFilesX86)
  )
  # A 32-bit caller must also see the native Common Files directory. Read the
  # OS-owned machine registry, not caller-controlled environment variables.
  if ([Environment]::Is64BitOperatingSystem) {
    $machine = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
      [Microsoft.Win32.RegistryHive]::LocalMachine,
      [Microsoft.Win32.RegistryView]::Registry64
    )
    try {
      $key = $machine.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion')
      if ($null -ne $key) {
        try { $roots += [string]$key.GetValue('CommonFilesDir', '') }
        finally { $key.Dispose() }
      }
    } finally { $machine.Dispose() }
  }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($root in $roots) {
    if (![string]::IsNullOrWhiteSpace($root)) {
      $full = Get-CepSystemAbsolutePath $root
      if ($seen.Add($full)) { $full }
    }
  }
}

function Get-CepSystemAbsolutePath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ($Path -notmatch '^[A-Za-z]:[\\/]' -or $Path -match '[\x00-\x1f]' -or
      $Path.Substring(2).Contains(':')) {
    throw 'CEP update paths must be absolute local Windows paths.'
  }
  return (Get-FullPath $Path).TrimEnd('\', '/')
}

function Get-CepSystemPackagePath {
  param([Parameter(Mandatory = $true)][string]$Path)
  # A package on a network share is read-only input. Destinations continue to
  # use the stricter local path allowlist below.
  if ($Path -match '^\\\\[^\\]+\\[^\\]+\\' -and $Path -notmatch '^\\\\[?.]\\' -and
      !$Path.Contains(':') -and $Path -notmatch '[\x00-\x1f]') {
    return Get-FullPath $Path
  }
  return Get-CepSystemAbsolutePath $Path
}

function Get-CepSystemLocations {
  foreach ($root in @(Get-CepSystemCommonRoots | Sort-Object)) {
    $container = Join-Path $root 'Adobe\CEP'
    $extensions = Join-Path $container 'extensions'
    [pscustomobject]@{
      Root = $root
      Container = $container
      Extensions = $extensions
      Work = Join-Path $container '.arizona-install-work'
      Target = Join-Path $extensions $script:CepSystemBundleId
    }
  }
}

function Assert-CepSystemLocation {
  param([Parameter(Mandatory = $true)]$Location)
  $driveRoot = [IO.Path]::GetPathRoot($Location.Root)
  Assert-NoIntermediateReparsePoint -Path $Location.Root -TrustedRoot $driveRoot -IncludePath
  Assert-NoIntermediateReparsePoint -Path $Location.Target -TrustedRoot $Location.Root
  Assert-NoIntermediateReparsePoint -Path $Location.Work -TrustedRoot $Location.Root -IncludePath
  Assert-ArizonaCepPath -Path $Location.Target -ExpectedExtensionsRoot $Location.Extensions | Out-Null
}

function Get-CepSystemTrustedCertificates {
  # This path cannot be supplied by the caller of the elevated helper.
  $pins = @(Get-TrustedCepCertificateFingerprints (Join-Path $PSScriptRoot '..\cep-trusted-cert.json'))
  if ($pins.Count -eq 0) { throw 'No Arizona signing certificates are pinned.' }
  return $pins
}

function Assert-CepSystemPackage {
  param([string]$Path, [string]$Sha256, [string]$Version, [string[]]$Pins)
  if ((Get-FileSha256 $Path) -ine $Sha256) { throw 'CEP package changed or has an unexpected SHA-256.' }
  $info = Get-ZxpManifestInfo $Path
  if ($info.BundleId -cne $script:CepSystemBundleId -or $info.BundleVersion -cne $Version) {
    throw 'CEP package bundle/version differs from the confirmed package.'
  }
  ConvertTo-ArizonaSemVer $Version | Out-Null
  $entries = @(Get-ZipEntryNames $Path)
  foreach ($required in @('META-INF/signatures.xml', 'mimetype', 'CSXS/manifest.xml', '.debug')) {
    if ($entries -cnotcontains $required) { throw "CEP package is missing $required." }
  }
  $verified = Assert-ZxpContentSignature -Path $Path
  if ($Pins -cnotcontains [string]$verified.CertificateFingerprint) { throw 'CEP package publisher is not trusted.' }
  return [string]$verified.CertificateFingerprint
}

function Get-CepSystemSnapshot {
  param([Parameter(Mandatory = $true)]$Location)
  Assert-CepSystemLocation $Location
  $item = Get-PathItem $Location.Target
  if ($null -eq $item) { return [pscustomobject]@{ Kind = 'absent'; Token = ''; Version = '' } }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    return [pscustomobject]@{
      Kind = 'link'
      Token = (@(Get-JsonProperty $item 'Target') | ForEach-Object { [string]$_ }) -join "`n"
      # A development link is not a managed release. Preserve it without
      # reading, downgrading, or traversing its target.
      Version = ''
    }
  }
  if (!$item.PSIsContainer) { throw "Machine CEP destination is not a directory: $($Location.Target)" }
  $token = Get-CepDirectorySnapshotToken $Location.Target
  $manifest = Get-CepDirectoryManifestInfo -Directory $Location.Target
  if ($manifest.BundleId -cne $script:CepSystemBundleId) { throw 'Existing machine CEP folder contains another bundle.' }
  ConvertTo-ArizonaSemVer ([string]$manifest.BundleVersion) | Out-Null
  if ((Get-CepDirectorySnapshotToken $Location.Target) -cne $token) { throw 'Machine CEP changed while it was inspected.' }
  return [pscustomobject]@{ Kind = 'directory'; Token = $token; Version = [string]$manifest.BundleVersion }
}

function Assert-CepSystemSnapshot {
  param($Location, $Expected)
  $actual = Get-CepSystemSnapshot $Location
  if ($actual.Kind -cne $Expected.Kind -or $actual.Token -cne $Expected.Token -or
      $actual.Version -cne $Expected.Version) {
    throw "Machine CEP changed while the update was prepared: $($Location.Target)"
  }
}

function Assert-CepSystemDowngrade {
  param([object[]]$Snapshots, [string]$Version, [switch]$AllowDowngrade)
  if ($AllowDowngrade) { return }
  foreach ($snapshot in $Snapshots) {
    if ($snapshot.Kind -ceq 'directory' -and ![string]::IsNullOrWhiteSpace($snapshot.Version) -and
        (Compare-ArizonaSemVer $Version $snapshot.Version) -lt 0) {
      throw 'A newer machine CEP installation exists; explicit downgrade confirmation is required.'
    }
  }
}

function Assert-CepSystemAfterClosed {
  if (Test-AfterEffectsRunning) {
    $error = [InvalidOperationException]::new('Close After Effects before updating the extension.')
    $error.Data['CepExitCode'] = 20
    throw $error
  }
}

function Remove-CepSystemWorkDirectory {
  param([string]$Path, $Location)
  Assert-CepSystemLocation $Location
  Assert-PathInside -Path $Path -Parent $Location.Work -Label 'CEP update work directory'
  $item = Get-PathItem $Path
  if ($null -eq $item) { return }
  # Fail closed on links, including links anywhere inside a directory that is
  # about to be removed recursively.
  Get-SafeDirectoryContentFiles $Path | Out-Null
  Remove-PathSafe -Path $Path -AllowedParent $Location.Work -Label 'CEP update work directory'
}

function Invoke-CepSystemUpdate {
  param(
    [Parameter(Mandatory = $true)][string]$ZxpPath,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [switch]$AllowDowngrade
  )
  $source = Get-CepSystemPackagePath $ZxpPath
  $target = Get-CepSystemAbsolutePath $TargetPath
  if ([IO.Path]::GetExtension($source) -ine '.zxp' -or $ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'A ZXP and its confirmed SHA-256 are required.'
  }
  ConvertTo-ArizonaSemVer $ExpectedVersion | Out-Null
  $locations = @(Get-CepSystemLocations)
  $selected = @($locations | Where-Object { $_.Target.Equals($target, [StringComparison]::OrdinalIgnoreCase) })
  if ($selected.Count -ne 1) { throw 'Target is not an exact allowed machine CEP destination.' }
  $selected = $selected[0]
  foreach ($location in $locations) { Assert-CepSystemLocation $location }
  $initial = Get-CepSystemSnapshot $selected
  if ($initial.Kind -cne 'directory') { throw 'Selected machine CEP installation must still exist as a regular directory.' }
  Assert-CepSystemAfterClosed

  $locks = @()
  $packageLock = $null
  $staging = ''
  $backup = Join-Path $selected.Work "$script:CepSystemBundleId.bak"
  $retired = @()
  $committed = $false
  $transactionComplete = $false
  $newSnapshot = ''
  try {
    # Keep the inspected bytes immutable through extraction and commit.
    $packageLock = [IO.File]::Open($source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($packageLock.Length -gt $script:ArizonaMaxCepZxpBytes) { throw 'CEP package exceeds the size limit.' }
    $pins = @(Get-CepSystemTrustedCertificates)
    $publisher = Assert-CepSystemPackage -Path $source -Sha256 $ExpectedSha256 -Version $ExpectedVersion -Pins $pins

    # Lock all standard machine roots in deterministic order. The same file
    # lock also serializes this operation against the Full installer.
    foreach ($location in $locations) {
      Assert-CepSystemLocation $location
      New-Item -ItemType Directory -Force -Path $location.Work | Out-Null
      Assert-CepSystemLocation $location
      $lockPath = Join-Path $location.Work "$script:CepSystemBundleId.install.lock"
      Assert-NoIntermediateReparsePoint -Path $lockPath -TrustedRoot $location.Root -IncludePath
      $handle = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $locks += [pscustomobject]@{ Handle = $handle; Path = $lockPath; Location = $location }
    }
    Assert-CepSystemSnapshot -Location $selected -Expected $initial
    $baseline = @($locations | ForEach-Object { Get-CepSystemSnapshot $_ })
    Assert-CepSystemDowngrade -Snapshots $baseline -Version $ExpectedVersion -AllowDowngrade:$AllowDowngrade
    if ($null -ne (Get-PathItem $backup)) {
      throw 'A previous CEP recovery backup exists; preserve it and repair with the Full installer before retrying.'
    }
    $staging = Join-Path $selected.Work "$script:CepSystemBundleId.tmp-$([guid]::NewGuid().ToString('N'))"
    Assert-PathInside -Path $staging -Parent $selected.Work -Label 'CEP staging directory'
    Expand-ZipToDirectory -Path $source -Destination $staging
    $verified = Assert-CepInstalledReleaseIntegrity -Directory $staging -ExpectedBundleId $script:CepSystemBundleId -TrustedCertificateFingerprints $pins
    if ($verified.BundleVersion -cne $ExpectedVersion -or $verified.CertificateFingerprint -cne $publisher) {
      throw 'Extracted CEP release differs from the confirmed package.'
    }
    $newSnapshot = Get-CepDirectorySnapshotToken $staging

    Assert-CepSystemAfterClosed
    Assert-CepSystemPackage -Path $source -Sha256 $ExpectedSha256 -Version $ExpectedVersion -Pins $pins | Out-Null
    for ($i = 0; $i -lt $locations.Count; $i++) {
      Assert-CepSystemSnapshot -Location $locations[$i] -Expected $baseline[$i]
    }
    Assert-CepSystemDowngrade -Snapshots $baseline -Version $ExpectedVersion -AllowDowngrade:$AllowDowngrade
    Assert-NoIntermediateReparsePoint -Path $staging -TrustedRoot $selected.Root -IncludePath
    if ((Get-CepDirectorySnapshotToken $staging) -cne $newSnapshot) { throw 'CEP staging changed before commit.' }
    Assert-CepSystemAfterClosed
    Invoke-CepDirectorySwap -Destination $selected.Target -Staging $staging -Backup $backup -ExtensionsRoot $selected.Extensions -WorkRoot $selected.Work | Out-Null
    $committed = $true
    $installed = Assert-CepInstalledReleaseIntegrity -Directory $selected.Target -ExpectedBundleId $script:CepSystemBundleId -TrustedCertificateFingerprints $pins
    if ($installed.BundleVersion -cne $ExpectedVersion -or (Get-CepDirectorySnapshotToken $selected.Target) -cne $newSnapshot) {
      throw 'Committed CEP release failed verification.'
    }

    # Only now retire other normal machine copies. A development link and its
    # target remain untouched, even when their manifest has the same bundle ID.
    for ($i = 0; $i -lt $locations.Count; $i++) {
      $location = $locations[$i]
      if ($location.Target -ieq $selected.Target -or $baseline[$i].Kind -cne 'directory') { continue }
      Assert-CepSystemAfterClosed
      Assert-CepSystemSnapshot -Location $location -Expected $baseline[$i]
      Assert-CepSystemAfterClosed
      $quarantine = Join-Path $location.Work "$script:CepSystemBundleId.retired-$([guid]::NewGuid().ToString('N'))"
      Assert-PathInside -Path $quarantine -Parent $location.Work -Label 'retired machine CEP copy'
      [IO.Directory]::Move($location.Target, $quarantine)
      $retired += [pscustomobject]@{ Location = $location; Path = $quarantine; Snapshot = $baseline[$i] }
    }
    if ((Get-CepDirectorySnapshotToken $selected.Target) -cne $newSnapshot) { throw 'Installed CEP changed during consolidation.' }
    for ($i = 0; $i -lt $locations.Count; $i++) {
      if ($locations[$i].Target -ieq $selected.Target) { continue }
      $expected = $baseline[$i]
      if ($expected.Kind -ceq 'directory') { $expected = [pscustomobject]@{ Kind = 'absent'; Token = ''; Version = '' } }
      Assert-CepSystemSnapshot -Location $locations[$i] -Expected $expected
    }
    $transactionComplete = $true
    # Cleanup failure is safe: inactive backups remain outside Adobe's scan.
    foreach ($entry in @([pscustomobject]@{ Path = $backup; Location = $selected }) + $retired) {
      try { Remove-CepSystemWorkDirectory -Path $entry.Path -Location $entry.Location }
      catch { Write-Warning "CEP updated; inactive backup retained: $($entry.Path). $($_.Exception.Message)" }
    }
  } catch {
    $operationError = $_
    if (!$transactionComplete) {
      try {
        for ($i = $retired.Count - 1; $i -ge 0; $i--) {
          $entry = $retired[$i]
          Assert-CepSystemLocation $entry.Location
          if ($null -ne (Get-PathItem $entry.Location.Target)) { throw 'Cannot restore a retired CEP copy over a changed destination.' }
          if ((Get-CepDirectorySnapshotToken $entry.Path) -cne $entry.Snapshot.Token) { throw 'Retired CEP copy changed before rollback.' }
          [IO.Directory]::Move($entry.Path, $entry.Location.Target)
        }
        if ($committed) {
          Assert-CepSystemLocation $selected
          if ((Get-CepDirectorySnapshotToken $selected.Target) -cne $newSnapshot -or
              (Get-CepDirectorySnapshotToken $backup) -cne $initial.Token) { throw 'Cannot roll back changed CEP contents; recovery backup preserved.' }
          [IO.Directory]::Move($selected.Target, $staging)
          [IO.Directory]::Move($backup, $selected.Target)
          Assert-CepSystemSnapshot -Location $selected -Expected $initial
        }
      } catch {
        throw "CEP update failed: $($operationError.Exception.Message). Rollback needs recovery from $backup`: $($_.Exception.Message)"
      }
    }
    throw $operationError
  } finally {
    if (![string]::IsNullOrWhiteSpace($staging)) {
      try { Remove-CepSystemWorkDirectory -Path $staging -Location $selected } catch { Write-Warning $_.Exception.Message }
    }
    for ($i = $locks.Count - 1; $i -ge 0; $i--) {
      $entry = $locks[$i]
      $entry.Handle.Dispose()
      try {
        Assert-CepSystemLocation $entry.Location
        Remove-Item -LiteralPath $entry.Path -Force
        Remove-DirectoryIfEmptySafe -Path $entry.Location.Work -AllowedParent $entry.Location.Container | Out-Null
      } catch { }
    }
    if ($null -ne $packageLock) { $packageLock.Dispose() }
  }
}
