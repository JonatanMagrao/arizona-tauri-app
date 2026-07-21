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
  New-Item -ItemType Directory -Force -Path $resolvedLogRoot | Out-Null
  $logFile = Join-Path $resolvedLogRoot "installer.log"
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Host $Message
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
  return (Join-Path $targetRoot $name)
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

function Remove-PathSafe {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedParent,
    [string]$Label = "path"
  )

  if (!(Test-Path -LiteralPath $Path)) {
    return
  }

  Assert-PathInside -Path $Path -Parent $AllowedParent -Label $Label
  Remove-Item -LiteralPath $Path -Recurse -Force
}
