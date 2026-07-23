param(
  [Parameter(Mandatory = $true)][string]$PayloadRoot,
  [string]$InstallDir = "",
  [string]$CepExtensionsRoot = "",
  [string]$LogRoot = "",
  [string]$StatePath = "",
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
if ([int]$manifest.schemaVersion -ne 2 -or
    [string]$manifest.cepExtensionId -ne "com.arizona-carrefour.cep" -or
    $null -eq $manifest.PSObject.Properties["includesAfterEffectsPlugin"] -or
    [bool]$manifest.includesAfterEffectsPlugin) {
  throw "Installer release manifest must describe the plugin-free CEP payload."
}

if (![string]::IsNullOrWhiteSpace($InstallDir)) {
  Assert-PathInside -Path $statePathFull -Parent $InstallDir -Label "installed asset state"
}

$cepSource = Join-Path $payloadRootFull "cep\com.arizona-carrefour.cep"
if (!(Test-Path -LiteralPath $cepSource -PathType Container)) {
  throw "CEP payload not found: $cepSource"
}
$cepSourceFingerprint = Get-DirectoryFingerprint $cepSource
if ([string]::IsNullOrWhiteSpace($cepSourceFingerprint) -or
    $cepSourceFingerprint -ne [string]$manifest.cepFingerprint) {
  throw "CEP payload fingerprint does not match release-manifest.json."
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
$presentLegacyAexTargets = @($legacyAexTargets | Where-Object { $null -ne (Get-PathItem $_) })

if ($presentLegacyAexTargets.Count -gt 0 -and (Test-AfterEffectsRunning)) {
  Write-InstallerLog "After Effects is running and a legacy Arizona AEX must be removed before upgrade." $logRoot
  exit 20
}

foreach ($pluginPath in $legacyAexTargets) {
  $pluginDir = Assert-ArizonaAexPath $pluginPath
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
  if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw "APPDATA is not available; CEP installation root cannot be resolved."
  }
  $CepExtensionsRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
}

Write-InstallerLog "Installing Arizona CEP extension from $payloadRootFull" $logRoot

$cepDestination = Join-Path $CepExtensionsRoot "com.arizona-carrefour.cep"
$cepExtensionsRootFull = Assert-ArizonaCepPath $cepDestination
$cepBackup = ""

try {
  New-Item -ItemType Directory -Force -Path $CepExtensionsRoot | Out-Null

  $destinationFingerprint = Get-DirectoryFingerprint $cepDestination
  if ($cepSourceFingerprint -eq $destinationFingerprint) {
    Write-InstallerLog "CEP extension already installed with matching fingerprint." $logRoot
  } else {
    if ($null -ne (Get-PathItem $cepDestination)) {
      $cepBackup = Move-ToBackup -Path $cepDestination
      Write-InstallerLog "Backed up existing CEP extension to $cepBackup" $logRoot
    }
    Copy-DirectoryContents -Source $cepSource -Destination $cepDestination
    if ((Get-DirectoryFingerprint $cepDestination) -ne $cepSourceFingerprint) {
      throw "CEP fingerprint mismatch after installation: $cepDestination"
    }
    Write-InstallerLog "Installed CEP extension to $cepDestination" $logRoot
  }
} catch {
  if ($null -ne (Get-PathItem $cepDestination)) {
    Remove-PathSafe -Path $cepDestination -AllowedParent $cepExtensionsRootFull -Label "partial CEP extension"
  }
  if (![string]::IsNullOrWhiteSpace($cepBackup) -and $null -ne (Get-PathItem $cepBackup)) {
    Move-Item -LiteralPath $cepBackup -Destination $cepDestination -Force
  }
  throw
}

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
    fingerprint = $cepSourceFingerprint
  }
}

Write-JsonFileAtomic -Path $statePathFull -Value $state
Write-InstallerLog "Recorded installed CEP asset at $statePathFull" $logRoot
exit 0
