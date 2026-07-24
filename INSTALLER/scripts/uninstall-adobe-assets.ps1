param(
  [string]$InstallDir = "",
  [string]$CepExtensionsRoot = "",
  [string]$LogRoot = "",
  [string]$StatePath = "",
  [string[]]$AdobeRoots = @(),
  [switch]$PreflightOnly,
  [switch]$RemoveUserData
)

. "$PSScriptRoot\common.ps1"

$logRoot = Get-InstallerLogRoot $LogRoot

trap {
  Write-InstallerLog "ERROR removing Adobe assets: $($_.Exception.Message)" $logRoot
  Write-Error $_
  exit 1
}

if ([string]::IsNullOrWhiteSpace($StatePath) -and ![string]::IsNullOrWhiteSpace($InstallDir)) {
  $StatePath = Join-Path $InstallDir "installer\installed-assets.json"
}

$state = $null
if (![string]::IsNullOrWhiteSpace($StatePath) -and (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
  try {
    $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    if ([int]$state.schemaVersion -notin @(1, 2)) {
      throw "Unsupported installed asset state schema: $($state.schemaVersion)"
    }
    Write-InstallerLog "Loaded installed Adobe asset paths from $StatePath" $logRoot
  } catch {
    Write-InstallerLog "Installed asset state could not be read; using safe legacy discovery. $($_.Exception.Message)" $logRoot
    $state = $null
  }
}

$legacyAexTargets = @()
if ($null -ne $state -and [int]$state.schemaVersion -eq 1 -and $null -ne $state.aex) {
  foreach ($entry in @($state.aex)) {
    if (![string]::IsNullOrWhiteSpace([string]$entry.path)) {
      $legacyAexTargets += [string]$entry.path
    }
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
  Write-InstallerLog "After Effects is running and a legacy Arizona AEX cannot be removed yet." $logRoot
  exit 20
}

if ($PreflightOnly) {
  exit 0
}

if ([string]::IsNullOrWhiteSpace($CepExtensionsRoot)) {
  if (![string]::IsNullOrWhiteSpace($env:APPDATA)) {
    $CepExtensionsRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
  }
}

Write-InstallerLog "Removing Arizona CEP extension and any legacy AEX plugin." $logRoot

$cepTargets = @()
if ($null -ne $state -and $null -ne $state.cep -and ![string]::IsNullOrWhiteSpace([string]$state.cep.path)) {
  $cepTargets += [string]$state.cep.path
} elseif (![string]::IsNullOrWhiteSpace($CepExtensionsRoot)) {
  $cepTargets += (Join-Path $CepExtensionsRoot "com.arizona-carrefour.cep")
}

foreach ($cepDestination in @($cepTargets | Sort-Object -Unique)) {
  $validatedCepRoot = Assert-ArizonaCepPath -Path $cepDestination -ExpectedExtensionsRoot $CepExtensionsRoot
  $cepWasPresent = $null -ne (Get-PathItem $cepDestination)
  Remove-PathSafe -Path $cepDestination -AllowedParent $validatedCepRoot -Label "Arizona CEP extension"
  if ($cepWasPresent) {
    Write-InstallerLog "Removed CEP extension from $cepDestination" $logRoot
  } else {
    Write-InstallerLog "CEP extension was already absent from $cepDestination" $logRoot
  }
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

if (![string]::IsNullOrWhiteSpace($StatePath)) {
  if ((Split-Path -Leaf $StatePath) -ne "installed-assets.json") {
    throw "Unexpected installed asset state filename: $StatePath"
  }

  $stateParent = Split-Path -Parent (Get-FullPath $StatePath)
  Remove-PathSafe -Path $StatePath -AllowedParent $stateParent -Label "installed asset state"
}

if ($RemoveUserData) {
  Write-InstallerLog "Removing Arizona user data for current Windows user." $logRoot

  if (![string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    Remove-PathSafe -Path (Join-Path $env:LOCALAPPDATA "com.pc.arizona-app") -AllowedParent $env:LOCALAPPDATA -Label "local app data"
    Remove-PathSafe -Path (Join-Path $env:LOCALAPPDATA "Arizona Installer") -AllowedParent $env:LOCALAPPDATA -Label "installer data"
  }

  if (![string]::IsNullOrWhiteSpace($env:APPDATA)) {
    Remove-PathSafe -Path (Join-Path $env:APPDATA "com.pc.arizona-app") -AllowedParent $env:APPDATA -Label "roaming app data"
  }
} else {
  Write-InstallerLog "User data was preserved." $logRoot
}

exit 0
