param(
  [string]$InstallDir = "",
  [string]$CepExtensionsRoot = "",
  [string]$LogRoot = "",
  [switch]$RemoveUserData
)

. "$PSScriptRoot\common.ps1"

$logRoot = Get-InstallerLogRoot $LogRoot

if ([string]::IsNullOrWhiteSpace($CepExtensionsRoot)) {
  if (![string]::IsNullOrWhiteSpace($env:APPDATA)) {
    $CepExtensionsRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
  }
}

Write-InstallerLog "Removing Adobe assets installed by Arizona." $logRoot

if (![string]::IsNullOrWhiteSpace($CepExtensionsRoot)) {
  $cepDestination = Join-Path $CepExtensionsRoot "com.arizona-carrefour.cep"
  Remove-PathSafe -Path $cepDestination -AllowedParent $CepExtensionsRoot -Label "CEP extension"
  Write-InstallerLog "Removed CEP extension from $cepDestination" $logRoot
}

$afterProcess = Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue
if ($afterProcess) {
  throw "Close After Effects before removing the Arizona AEX plugin."
}

$afterInstallations = @(& "$PSScriptRoot\detect-after-effects.ps1" -Json | ConvertFrom-Json)
foreach ($installation in $afterInstallations) {
  $pluginDir = [string]$installation.pluginDir
  $pluginPath = [string]$installation.pluginPath
  Remove-PathSafe -Path $pluginPath -AllowedParent $pluginDir -Label "AEX plugin"
  Write-InstallerLog "Removed AEX plugin from $pluginPath" $logRoot
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
