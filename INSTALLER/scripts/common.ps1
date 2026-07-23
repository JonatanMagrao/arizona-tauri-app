$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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
  return $null -ne (Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path)
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

function Get-DirectoryFingerprint {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (!(Test-Path -LiteralPath $Path -PathType Container)) {
    return ""
  }

  $root = Get-FullPath $Path
  $rows = Get-ChildItem -LiteralPath $root -Recurse -Force -File |
    Sort-Object FullName |
    ForEach-Object {
      $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/')
      $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToUpperInvariant()
      "{0}|{1}|{2}" -f $relative.ToLowerInvariant(), $_.Length, $hash
    }

  $text = ($rows -join "`n")
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $sha.ComputeHash($bytes)
    return (($hashBytes | ForEach-Object { $_.ToString("x2") }) -join "").ToUpperInvariant()
  } finally {
    $sha.Dispose()
  }
}

function New-BackupPath {
  param(
    [Parameter(Mandatory = $true)][string]$OriginalPath,
    [string]$BackupRoot = ""
  )

  if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $base = if (![string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
      $env:LOCALAPPDATA
    } else {
      $env:TEMP
    }
    $BackupRoot = Join-Path $base "Arizona Installer\backups"
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $name = Split-Path -Leaf $OriginalPath
  $targetRoot = Join-Path $BackupRoot $stamp
  New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
  $backupPath = Join-Path $targetRoot $name
  if ($null -ne (Get-PathItem $backupPath)) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($name)
    $extension = [System.IO.Path]::GetExtension($name)
    $uniqueName = "{0}-{1}{2}" -f $baseName, [guid]::NewGuid().ToString("N"), $extension
    $backupPath = Join-Path $targetRoot $uniqueName
  }

  return $backupPath
}

function Move-ToBackup {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$BackupRoot = ""
  )

  if (!(Test-Path -LiteralPath $Path)) {
    return ""
  }

  $backupPath = New-BackupPath -OriginalPath $Path -BackupRoot $BackupRoot
  Move-Item -LiteralPath $Path -Destination $backupPath -Force
  return $backupPath
}

function Copy-DirectoryContents {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (!(Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Source directory not found: $Source"
  }

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
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

function Assert-ArizonaCepPath {
  param([Parameter(Mandatory = $true)][string]$Path)

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

  return $extensionsRoot
}

function Assert-ArizonaAexPath {
  param([Parameter(Mandatory = $true)][string]$Path)

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
