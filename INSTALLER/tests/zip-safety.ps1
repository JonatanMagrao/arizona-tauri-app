$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $repoRoot "INSTALLER\scripts\common.ps1")

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if (!$Condition) {
    throw "Assertion failed: $Message"
  }
}

function New-TestZip {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object[]]$Entries
  )

  Add-Type -AssemblyName System.IO.Compression | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $archive = [System.IO.Compression.ZipFile]::Open(
    $Path,
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    foreach ($spec in $Entries) {
      $entry = $archive.CreateEntry([string]$spec.Name)
      if ($null -ne $spec.ExternalAttributes) {
        $entry.ExternalAttributes = [int]$spec.ExternalAttributes
      }
      $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$spec.Content)
      $stream = $entry.Open()
      try {
        $stream.Write($bytes, 0, $bytes.Length)
      } finally {
        $stream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
}

function Set-ZipReportedUncompressedSize {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][uint32]$ReportedSize
  )

  # Patch only the central-directory uncompressed-size field. ZipArchive then
  # reports the forged value through Entry.Length while the deflate stream still
  # yields the real bytes, reproducing the header-lie threat in a compact test.
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $sizeBytes = [System.BitConverter]::GetBytes($ReportedSize)
  $patched = 0
  for ($index = 0; $index -le $bytes.Length - 28; $index++) {
    if ($bytes[$index] -eq 0x50 -and
        $bytes[$index + 1] -eq 0x4B -and
        $bytes[$index + 2] -eq 0x01 -and
        $bytes[$index + 3] -eq 0x02) {
      $sizeBytes.CopyTo($bytes, $index + 24)
      $patched++
    }
  }
  if ($patched -eq 0) {
    throw "Test ZIP has no central-directory entry to patch: $Path"
  }
  [System.IO.File]::WriteAllBytes($Path, $bytes)
}

function Assert-ZipRejected {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Operation,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $rejected = $false
  try {
    & $Operation | Out-Null
  } catch {
    $rejected = $true
  }
  Assert-True $rejected $Message
}

$testParent = Join-Path ([System.IO.Path]::GetTempPath()) "ArizonaZipSafetyTests"
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

$originalLimits = [pscustomobject]@{
  Archive = $script:ArizonaMaxCepZxpBytes
  Entry = $script:ArizonaMaxCepZipEntryBytes
  Expanded = $script:ArizonaMaxCepZipExpandedBytes
  Count = $script:ArizonaMaxCepZipEntries
  Metadata = $script:ArizonaMaxCepMetadataBytes
}

