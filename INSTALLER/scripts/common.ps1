$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Keep these limits in lockstep with src-tauri/src/cep_manager.rs. A CEP ZXP is
# normally only a few megabytes; these ceilings leave ample release headroom
# while preventing a crafted archive from exhausting disk or memory.
$script:ArizonaMaxCepZxpBytes = 256MB
$script:ArizonaMaxCepZipEntryBytes = 128MB
$script:ArizonaMaxCepZipExpandedBytes = 512MB
$script:ArizonaMaxCepZipEntries = 4096
$script:ArizonaMaxCepMetadataBytes = 2MB

function Get-InstallerLogRoot {
  param([string]$LogRoot = "")

  if (![string]::IsNullOrWhiteSpace($LogRoot)) {
    return $LogRoot
  }

  if (![string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    return (Join-Path $env:LOCALAPPDATA "Arizona Installer\logs")
  }

  return (Join-Path $env:TEMP "Arizona Installer\logs")
}

function Write-InstallerLog {
  param(
    [string]$Message,
    [string]$LogRoot = ""
  )

  $resolvedLogRoot = Get-InstallerLogRoot $LogRoot
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  try {
    New-Item -ItemType Directory -Force -Path $resolvedLogRoot | Out-Null
    $logFile = Join-Path $resolvedLogRoot "installer.log"
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  } catch {
    $fallbackLogRoot = Join-Path $env:TEMP "Arizona Installer\logs"
    if ($resolvedLogRoot -ne $fallbackLogRoot) {
      try {
        New-Item -ItemType Directory -Force -Path $fallbackLogRoot | Out-Null
        Add-Content -LiteralPath (Join-Path $fallbackLogRoot "installer.log") -Value $line -Encoding UTF8
      } catch {
        # Logging must never make install/release validation fail.
      }
    }
  }
  Write-Host $Message
}

function Test-AfterEffectsRunning {
  param([string]$ProcessName = "AfterFX")

  return $null -ne (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Get-SystemCommonProgramFiles {
  # The official NSIS bootstrapper is currently 32-bit. Windows exposes the
  # native 64-bit Common Files path through CommonProgramW6432 in that process;
  # CommonProgramFiles alone would incorrectly select Program Files (x86).
  foreach ($candidate in @($env:CommonProgramW6432, $env:CommonProgramFiles)) {
    if (![string]::IsNullOrWhiteSpace([string]$candidate)) {
      return Get-FullPath ([string]$candidate)
    }
  }
  throw "Neither CommonProgramW6432 nor CommonProgramFiles is available."
}

function Test-PathInside {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )

  $fullPath = Get-FullPath $Path
  $fullParent = (Get-FullPath $Parent).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  return $fullPath.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-PathInside {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent,
    [string]$Label = "path"
  )

  if (!(Test-PathInside -Path $Path -Parent $Parent)) {
    throw "$Label is outside the expected parent. Path: $Path Parent: $Parent"
  }
}

function Get-FileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
    return ""
  }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Get-JsonProperty {
  param(
    $Object,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ($null -eq $Object) {
    return $null
  }

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

# The signed .zxp is the only shape the CEP extension travels in. Copying a
# build folder produces a tree that no longer matches META-INF/signatures.xml,
# so every helper below reads the package instead of loose files.
function Get-SafeZipEntryRelativePath {
  param([Parameter(Mandatory = $true)][string]$EntryName)

  $normalized = $EntryName.Replace("\", "/")
  if ($normalized.StartsWith("/") -or $normalized.Contains(":")) {
    throw "Unsafe absolute ZIP entry: $EntryName"
  }

  $components = @()
  foreach ($component in $normalized.Split("/")) {
    if ([string]::IsNullOrEmpty($component) -or $component -eq ".") {
      continue
    }
    if ($component -eq "..") {
      throw "Unsafe parent traversal in ZIP entry: $EntryName"
    }
    $components += $component
  }

  if ($components.Count -eq 0) {
    throw "ZIP entry has no usable relative path: $EntryName"
  }
  return ($components -join "/")
}

function Assert-OpenZipArchiveSafe {
  param(
    [Parameter(Mandatory = $true)]$Archive,
    [Parameter(Mandatory = $true)][string]$Path
  )

  if ($Archive.Entries.Count -eq 0) {
    throw "Archive is empty: $Path"
  }
  if ($Archive.Entries.Count -gt $script:ArizonaMaxCepZipEntries) {
    throw "Archive has too many entries (max $script:ArizonaMaxCepZipEntries): $Path"
  }

  $names = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  [long]$expandedBytes = 0
  foreach ($entry in $Archive.Entries) {
    $relative = Get-SafeZipEntryRelativePath $entry.FullName
    if (!$names.Add($relative)) {
      throw "Archive has a duplicate normalized entry: $($entry.FullName)"
    }

    if ([long]$entry.Length -gt [long]$script:ArizonaMaxCepZipEntryBytes) {
      throw "ZIP entry exceeds the per-entry limit: $($entry.FullName)"
    }
    $expandedBytes += [long]$entry.Length
    if ($expandedBytes -gt [long]$script:ArizonaMaxCepZipExpandedBytes) {
      throw "Archive exceeds the total expanded-size limit: $Path"
    }

    # ZIP external attributes carry Unix file type in the high word and
    # Windows FileAttributes in the low word. Never materialize a link from a
    # package: the installed tree must contain ordinary signed bytes only.
    $unixFileType = (([int64]$entry.ExternalAttributes -shr 16) -band 0xF000)
    $windowsAttributes = ([int64]$entry.ExternalAttributes -band 0xFFFF)
    if ($unixFileType -eq 0xA000 -or
        ($windowsAttributes -band [int][System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Archive contains a symbolic link or reparse point: $($entry.FullName)"
    }
  }
}

function Open-ZipArchiveRead {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Archive not found: $Path"
  }

  $fullPath = Get-FullPath $Path
  $archiveFile = Get-Item -LiteralPath $fullPath -Force
  if ([long]$archiveFile.Length -le 0 -or
      [long]$archiveFile.Length -gt [long]$script:ArizonaMaxCepZxpBytes) {
    throw "Archive size is outside the allowed range (max $script:ArizonaMaxCepZxpBytes bytes): $fullPath"
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
  $archive = [System.IO.Compression.ZipFile]::OpenRead($fullPath)
  try {
    Assert-OpenZipArchiveSafe -Archive $archive -Path $fullPath
  } catch {
    $archive.Dispose()
    throw
  }
  return $archive
}

function Get-ZipEntryNames {
  param([Parameter(Mandatory = $true)][string]$Path)

  $archive = Open-ZipArchiveRead $Path
  try {
    return @($archive.Entries | ForEach-Object { $_.FullName })
  } finally {
    $archive.Dispose()
  }
}

function Assert-NoZipSourceMapEntries {
  param(
    [Parameter(Mandatory = $true)][string[]]$EntryNames,
    [string]$Label = "CEP ZXP"
  )

  foreach ($entryName in $EntryNames) {
    $normalized = Get-SafeZipEntryRelativePath $entryName
    if ($normalized.EndsWith(".map", [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "$Label contains a forbidden source-map entry: $entryName"
    }
  }
}

function Copy-ZipEntryStreamWithLimits {
  param(
    [Parameter(Mandatory = $true)][System.IO.Stream]$InputStream,
    [Parameter(Mandatory = $true)][System.IO.Stream]$OutputStream,
    [Parameter(Mandatory = $true)][string]$EntryName,
    [Parameter(Mandatory = $true)][long]$ExpectedLength,
    [Parameter(Mandatory = $true)][long]$EntryLimit,
    [Parameter(Mandatory = $true)][long]$TotalLimit,
    [Parameter(Mandatory = $true)][ref]$TotalBytes
  )

  # ZipArchiveEntry.Length comes from attacker-controlled central-directory
  # metadata. Count the bytes that the decompressor actually yields as well,
  # otherwise a forged header could bypass the preflight limits.
  [byte[]]$buffer = New-Object byte[] (64KB)
  [long]$entryBytes = 0
  while (($read = $InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $entryBytes += [long]$read
    if ($entryBytes -gt $EntryLimit) {
      throw "ZIP entry exceeds the actual per-entry limit: $EntryName"
    }

    [long]$nextTotal = [long]$TotalBytes.Value + [long]$read
    if ($nextTotal -gt $TotalLimit) {
      throw "Archive exceeds the actual total expanded-size limit while reading: $EntryName"
    }

    $OutputStream.Write($buffer, 0, $read)
    $TotalBytes.Value = $nextTotal
  }

  if ($entryBytes -ne $ExpectedLength) {
    throw "ZIP entry actual size does not match its header: $EntryName"
  }
}

function Get-Sha256Base64FromLimitedStream {
  param(
    [Parameter(Mandatory = $true)][System.IO.Stream]$InputStream,
    [Parameter(Mandatory = $true)][string]$EntryName,
    [Parameter(Mandatory = $true)][long]$ExpectedLength,
    [Parameter(Mandatory = $true)][long]$EntryLimit,
    [Parameter(Mandatory = $true)][long]$TotalLimit,
    [Parameter(Mandatory = $true)][ref]$TotalBytes
  )

  $sha = [System.Security.Cryptography.SHA256]::Create()
  $crypto = $null
  try {
    $crypto = [System.Security.Cryptography.CryptoStream]::new(
      [System.IO.Stream]::Null,
      $sha,
      [System.Security.Cryptography.CryptoStreamMode]::Write
    )
    Copy-ZipEntryStreamWithLimits `
      -InputStream $InputStream `
      -OutputStream $crypto `
      -EntryName $EntryName `
      -ExpectedLength $ExpectedLength `
      -EntryLimit $EntryLimit `
      -TotalLimit $TotalLimit `
      -TotalBytes $TotalBytes
    $crypto.FlushFinalBlock()
    return [Convert]::ToBase64String($sha.Hash)
  } finally {
    if ($null -ne $crypto) {
      $crypto.Dispose()
    }
    $sha.Dispose()
  }
}

function Read-TextFromLimitedStream {
  param(
    [Parameter(Mandatory = $true)][System.IO.Stream]$InputStream,
    [Parameter(Mandatory = $true)][string]$EntryName,
    [Parameter(Mandatory = $true)][long]$ExpectedLength,
    [Parameter(Mandatory = $true)][long]$Limit,
    [Parameter(Mandatory = $true)][ref]$TotalBytes
  )

  $memory = New-Object System.IO.MemoryStream
  try {
    Copy-ZipEntryStreamWithLimits `
      -InputStream $InputStream `
      -OutputStream $memory `
      -EntryName $EntryName `
      -ExpectedLength $ExpectedLength `
      -EntryLimit $Limit `
      -TotalLimit $Limit `
      -TotalBytes $TotalBytes
    $memory.Position = 0
    $reader = New-Object System.IO.StreamReader($memory)
    try {
      return $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } finally {
    $memory.Dispose()
  }
}

function Get-ZipEntryText {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$EntryName,
    [long]$MaxBytes = $script:ArizonaMaxCepMetadataBytes
  )

  $archive = Open-ZipArchiveRead $Path
  try {
    $wanted = Get-SafeZipEntryRelativePath $EntryName
    $entry = @($archive.Entries | Where-Object {
      (Get-SafeZipEntryRelativePath $_.FullName).Equals(
        $wanted,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    }) | Select-Object -First 1
    if ($null -eq $entry) {
      return ""
    }
    if ([long]$entry.Length -gt $MaxBytes) {
      throw "ZIP metadata entry exceeds the read limit: $EntryName"
    }

    $stream = $entry.Open()
    try {
      [long]$actualBytes = 0
      return Read-TextFromLimitedStream `
        -InputStream $stream `
        -EntryName $entry.FullName `
        -ExpectedLength ([long]$entry.Length) `
        -Limit $MaxBytes `
        -TotalBytes ([ref]$actualBytes)
    } finally {
      $stream.Dispose()
    }
  } finally {
    $archive.Dispose()
  }
}

function Expand-ZipToDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $destinationFull = Get-FullPath $Destination
  if ($null -ne (Get-PathItem $destinationFull)) {
    throw "Extraction destination already exists: $destinationFull"
  }

  $archive = Open-ZipArchiveRead $Path
  try {
    New-Item -ItemType Directory -Force -Path $destinationFull | Out-Null
    $destinationItem = Get-PathItem $destinationFull
    if ($null -eq $destinationItem -or
        !$destinationItem.PSIsContainer -or
        ($destinationItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "ZIP extraction destination is not an ordinary directory: $destinationFull"
    }
    [long]$actualExpandedBytes = 0
    foreach ($entry in $archive.Entries) {
      $relative = Get-SafeZipEntryRelativePath $entry.FullName
      $relativeForWindows = $relative.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
      $target = Get-FullPath (Join-Path $destinationFull $relativeForWindows)
      Assert-PathInside -Path $target -Parent $destinationFull -Label "ZIP extraction target"

      $isDirectory = [string]::IsNullOrEmpty($entry.Name) -or
        $entry.FullName.EndsWith("/") -or
        $entry.FullName.EndsWith("\")
      if ($isDirectory) {
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        $directoryItem = Get-PathItem $target
        if ($null -eq $directoryItem -or
            !$directoryItem.PSIsContainer -or
            ($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
          throw "ZIP extraction path is not an ordinary directory: $target"
        }
        continue
      }

      $parent = Split-Path -Parent $target
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
      $parentItem = Get-PathItem $parent
      if ($null -eq $parentItem -or
          !$parentItem.PSIsContainer -or
          ($parentItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "ZIP extraction parent is not an ordinary directory: $parent"
      }
      $input = $entry.Open()
      try {
        $output = [System.IO.File]::Open(
          $target,
          [System.IO.FileMode]::CreateNew,
          [System.IO.FileAccess]::Write,
          [System.IO.FileShare]::None
        )
        try {
          Copy-ZipEntryStreamWithLimits `
            -InputStream $input `
            -OutputStream $output `
            -EntryName $entry.FullName `
            -ExpectedLength ([long]$entry.Length) `
            -EntryLimit ([long]$script:ArizonaMaxCepZipEntryBytes) `
            -TotalLimit ([long]$script:ArizonaMaxCepZipExpandedBytes) `
            -TotalBytes ([ref]$actualExpandedBytes)
        } finally {
          $output.Dispose()
        }
      } finally {
        $input.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
}

function ConvertTo-SafeXmlDocument {
  param(
    [Parameter(Mandatory = $true)][string]$Xml,
    [string]$Label = "XML"
  )

  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $settings.MaxCharactersFromEntities = 0
  $settings.MaxCharactersInDocument = [long]$script:ArizonaMaxCepMetadataBytes

  $document = New-Object System.Xml.XmlDocument
  $document.PreserveWhitespace = $true
  $document.XmlResolver = $null
  $textReader = New-Object System.IO.StringReader($Xml)
  try {
    $reader = [System.Xml.XmlReader]::Create($textReader, $settings)
    try {
      $document.Load($reader)
    } finally {
      $reader.Dispose()
    }
  } catch {
    throw "$Label is not valid safe XML: $($_.Exception.Message)"
  } finally {
    $textReader.Dispose()
  }
  return $document
}

function Get-ZxpManifestInfo {
  param([Parameter(Mandatory = $true)][string]$Path)

  $manifestXml = Get-ZipEntryText -Path $Path -EntryName "CSXS/manifest.xml"
  if ([string]::IsNullOrWhiteSpace($manifestXml)) {
    throw "The .zxp has no CSXS/manifest.xml: $Path"
  }

  $document = ConvertTo-SafeXmlDocument -Xml $manifestXml -Label "CSXS/manifest.xml"
  $root = $document.DocumentElement
  $bundleId = $root.GetAttribute("ExtensionBundleId")
  $bundleVersion = $root.GetAttribute("ExtensionBundleVersion")
  if ([string]::IsNullOrWhiteSpace($bundleId) -or [string]::IsNullOrWhiteSpace($bundleVersion)) {
    throw "CSXS/manifest.xml has no ExtensionBundleId/ExtensionBundleVersion: $Path"
  }

  return [pscustomobject]@{
    BundleId = $bundleId
    BundleVersion = $bundleVersion
  }
}

# CEP bundle versions follow SemVer. Keep the comparison independent from
# System.Version: prerelease precedence is significant and SemVer identifiers
# may be larger than a CLR integer.
function ConvertTo-ArizonaSemVer {
  param([Parameter(Mandatory = $true)][string]$Version)

  $match = [regex]::Match(
    $Version,
    '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
  )
  if (!$match.Success) {
    throw "Invalid CEP semantic version: $Version"
  }

  $prerelease = @()
  if ($match.Groups[4].Success) {
    $prerelease = @($match.Groups[4].Value.Split('.'))
    foreach ($identifier in $prerelease) {
      if ($identifier -cmatch '^[0-9]+$' -and $identifier.Length -gt 1 -and $identifier.StartsWith('0')) {
        throw "Invalid CEP semantic version prerelease identifier: $Version"
      }
    }
  }

  return [pscustomobject]@{
    Original = $Version
    Major = $match.Groups[1].Value
    Minor = $match.Groups[2].Value
    Patch = $match.Groups[3].Value
    Prerelease = $prerelease
  }
}

function Compare-ArizonaSemVerNumericIdentifier {
  param(
    [Parameter(Mandatory = $true)][string]$Left,
    [Parameter(Mandatory = $true)][string]$Right
  )

  if ($Left.Length -lt $Right.Length) {
    return -1
  }
  if ($Left.Length -gt $Right.Length) {
    return 1
  }
  $comparison = [string]::CompareOrdinal($Left, $Right)
  if ($comparison -lt 0) {
    return -1
  }
  if ($comparison -gt 0) {
    return 1
  }
  return 0
}

function Compare-ArizonaSemVer {
  param(
    [Parameter(Mandatory = $true)][string]$Left,
    [Parameter(Mandatory = $true)][string]$Right
  )

  $leftVersion = ConvertTo-ArizonaSemVer $Left
  $rightVersion = ConvertTo-ArizonaSemVer $Right
  foreach ($component in @('Major', 'Minor', 'Patch')) {
    $comparison = Compare-ArizonaSemVerNumericIdentifier `
      -Left ([string]$leftVersion.$component) `
      -Right ([string]$rightVersion.$component)
    if ($comparison -ne 0) {
      return $comparison
    }
  }

  $leftPrerelease = @($leftVersion.Prerelease)
  $rightPrerelease = @($rightVersion.Prerelease)
  if ($leftPrerelease.Count -eq 0 -and $rightPrerelease.Count -eq 0) {
    return 0
  }
  if ($leftPrerelease.Count -eq 0) {
    return 1
  }
  if ($rightPrerelease.Count -eq 0) {
    return -1
  }

  $sharedCount = [Math]::Min($leftPrerelease.Count, $rightPrerelease.Count)
  for ($index = 0; $index -lt $sharedCount; $index++) {
    $leftIdentifier = [string]$leftPrerelease[$index]
    $rightIdentifier = [string]$rightPrerelease[$index]
    $leftIsNumeric = $leftIdentifier -cmatch '^[0-9]+$'
    $rightIsNumeric = $rightIdentifier -cmatch '^[0-9]+$'
    if ($leftIsNumeric -and $rightIsNumeric) {
      $comparison = Compare-ArizonaSemVerNumericIdentifier `
        -Left $leftIdentifier `
        -Right $rightIdentifier
    } elseif ($leftIsNumeric) {
      $comparison = -1
    } elseif ($rightIsNumeric) {
      $comparison = 1
    } else {
      $comparison = [string]::CompareOrdinal($leftIdentifier, $rightIdentifier)
      if ($comparison -lt 0) {
        $comparison = -1
      } elseif ($comparison -gt 0) {
        $comparison = 1
      }
    }
    if ($comparison -ne 0) {
      return $comparison
    }
  }

  if ($leftPrerelease.Count -lt $rightPrerelease.Count) {
    return -1
  }
  if ($leftPrerelease.Count -gt $rightPrerelease.Count) {
    return 1
  }
  return 0
}

function Get-CepDirectoryManifestInfo {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    $Files = $null
  )

  $root = Get-FullPath $Directory
  if ($null -eq $Files) {
    $Files = Get-SafeDirectoryContentFiles $root
  }
  $manifestName = 'CSXS/manifest.xml'
  if (!$Files.ContainsKey($manifestName)) {
    throw "CEP content tree has no $manifestName`: $root"
  }

  $manifestFile = $Files[$manifestName]
  [long]$actualBytes = 0
  $stream = [System.IO.File]::Open(
    $manifestFile.FullName,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  try {
    $manifestXml = Read-TextFromLimitedStream `
      -InputStream $stream `
      -EntryName $manifestName `
      -ExpectedLength ([long]$manifestFile.Length) `
      -Limit ([long]$script:ArizonaMaxCepMetadataBytes) `
      -TotalBytes ([ref]$actualBytes)
  } finally {
    $stream.Dispose()
  }

  $document = ConvertTo-SafeXmlDocument -Xml $manifestXml -Label "$manifestName in $root"
  $bundleId = $document.DocumentElement.GetAttribute('ExtensionBundleId')
  $bundleVersion = $document.DocumentElement.GetAttribute('ExtensionBundleVersion')
  if ([string]::IsNullOrWhiteSpace($bundleId) -or [string]::IsNullOrWhiteSpace($bundleVersion)) {
    throw "CEP content tree manifest has no ExtensionBundleId/ExtensionBundleVersion: $root"
  }

  return [pscustomobject]@{
    BundleId = $bundleId
    BundleVersion = $bundleVersion
  }
}

# P2 fingerprint contract, shared with src-tauri/src/cep_manager.rs: lowercase
# hex SHA-256 over the raw DER bytes of the signing certificate. Exactly one
# certificate may exist in the XML document, and it must be the sole element
# under Signature > KeyInfo > X509Data in the XMLDSig namespace.
function Get-CepSigningCertificateFingerprintFromXml {
  param(
    [Parameter(Mandatory = $true)][string]$Xml,
    [string]$Label = "META-INF/signatures.xml"
  )

  $document = ConvertTo-SafeXmlDocument -Xml $Xml -Label $Label
  $allCertificates = @($document.SelectNodes("//*[local-name()='X509Certificate']"))
  if ($allCertificates.Count -ne 1) {
    throw "$Label must contain exactly one X509Certificate element (found $($allCertificates.Count))."
  }

  $signatures = @($document.SelectNodes("//*[local-name()='Signature']"))
  if ($signatures.Count -ne 1) {
    throw "$Label must contain exactly one Signature element (found $($signatures.Count))."
  }
  $xmlDsigNamespace = "http://www.w3.org/2000/09/xmldsig#"
  if ($signatures[0].NamespaceURI -ne $xmlDsigNamespace) {
    throw "$Label Signature must use the XMLDSig namespace."
  }

  $allKeyInfoNodes = @($document.SelectNodes("//*[local-name()='KeyInfo']"))
  if ($allKeyInfoNodes.Count -ne 1) {
    throw "$Label must contain exactly one KeyInfo element (found $($allKeyInfoNodes.Count))."
  }

  $keyInfoNodes = @($signatures[0].SelectNodes("./*[local-name()='KeyInfo']"))
  if ($keyInfoNodes.Count -ne 1) {
    throw "$Label Signature must contain exactly one direct KeyInfo element."
  }
  if (![object]::ReferenceEquals($allKeyInfoNodes[0], $keyInfoNodes[0])) {
    throw "$Label KeyInfo must be the direct child of Signature."
  }
  if ($keyInfoNodes[0].NamespaceURI -ne $xmlDsigNamespace) {
    throw "$Label KeyInfo must use the XMLDSig namespace."
  }
  $keyInfoElementChildren = @($keyInfoNodes[0].ChildNodes | Where-Object {
    $_.NodeType -eq [System.Xml.XmlNodeType]::Element
  })
  if ($keyInfoElementChildren.Count -ne 1 -or
      $keyInfoElementChildren[0].LocalName -ne "X509Data" -or
      $keyInfoElementChildren[0].NamespaceURI -ne $xmlDsigNamespace) {
    throw "$Label KeyInfo must contain only one X509Data element."
  }

  $allX509DataNodes = @($document.SelectNodes("//*[local-name()='X509Data']"))
  if ($allX509DataNodes.Count -ne 1) {
    throw "$Label must contain exactly one X509Data element (found $($allX509DataNodes.Count))."
  }

  $x509Data = $keyInfoElementChildren[0]
  if (![object]::ReferenceEquals($allX509DataNodes[0], $x509Data)) {
    throw "$Label X509Data must be the sole direct child of KeyInfo."
  }
  $x509DataElementChildren = @($x509Data.ChildNodes | Where-Object {
    $_.NodeType -eq [System.Xml.XmlNodeType]::Element
  })
  if ($x509DataElementChildren.Count -ne 1 -or
      $x509DataElementChildren[0].LocalName -ne "X509Certificate" -or
      $x509DataElementChildren[0].NamespaceURI -ne $xmlDsigNamespace) {
    throw "$Label X509Data must contain only one X509Certificate element."
  }

  $certificateElementChildren = @($x509DataElementChildren[0].ChildNodes | Where-Object {
    $_.NodeType -eq [System.Xml.XmlNodeType]::Element
  })
  if ($certificateElementChildren.Count -ne 0) {
    throw "$Label X509Certificate must contain text only."
  }

  $encoded = ($x509DataElementChildren[0].InnerText -replace "\s", "")
  if ([string]::IsNullOrWhiteSpace($encoded)) {
    throw "$Label has an empty X509Certificate element."
  }

  try {
    $der = [Convert]::FromBase64String($encoded)
  } catch {
    throw "$Label has an X509Certificate that is not valid base64."
  }
  if ($der.Length -eq 0) {
    throw "$Label has an empty decoded X509Certificate."
  }

  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $sha.ComputeHash($der)
  } finally {
    $sha.Dispose()
  }
  return (($hashBytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Get-ZxpSigningCertificateFingerprint {
  param([Parameter(Mandatory = $true)][string]$Path)

  $signatures = Get-ZipEntryText -Path $Path -EntryName "META-INF/signatures.xml"
  if ([string]::IsNullOrWhiteSpace($signatures)) {
    throw "The .zxp is not signed: META-INF/signatures.xml is missing from $Path"
  }

  return Get-CepSigningCertificateFingerprintFromXml `
    -Xml $signatures `
    -Label "META-INF/signatures.xml in $Path"
}

function Get-XmlElementChildren {
  param([Parameter(Mandatory = $true)][System.Xml.XmlNode]$Node)

  return @($Node.ChildNodes | Where-Object {
    $_.NodeType -eq [System.Xml.XmlNodeType]::Element
  })
}

function Get-CepSignatureProfileFromXml {
  param(
    [Parameter(Mandatory = $true)][string]$Xml,
    [string]$Label = "META-INF/signatures.xml"
  )

  $xmlDsigNamespace = "http://www.w3.org/2000/09/xmldsig#"
  $canonicalizationAlgorithm = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
  $signatureAlgorithm = "http://www.w3.org/2000/09/xmldsig#rsa-sha1"
  $digestAlgorithm = "http://www.w3.org/2001/04/xmlenc#sha256"
  $manifestType = "http://www.w3.org/2000/09/xmldsig#Manifest"

  # This call applies the shared anti-ambiguity rules for Signature, KeyInfo,
  # X509Data and the sole embedded certificate before any key is trusted.
  $fingerprint = Get-CepSigningCertificateFingerprintFromXml -Xml $Xml -Label $Label
  $document = ConvertTo-SafeXmlDocument -Xml $Xml -Label $Label
  $signature = @($document.SelectNodes("//*[local-name()='Signature']"))[0]

  if ($signature.GetAttribute("Id") -cne "PackageSignature") {
    throw "$Label Signature must have Id=PackageSignature."
  }

  $signatureChildren = @(Get-XmlElementChildren $signature)
  foreach ($child in $signatureChildren) {
    if ($child.NamespaceURI -cne $xmlDsigNamespace -or
        @("SignedInfo", "SignatureValue", "KeyInfo", "Object") -cnotcontains $child.LocalName) {
      throw "$Label Signature contains an unsupported direct element: $($child.Name)"
    }
  }

  $signedInfoNodes = @($signatureChildren | Where-Object { $_.LocalName -ceq "SignedInfo" })
  $signatureValueNodes = @($signatureChildren | Where-Object { $_.LocalName -ceq "SignatureValue" })
  $keyInfoNodes = @($signatureChildren | Where-Object { $_.LocalName -ceq "KeyInfo" })
  $objectNodes = @($signatureChildren | Where-Object { $_.LocalName -ceq "Object" })
  if ($signedInfoNodes.Count -ne 1 -or
      $signatureValueNodes.Count -ne 1 -or
      $keyInfoNodes.Count -ne 1 -or
      $objectNodes.Count -lt 1) {
    throw "$Label does not match the required Adobe Signature element profile."
  }

  $signedInfo = $signedInfoNodes[0]
  $signedInfoChildren = @(Get-XmlElementChildren $signedInfo)
  $signedInfoNames = @($signedInfoChildren | ForEach-Object { $_.LocalName })
  if ($signedInfoChildren.Count -ne 3 -or
      ($signedInfoNames -join ",") -cne "CanonicalizationMethod,SignatureMethod,Reference" -or
      @($signedInfoChildren | Where-Object { $_.NamespaceURI -cne $xmlDsigNamespace }).Count -ne 0) {
    throw "$Label SignedInfo must contain exactly CanonicalizationMethod, SignatureMethod and one Reference."
  }

  $canonicalization = $signedInfoChildren[0]
  $signatureMethod = $signedInfoChildren[1]
  $signedInfoReference = $signedInfoChildren[2]
  if ($canonicalization.GetAttribute("Algorithm") -cne $canonicalizationAlgorithm -or
      @(Get-XmlElementChildren $canonicalization).Count -ne 0) {
    throw "$Label uses an unsupported SignedInfo canonicalization algorithm."
  }
  if ($signatureMethod.GetAttribute("Algorithm") -cne $signatureAlgorithm -or
      @(Get-XmlElementChildren $signatureMethod).Count -ne 0) {
    throw "$Label uses an unsupported signature algorithm; Adobe rsa-sha1 is required."
  }
  if ($signedInfoReference.GetAttribute("URI") -cne "#PackageContents" -or
      $signedInfoReference.GetAttribute("Type") -cne $manifestType) {
    throw "$Label SignedInfo must reference the PackageContents Manifest."
  }

  $signedReferenceChildren = @(Get-XmlElementChildren $signedInfoReference)
  $signedReferenceNames = @($signedReferenceChildren | ForEach-Object { $_.LocalName })
  if ($signedReferenceChildren.Count -ne 3 -or
      ($signedReferenceNames -join ",") -cne "Transforms,DigestMethod,DigestValue" -or
      @($signedReferenceChildren | Where-Object { $_.NamespaceURI -cne $xmlDsigNamespace }).Count -ne 0) {
    throw "$Label PackageContents Reference does not match the required profile."
  }
  $transformNodes = @(Get-XmlElementChildren $signedReferenceChildren[0])
  if ($transformNodes.Count -ne 1 -or
      $transformNodes[0].LocalName -cne "Transform" -or
      $transformNodes[0].NamespaceURI -cne $xmlDsigNamespace -or
      $transformNodes[0].GetAttribute("Algorithm") -cne $canonicalizationAlgorithm -or
      @(Get-XmlElementChildren $transformNodes[0]).Count -ne 0) {
    throw "$Label PackageContents Reference must use exactly the XML C14N transform."
  }
  if ($signedReferenceChildren[1].GetAttribute("Algorithm") -cne $digestAlgorithm -or
      @(Get-XmlElementChildren $signedReferenceChildren[1]).Count -ne 0 -or
      @(Get-XmlElementChildren $signedReferenceChildren[2]).Count -ne 0) {
    throw "$Label PackageContents Reference must use SHA-256 and a text DigestValue."
  }

  $manifestNodes = @($document.SelectNodes("//*[local-name()='Manifest']"))
  if ($manifestNodes.Count -ne 1 -or
      $manifestNodes[0].NamespaceURI -cne $xmlDsigNamespace -or
      $manifestNodes[0].GetAttribute("Id") -cne "PackageContents") {
    throw "$Label must contain exactly one XMLDSig Manifest with Id=PackageContents."
  }
  $manifest = $manifestNodes[0]
  $directManifestNodes = @($signature.SelectNodes("./*[local-name()='Object']/*[local-name()='Manifest']"))
  if ($directManifestNodes.Count -ne 1 -or
      ![object]::ReferenceEquals($directManifestNodes[0], $manifest)) {
    throw "$Label PackageContents Manifest must be directly inside a Signature Object."
  }

  $matchingIdAttributes = @()
  foreach ($element in @($document.SelectNodes("//*"))) {
    foreach ($attribute in @($element.Attributes)) {
      if (@("Id", "ID", "id") -ccontains $attribute.LocalName -and
          $attribute.Value -ceq "PackageContents") {
        $matchingIdAttributes += [pscustomobject]@{
          Element = $element
          Attribute = $attribute
        }
      }
    }
  }
  if ($matchingIdAttributes.Count -ne 1 -or
      ![object]::ReferenceEquals($matchingIdAttributes[0].Element, $manifest) -or
      $matchingIdAttributes[0].Attribute.Name -cne "Id") {
    throw "$Label contains an ambiguous PackageContents ID."
  }

  $manifestChildren = @(Get-XmlElementChildren $manifest)
  if ($manifestChildren.Count -eq 0 -or
      @($manifestChildren | Where-Object {
        $_.LocalName -cne "Reference" -or $_.NamespaceURI -cne $xmlDsigNamespace
      }).Count -ne 0) {
    throw "$Label PackageContents Manifest must contain only XMLDSig Reference elements."
  }

  $seenUris = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  $contentReferences = @()
  foreach ($reference in $manifestChildren) {
    if (!$reference.HasAttribute("URI")) {
      throw "$Label contains a Manifest Reference without URI."
    }
    $rawUri = $reference.GetAttribute("URI")
    if ([string]::IsNullOrWhiteSpace($rawUri) -or
        $rawUri.Contains("#") -or
        $rawUri.Contains("?") -or
        $rawUri -match "%(?![0-9A-Fa-f]{2})") {
      throw "$Label contains an unsafe Manifest Reference URI: $rawUri"
    }
    try {
      $decodedUri = [System.Uri]::UnescapeDataString($rawUri)
    } catch {
      throw "$Label contains an invalid escaped Manifest Reference URI: $rawUri"
    }
    if ($decodedUri -match "[\x00-\x1F\x7F]") {
      throw "$Label contains a control character in a Manifest Reference URI."
    }
    $normalizedUri = Get-SafeZipEntryRelativePath $decodedUri
    if (!$seenUris.Add($normalizedUri)) {
      throw "$Label contains a duplicate normalized Manifest Reference URI: $rawUri"
    }

    $referenceChildren = @(Get-XmlElementChildren $reference)
    $referenceNames = @($referenceChildren | ForEach-Object { $_.LocalName })
    if ($referenceChildren.Count -ne 2 -or
        ($referenceNames -join ",") -cne "DigestMethod,DigestValue" -or
        @($referenceChildren | Where-Object { $_.NamespaceURI -cne $xmlDsigNamespace }).Count -ne 0 -or
        $referenceChildren[0].GetAttribute("Algorithm") -cne $digestAlgorithm -or
        @(Get-XmlElementChildren $referenceChildren[0]).Count -ne 0 -or
        @(Get-XmlElementChildren $referenceChildren[1]).Count -ne 0) {
      throw "$Label Manifest Reference for $rawUri does not use the required SHA-256 profile."
    }

    $encodedDigest = ($referenceChildren[1].InnerText -replace "\s", "")
    try {
      $digestBytes = [Convert]::FromBase64String($encodedDigest)
    } catch {
      throw "$Label Manifest Reference for $rawUri has an invalid DigestValue."
    }
    if ($digestBytes.Length -ne 32) {
      throw "$Label Manifest Reference for $rawUri does not carry a SHA-256 digest."
    }

    $contentReferences += [pscustomobject]@{
      Uri = $rawUri
      NormalizedName = $normalizedUri
      DigestBase64 = [Convert]::ToBase64String($digestBytes)
    }
  }

  $signatureValue = ($signatureValueNodes[0].InnerText -replace "\s", "")
  if (@(Get-XmlElementChildren $signatureValueNodes[0]).Count -ne 0) {
    throw "$Label SignatureValue must contain text only."
  }
  try {
    $signatureBytes = [Convert]::FromBase64String($signatureValue)
  } catch {
    throw "$Label SignatureValue is not valid base64."
  }
  if ($signatureBytes.Length -eq 0) {
    throw "$Label SignatureValue is empty."
  }

  $certificateElement = @($document.SelectNodes("//*[local-name()='X509Certificate']"))[0]
  $certificateBase64 = ($certificateElement.InnerText -replace "\s", "")
  $certificateDer = [Convert]::FromBase64String($certificateBase64)
  $certificate = $null
  try {
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificateDer)
    Add-Type -AssemblyName System.Security | Out-Null
    $signedXml = [System.Security.Cryptography.Xml.SignedXml]::new($document)
    $signedXml.LoadXml($signature)
    if (!$signedXml.CheckSignature($certificate, $true)) {
      throw "$Label has an invalid XML signature for its embedded certificate."
    }
  } catch {
    throw "$Label cryptographic signature verification failed: $($_.Exception.Message)"
  } finally {
    if ($null -ne $certificate) {
      $certificate.Dispose()
    }
  }

  return [pscustomobject]@{
    CertificateFingerprint = $fingerprint
    References = $contentReferences
  }
}

function Assert-CepReferenceCoverage {
  param(
    [Parameter(Mandatory = $true)]$Profile,
    [Parameter(Mandatory = $true)]$Files,
    [string]$Label = "signed CEP content"
  )

  $signatureName = "META-INF/signatures.xml"
  $expectedNames = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  foreach ($name in @($Files.Keys)) {
    if (!$name.Equals($signatureName, [System.StringComparison]::OrdinalIgnoreCase)) {
      [void]$expectedNames.Add($name)
    }
  }

  $referenceNames = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  foreach ($reference in @($Profile.References)) {
    [void]$referenceNames.Add([string]$reference.NormalizedName)
  }

  if (!$referenceNames.SetEquals($expectedNames)) {
    $missing = @($expectedNames | Where-Object { !$referenceNames.Contains($_) } | Sort-Object)
    $unexpected = @($referenceNames | Where-Object { !$expectedNames.Contains($_) } | Sort-Object)
    throw "$Label is not covered exactly by PackageContents (missing: $($missing -join ', '); unexpected: $($unexpected -join ', '))."
  }
}

function Assert-ZxpContentSignature {
  param([Parameter(Mandatory = $true)][string]$Path)

  $archive = Open-ZipArchiveRead $Path
  try {
    $files = [System.Collections.Generic.Dictionary[string,object]]::new(
      [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($entry in $archive.Entries) {
      $isDirectory = [string]::IsNullOrEmpty($entry.Name) -or
        $entry.FullName.EndsWith("/") -or
        $entry.FullName.EndsWith("\")
      if ($isDirectory) {
        continue
      }
      $normalized = Get-SafeZipEntryRelativePath $entry.FullName
      $files.Add($normalized, $entry)
    }

    Assert-NoZipSourceMapEntries -EntryNames @($files.Keys) -Label "CEP ZXP"
    $signatureName = "META-INF/signatures.xml"
    if (!$files.ContainsKey($signatureName)) {
      throw "The .zxp is not signed: $signatureName is missing from $Path"
    }

    $signatureEntry = $files[$signatureName]
    [long]$actualExpandedBytes = 0
    $signatureStream = $signatureEntry.Open()
    try {
      $signatureXml = Read-TextFromLimitedStream `
        -InputStream $signatureStream `
        -EntryName $signatureEntry.FullName `
        -ExpectedLength ([long]$signatureEntry.Length) `
        -Limit ([long]$script:ArizonaMaxCepMetadataBytes) `
        -TotalBytes ([ref]$actualExpandedBytes)
    } finally {
      $signatureStream.Dispose()
    }

    $profile = Get-CepSignatureProfileFromXml `
      -Xml $signatureXml `
      -Label "$signatureName in $Path"
    Assert-CepReferenceCoverage -Profile $profile -Files $files -Label "CEP ZXP $Path"

    foreach ($reference in @($profile.References)) {
      $entry = $files[[string]$reference.NormalizedName]
      $stream = $entry.Open()
      try {
        $actualDigest = Get-Sha256Base64FromLimitedStream `
          -InputStream $stream `
          -EntryName $entry.FullName `
          -ExpectedLength ([long]$entry.Length) `
          -EntryLimit ([long]$script:ArizonaMaxCepZipEntryBytes) `
          -TotalLimit ([long]$script:ArizonaMaxCepZipExpandedBytes) `
          -TotalBytes ([ref]$actualExpandedBytes)
      } finally {
        $stream.Dispose()
      }
      if ($actualDigest -cne [string]$reference.DigestBase64) {
        throw "CEP ZXP content digest does not match PackageContents: $($reference.Uri)"
      }
    }

    return $profile
  } finally {
    $archive.Dispose()
  }
}

function Get-SafeDirectoryContentFiles {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $root = Get-FullPath $Directory
  $rootItem = Get-PathItem $root
  if ($null -eq $rootItem -or !$rootItem.PSIsContainer) {
    throw "CEP content directory not found: $root"
  }
  if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "CEP content root must not be a reparse point: $root"
  }

  $files = [System.Collections.Generic.Dictionary[string,object]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  $names = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  $pending = [System.Collections.Generic.Queue[string]]::new()
  $pending.Enqueue($root)
  [long]$declaredExpandedBytes = 0
  $entryCount = 0

  while ($pending.Count -gt 0) {
    $current = $pending.Dequeue()
    foreach ($item in @(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)) {
      $entryCount++
      if ($entryCount -gt $script:ArizonaMaxCepZipEntries) {
        throw "CEP content tree has too many entries (max $script:ArizonaMaxCepZipEntries): $root"
      }
      Assert-PathInside -Path $item.FullName -Parent $root -Label "CEP content entry"
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "CEP content tree contains a symbolic link or reparse point: $($item.FullName)"
      }

      $relative = $item.FullName.Substring($root.Length).TrimStart("\", "/")
      $normalized = Get-SafeZipEntryRelativePath $relative
      if (!$names.Add($normalized)) {
        throw "CEP content tree contains a duplicate normalized entry: $relative"
      }

      if ($item.PSIsContainer) {
        $pending.Enqueue($item.FullName)
        continue
      }
      if ([long]$item.Length -gt [long]$script:ArizonaMaxCepZipEntryBytes) {
        throw "CEP content file exceeds the per-entry limit: $($item.FullName)"
      }
      $declaredExpandedBytes += [long]$item.Length
      if ($declaredExpandedBytes -gt [long]$script:ArizonaMaxCepZipExpandedBytes) {
        throw "CEP content tree exceeds the total expanded-size limit: $root"
      }
      $files.Add($normalized, $item)
    }
  }

  return ,$files
}

function Get-CepDirectorySnapshotToken {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $root = Get-FullPath $Directory
  $files = Get-SafeDirectoryContentFiles $root
  $records = @()
  foreach ($name in @($files.Keys | Sort-Object)) {
    $file = $files[$name]
    $sha256 = Get-FileSha256 $file.FullName
    if ([string]::IsNullOrWhiteSpace($sha256)) {
      throw "CEP content file changed while its snapshot was being calculated: $($file.FullName)"
    }
    $records += "{0}`t{1}`t{2}" -f $name, ([long]$file.Length), $sha256
  }

  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($records -join "`n"))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally {
    $sha.Dispose()
  }
}

function Assert-CepDirectoryContentSignature {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $root = Get-FullPath $Directory
  $files = Get-SafeDirectoryContentFiles $root
  Assert-NoZipSourceMapEntries -EntryNames @($files.Keys) -Label "CEP content tree"

  $signatureName = "META-INF/signatures.xml"
  if (!$files.ContainsKey($signatureName)) {
    throw "CEP content tree is not signed: $signatureName is missing from $root"
  }

  $signatureFile = $files[$signatureName]
  [long]$actualExpandedBytes = 0
  $signatureStream = [System.IO.File]::Open(
    $signatureFile.FullName,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  try {
    $signatureXml = Read-TextFromLimitedStream `
      -InputStream $signatureStream `
      -EntryName $signatureName `
      -ExpectedLength ([long]$signatureFile.Length) `
      -Limit ([long]$script:ArizonaMaxCepMetadataBytes) `
      -TotalBytes ([ref]$actualExpandedBytes)
  } finally {
    $signatureStream.Dispose()
  }

  $profile = Get-CepSignatureProfileFromXml `
    -Xml $signatureXml `
    -Label "$signatureName in $root"
  Assert-CepReferenceCoverage -Profile $profile -Files $files -Label "CEP content tree $root"

  foreach ($reference in @($profile.References)) {
    $file = $files[[string]$reference.NormalizedName]
    $stream = [System.IO.File]::Open(
      $file.FullName,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::Read
    )
    try {
      $actualDigest = Get-Sha256Base64FromLimitedStream `
        -InputStream $stream `
        -EntryName $file.FullName `
        -ExpectedLength ([long]$file.Length) `
        -EntryLimit ([long]$script:ArizonaMaxCepZipEntryBytes) `
        -TotalLimit ([long]$script:ArizonaMaxCepZipExpandedBytes) `
        -TotalBytes ([ref]$actualExpandedBytes)
    } finally {
      $stream.Dispose()
    }
    if ($actualDigest -cne [string]$reference.DigestBase64) {
      throw "CEP content tree digest does not match PackageContents: $($reference.Uri)"
    }
  }

  return $profile
}

function Assert-CepInstalledReleaseIntegrity {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string]$ExpectedBundleId,
    [Parameter(Mandatory = $true)][string[]]$TrustedCertificateFingerprints
  )

  $root = Get-FullPath $Directory
  $files = Get-SafeDirectoryContentFiles $root
  foreach ($requiredEntry in @('META-INF/signatures.xml', 'mimetype', 'CSXS/manifest.xml', '.debug')) {
    if (!$files.ContainsKey($requiredEntry)) {
      throw "Installed CEP release is incomplete: $requiredEntry is missing from $root"
    }
  }

  $manifestInfo = Get-CepDirectoryManifestInfo -Directory $root -Files $files
  if ($manifestInfo.BundleId -cne $ExpectedBundleId) {
    throw "Installed CEP release has an unexpected ExtensionBundleId: $($manifestInfo.BundleId)"
  }
  ConvertTo-ArizonaSemVer ([string]$manifestInfo.BundleVersion) | Out-Null

  $profile = Assert-CepDirectoryContentSignature -Directory $root
  if ($TrustedCertificateFingerprints -cnotcontains [string]$profile.CertificateFingerprint) {
    throw "Installed CEP release is not signed by a pinned Arizona certificate ($($profile.CertificateFingerprint))."
  }

  return [pscustomobject]@{
    BundleId = [string]$manifestInfo.BundleId
    BundleVersion = [string]$manifestInfo.BundleVersion
    CertificateFingerprint = [string]$profile.CertificateFingerprint
  }
}

# Public pinned manifest, versioned in Git. It carries certificate material
# only: it says which publisher identity a release may carry, never a secret.
function Get-TrustedCepCertificateFingerprints {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Pinned CEP certificate manifest not found: $Path"
  }

  $document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ([int](Get-JsonProperty $document "schemaVersion") -ne 1) {
    throw "Unsupported pinned CEP certificate manifest schema in $Path"
  }

  $fingerprints = @()
  foreach ($certificate in @(Get-JsonProperty $document "certificates")) {
    $fingerprint = [string](Get-JsonProperty $certificate "sha256")
    if ($fingerprint -cnotmatch "^[0-9a-f]{64}$") {
      throw "Pinned CEP certificate manifest has a fingerprint that is not lowercase hex SHA-256: $Path"
    }
    $fingerprints += $fingerprint
  }

  return $fingerprints
}

function Write-JsonFileAtomic {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value
  )

  $fullPath = Get-FullPath $Path
  $parent = Split-Path -Parent $fullPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null

  $temporaryPath = "$fullPath.tmp"
  try {
    $Value |
      ConvertTo-Json -Depth 8 |
      Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $fullPath -Force
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

function Get-PathItem {
  param([Parameter(Mandatory = $true)][string]$Path)

  return Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}

function Assert-NoIntermediateReparsePoint {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$TrustedRoot,
    [switch]$IncludePath
  )

  $fullPath = Get-FullPath $Path
  $rootFull = Get-FullPath $TrustedRoot
  Assert-PathInside -Path $fullPath -Parent $rootFull -Label "validated path"
  $current = if ($IncludePath) { $fullPath } else { Split-Path -Parent $fullPath }

  while (![string]::IsNullOrWhiteSpace($current) -and
         $current.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -and
         $current.Length -ge $rootFull.Length) {
    $item = Get-PathItem $current
    if ($null -ne $item -and
        ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Intermediate reparse point is not allowed: $current"
    }
    if ($current.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      break
    }
    $current = Split-Path -Parent $current
  }
}

function Assert-ArizonaCepPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$ExpectedExtensionsRoot = ""
  )

  $fullPath = Get-FullPath $Path
  if ((Split-Path -Leaf $fullPath) -ne "com.arizona-carrefour.cep") {
    throw "CEP path does not have the Arizona extension id: $fullPath"
  }

  $extensionsRoot = Split-Path -Parent $fullPath
  $cepRoot = Split-Path -Parent $extensionsRoot
  $adobeRoot = Split-Path -Parent $cepRoot
  if ((Split-Path -Leaf $extensionsRoot) -ne "extensions" -or
      (Split-Path -Leaf $cepRoot) -ne "CEP" -or
      (Split-Path -Leaf $adobeRoot) -ne "Adobe") {
    throw "CEP path is outside an Adobe CEP extensions directory: $fullPath"
  }

  if ([string]::IsNullOrWhiteSpace($ExpectedExtensionsRoot)) {
    $ExpectedExtensionsRoot = Join-Path (Get-SystemCommonProgramFiles) "Adobe\CEP\extensions"
  }
  $expectedRootFull = Get-FullPath $ExpectedExtensionsRoot
  if (!$extensionsRoot.Equals($expectedRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "CEP path is outside the trusted extensions root: $fullPath"
  }
  Assert-NoIntermediateReparsePoint -Path $fullPath -TrustedRoot $expectedRootFull
  return $expectedRootFull
}

function Assert-ArizonaAexPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string[]]$AdobeRoots = @()
  )

  $fullPath = Get-FullPath $Path
  if ((Split-Path -Leaf $fullPath) -ne "ArizonaBridgeTest.aex") {
    throw "AEX path does not have the Arizona plugin filename: $fullPath"
  }

  $arizonaPluginRoot = Split-Path -Parent $fullPath
  $pluginsRoot = Split-Path -Parent $arizonaPluginRoot
  if ((Split-Path -Leaf $arizonaPluginRoot) -ne "Arizona" -or
      (Split-Path -Leaf $pluginsRoot) -ne "Plug-ins") {
    throw "AEX path is outside an Arizona After Effects plugin directory: $fullPath"
  }

  if ($AdobeRoots.Count -eq 0) {
    foreach ($programFilesFolder in @("ProgramFiles", "ProgramFilesX86")) {
      $programFiles = [Environment]::GetFolderPath($programFilesFolder)
      if (![string]::IsNullOrWhiteSpace($programFiles)) {
        $candidate = Join-Path $programFiles "Adobe"
        if ($AdobeRoots -notcontains $candidate) {
          $AdobeRoots += $candidate
        }
      }
    }
  }

  $trustedRoot = $null
  foreach ($candidateRoot in $AdobeRoots) {
    if ([string]::IsNullOrWhiteSpace($candidateRoot)) {
      continue
    }
    try {
      Assert-PathInside -Path $fullPath -Parent $candidateRoot -Label "legacy Arizona AEX plugin"
      $trustedRoot = Get-FullPath $candidateRoot
      break
    } catch {
      continue
    }
  }
  if ([string]::IsNullOrWhiteSpace($trustedRoot)) {
    throw "AEX path is outside the trusted Adobe roots: $fullPath"
  }

  $relative = $fullPath.Substring($trustedRoot.Length).TrimStart("\")
  if ($relative -notmatch "^Adobe After Effects [^\\]+\\Support Files\\Plug-ins\\Arizona\\ArizonaBridgeTest\.aex$") {
    throw "AEX path does not match a standard After Effects installation: $fullPath"
  }
  Assert-NoIntermediateReparsePoint -Path $arizonaPluginRoot -TrustedRoot $trustedRoot -IncludePath
  return $arizonaPluginRoot
}

function Remove-DirectoryIfEmptySafe {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedParent,
    [string]$Label = "directory"
  )

  $item = Get-PathItem $Path
  if ($null -eq $item) {
    return $false
  }

  Assert-PathInside -Path $item.FullName -Parent $AllowedParent -Label $Label
  if (!$item.PSIsContainer) {
    throw "$Label is not a directory: $($item.FullName)"
  }

  $children = @(Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction Stop)
  if ($children.Count -ne 0) {
    return $false
  }

  [System.IO.Directory]::Delete($item.FullName, $false)
  if ($null -ne (Get-PathItem $item.FullName)) {
    throw "$Label still exists after removal: $($item.FullName)"
  }

  return $true
}

function Invoke-CepDirectorySwap {
  param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$Staging,
    [Parameter(Mandatory = $true)][string]$Backup,
    [Parameter(Mandatory = $true)][string]$ExtensionsRoot,
    [Parameter(Mandatory = $true)][string]$WorkRoot,
    [scriptblock]$AfterBackupMoved
  )

  Assert-PathInside -Path $Destination -Parent $ExtensionsRoot -Label "CEP destination"
  Assert-PathInside -Path $Staging -Parent $WorkRoot -Label "CEP staging directory"
  Assert-PathInside -Path $Backup -Parent $WorkRoot -Label "CEP recovery backup"
  if ($null -ne (Get-PathItem $Backup)) {
    throw "CEP recovery backup unexpectedly exists before commit: $Backup"
  }

  $backupCreated = $false
  try {
    if ($null -ne (Get-PathItem $Destination)) {
      [System.IO.Directory]::Move($Destination, $Backup)
      $backupCreated = $true
      if ($null -ne $AfterBackupMoved) {
        & $AfterBackupMoved
      }
    }
    [System.IO.Directory]::Move($Staging, $Destination)
  } catch {
    if ($backupCreated -and
        $null -eq (Get-PathItem $Destination) -and
        $null -ne (Get-PathItem $Backup)) {
      [System.IO.Directory]::Move($Backup, $Destination)
    }
    throw
  }

  return $backupCreated
}

function Remove-PathSafe {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedParent,
    [string]$Label = "path"
  )

  $item = Get-PathItem $Path
  if ($null -eq $item) {
    return
  }

  Assert-PathInside -Path $item.FullName -Parent $AllowedParent -Label $Label

  $isReparsePoint = ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
  if ($isReparsePoint -and $item.PSIsContainer) {
    # Never recurse through a CEP development junction: unlink only the junction itself.
    [System.IO.Directory]::Delete($item.FullName, $false)
  } else {
    Remove-Item -LiteralPath $item.FullName -Recurse -Force
  }

  if ($null -ne (Get-PathItem $item.FullName)) {
    throw "$Label still exists after removal: $($item.FullName)"
  }
}
