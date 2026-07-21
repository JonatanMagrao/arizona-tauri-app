param(
  [Parameter(Mandatory = $true)][string]$PayloadRoot,
  [string]$InstallDir = "",
  [string]$CepExtensionsRoot = "",
  [string]$LogRoot = "",
  [switch]$SkipAex
)

. "$PSScriptRoot\common.ps1"

$logRoot = Get-InstallerLogRoot $LogRoot
$payloadRootFull = Get-FullPath $PayloadRoot

if (!(Test-Path -LiteralPath $payloadRootFull -PathType Container)) {
  throw "Installer payload not found: $payloadRootFull"
}

if ([string]::IsNullOrWhiteSpace($CepExtensionsRoot)) {
  if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw "APPDATA is not available; CEP installation root cannot be resolved."
  }
  $CepExtensionsRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
}

Write-InstallerLog "Installing Adobe assets from $payloadRootFull" $logRoot

$cepSource = Join-Path $payloadRootFull "cep\com.arizona-carrefour.cep"
$cepDestination = Join-Path $CepExtensionsRoot "com.arizona-carrefour.cep"

if (Test-Path -LiteralPath $cepSource -PathType Container) {
  New-Item -ItemType Directory -Force -Path $CepExtensionsRoot | Out-Null

  $sourceFingerprint = Get-DirectoryFingerprint $cepSource
  $destinationFingerprint = Get-DirectoryFingerprint $cepDestination
  if ($sourceFingerprint -and $sourceFingerprint -eq $destinationFingerprint) {
    Write-InstallerLog "CEP extension already installed with matching fingerprint." $logRoot
  } else {
    if (Test-Path -LiteralPath $cepDestination) {
      $backup = Move-ToBackup -Path $cepDestination
      Write-InstallerLog "Backed up existing CEP extension to $backup" $logRoot
    }
    Copy-DirectoryContents -Source $cepSource -Destination $cepDestination
    Write-InstallerLog "Installed CEP extension to $cepDestination" $logRoot
  }
} else {
  Write-InstallerLog "CEP payload not found; skipping CEP installation." $logRoot
}

$aexSource = Join-Path $payloadRootFull "aex\ArizonaBridgeTest.aex"
if ($SkipAex) {
  Write-InstallerLog "AEX installation skipped by flag." $logRoot
  exit 0
}

if (!(Test-Path -LiteralPath $aexSource -PathType Leaf)) {
  Write-InstallerLog "AEX payload not found; skipping AEX installation." $logRoot
  exit 0
}

$afterProcess = Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue
if ($afterProcess) {
  throw "Close After Effects before installing the Arizona AEX plugin."
}

$aexSourceHash = Get-FileSha256 $aexSource
$afterInstallations = @(& "$PSScriptRoot\detect-after-effects.ps1" -Json | ConvertFrom-Json)
if (!$afterInstallations -or $afterInstallations.Count -eq 0) {
  Write-InstallerLog "No After Effects installation found; AEX plugin not installed." $logRoot
  exit 0
}

foreach ($installation in $afterInstallations) {
  $pluginDir = [string]$installation.pluginDir
  $pluginPath = [string]$installation.pluginPath

  New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
  $existingHash = Get-FileSha256 $pluginPath
  if ($existingHash -and $existingHash -eq $aexSourceHash) {
    Write-InstallerLog "AEX already installed for $($installation.name)." $logRoot
    continue
  }

  if (Test-Path -LiteralPath $pluginPath) {
    $backup = Move-ToBackup -Path $pluginPath
    Write-InstallerLog "Backed up existing AEX for $($installation.name) to $backup" $logRoot
  }

  $tempPath = "$pluginPath.tmp"
  Copy-Item -LiteralPath $aexSource -Destination $tempPath -Force
  Move-Item -LiteralPath $tempPath -Destination $pluginPath -Force

  $installedHash = Get-FileSha256 $pluginPath
  if ($installedHash -ne $aexSourceHash) {
    throw "AEX hash mismatch after installing to $pluginPath"
  }

  Write-InstallerLog "Installed AEX for $($installation.name) to $pluginPath" $logRoot
}