try {
  $safeZip = Join-Path $testRoot "safe.zxp"
  New-TestZip -Path $safeZip -Entries @(
    [pscustomobject]@{ Name = "folder/data.txt"; Content = "signed bytes"; ExternalAttributes = $null }
  )
  $safeDestination = Join-Path $testRoot "safe-output"
  Expand-ZipToDirectory -Path $safeZip -Destination $safeDestination
  Assert-True (Test-Path -LiteralPath (Join-Path $safeDestination "folder\data.txt") -PathType Leaf) `
    "safe ZIP content should extract"

  $traversalZip = Join-Path $testRoot "traversal.zxp"
  New-TestZip -Path $traversalZip -Entries @(
    [pscustomobject]@{ Name = "../escape.txt"; Content = "escape"; ExternalAttributes = $null }
  )
  Assert-ZipRejected { Get-ZipEntryNames $traversalZip } "parent traversal must be rejected"

  $duplicateZip = Join-Path $testRoot "duplicate.zxp"
  New-TestZip -Path $duplicateZip -Entries @(
    [pscustomobject]@{ Name = "META-INF/signatures.xml"; Content = "one"; ExternalAttributes = $null },
    [pscustomobject]@{ Name = "meta-inf\SIGNATURES.XML"; Content = "two"; ExternalAttributes = $null }
  )
  Assert-ZipRejected { Get-ZipEntryNames $duplicateZip } "normalized case-insensitive duplicates must be rejected"

  $symlinkZip = Join-Path $testRoot "symlink.zxp"
  $symlinkMode = [uint32]::Parse(
    "A0000000",
    [System.Globalization.NumberStyles]::HexNumber
  )
  $symlinkAttributes = [System.BitConverter]::ToInt32(
    [System.BitConverter]::GetBytes($symlinkMode),
    0
  )
  New-TestZip -Path $symlinkZip -Entries @(
    [pscustomobject]@{ Name = "link"; Content = "target"; ExternalAttributes = $symlinkAttributes }
  )
  Assert-ZipRejected { Get-ZipEntryNames $symlinkZip } "Unix symbolic links must be rejected"

  $reparseZip = Join-Path $testRoot "reparse.zxp"
  $reparseAttributes = [int][System.IO.FileAttributes]::ReparsePoint
  New-TestZip -Path $reparseZip -Entries @(
    [pscustomobject]@{ Name = "link"; Content = "target"; ExternalAttributes = $reparseAttributes }
  )
  Assert-ZipRejected { Get-ZipEntryNames $reparseZip } "Windows reparse-point entries must be rejected"

  $smallZip = Join-Path $testRoot "small-limits.zxp"
  New-TestZip -Path $smallZip -Entries @(
    [pscustomobject]@{ Name = "one.txt"; Content = "12345"; ExternalAttributes = $null },
    [pscustomobject]@{ Name = "two.txt"; Content = "67890"; ExternalAttributes = $null }
  )

  $script:ArizonaMaxCepZipEntryBytes = 4
  Assert-ZipRejected { Get-ZipEntryNames $smallZip } "the per-entry uncompressed-size limit must be enforced"
  $script:ArizonaMaxCepZipEntryBytes = 100

  $script:ArizonaMaxCepZipExpandedBytes = 8
  Assert-ZipRejected { Get-ZipEntryNames $smallZip } "the total uncompressed-size limit must be enforced"
  $script:ArizonaMaxCepZipExpandedBytes = 100

  $script:ArizonaMaxCepZipEntries = 1
  Assert-ZipRejected { Get-ZipEntryNames $smallZip } "the entry-count limit must be enforced"
  $script:ArizonaMaxCepZipEntries = 10

  $script:ArizonaMaxCepMetadataBytes = 4
  Assert-ZipRejected { Get-ZipEntryText -Path $smallZip -EntryName "one.txt" } "the metadata read limit must be enforced"
  $script:ArizonaMaxCepMetadataBytes = 100

  $lyingZip = Join-Path $testRoot "lying-header.zxp"
  New-TestZip -Path $lyingZip -Entries @(
    [pscustomobject]@{ Name = "metadata.xml"; Content = ("x" * 100); ExternalAttributes = $null }
  )
  Set-ZipReportedUncompressedSize -Path $lyingZip -ReportedSize 1

  $script:ArizonaMaxCepZipEntryBytes = 16
  $script:ArizonaMaxCepZipExpandedBytes = 200
  Assert-True (@(Get-ZipEntryNames $lyingZip).Count -eq 1) `
    "forged small headers should pass preflight so the streaming guard is exercised"
  Assert-ZipRejected {
    Expand-ZipToDirectory -Path $lyingZip -Destination (Join-Path $testRoot "lying-entry-output")
  } "actual decompressed bytes must enforce the per-entry limit when headers lie"

  $script:ArizonaMaxCepZipEntryBytes = 200
  $script:ArizonaMaxCepZipExpandedBytes = 50
  Assert-ZipRejected {
    Expand-ZipToDirectory -Path $lyingZip -Destination (Join-Path $testRoot "lying-total-output")
  } "actual decompressed bytes must enforce the total expanded-size limit when headers lie"

  $script:ArizonaMaxCepZipExpandedBytes = 200
  $script:ArizonaMaxCepMetadataBytes = 16
  Assert-ZipRejected {
    Get-ZipEntryText -Path $lyingZip -EntryName "metadata.xml"
  } "metadata reads must enforce their actual byte limit when headers lie"

  $script:ArizonaMaxCepZxpBytes = 1
  Assert-ZipRejected { Get-ZipEntryNames $smallZip } "the compressed archive-size limit must be enforced"

  Write-Host "CEP ZIP safety tests passed."
} finally {
  $script:ArizonaMaxCepZxpBytes = $originalLimits.Archive
  $script:ArizonaMaxCepZipEntryBytes = $originalLimits.Entry
  $script:ArizonaMaxCepZipExpandedBytes = $originalLimits.Expanded
  $script:ArizonaMaxCepZipEntries = $originalLimits.Count
  $script:ArizonaMaxCepMetadataBytes = $originalLimits.Metadata

  $testRootFull = Get-FullPath $testRoot
  $testParentFull = Get-FullPath $testParent
  Assert-PathInside -Path $testRootFull -Parent $testParentFull -Label "ZIP safety test root"
  Remove-PathSafe -Path $testRootFull -AllowedParent $testParentFull -Label "ZIP safety test root"
  Remove-DirectoryIfEmptySafe -Path $testParentFull -AllowedParent ([System.IO.Path]::GetTempPath()) -Label "ZIP safety test parent" | Out-Null
}
