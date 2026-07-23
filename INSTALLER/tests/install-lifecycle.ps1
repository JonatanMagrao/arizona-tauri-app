$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptsRoot = Join-Path $repoRoot "INSTALLER\scripts"
. (Join-Path $scriptsRoot "common.ps1")

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (!$Condition) {
    throw "Assertion failed: $Message"
  }
}

function Invoke-InstallerScript {
  param(
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $powershell = Join-Path $PSHOME "powershell.exe"
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $powershell -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  foreach ($line in $output) {
    Write-Host $line
  }
  return [int]$exitCode
}

$testParent = Join-Path ([System.IO.Path]::GetTempPath()) "ArizonaInstallerTests"
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  $payloadRoot = Join-Path $testRoot "payload"
  $cepPayload = Join-Path $payloadRoot "cep\com.arizona-carrefour.cep"
  New-Item -ItemType Directory -Force -Path $cepPayload | Out-Null
  Set-Content -LiteralPath (Join-Path $cepPayload "manifest.xml") -Value "cep-test" -Encoding UTF8

  $manifest = [pscustomobject]@{
    schemaVersion = 2
    appPackageVersion = "test"
    tauriVersion = "test"
    cepExtensionId = "com.arizona-carrefour.cep"
    cepFingerprint = Get-DirectoryFingerprint $cepPayload
    includesAfterEffectsPlugin = $false
    includesAdminApp = $false
  }
  Write-JsonFileAtomic -Path (Join-Path $payloadRoot "release-manifest.json") -Value $manifest

  $adobeRoot = Join-Path $testRoot "Program Files\Adobe"
  $supportFiles = Join-Path $adobeRoot "Adobe After Effects 2025\Support Files"
  $secondSupportFiles = Join-Path $adobeRoot "Adobe After Effects 2026\Support Files"
  $pluginDir = Join-Path $supportFiles "Plug-ins\Arizona"
  $pluginPath = Join-Path $pluginDir "ArizonaBridgeTest.aex"
  $secondPluginDir = Join-Path $secondSupportFiles "Plug-ins\Arizona"
  $secondPluginPath = Join-Path $secondPluginDir "ArizonaBridgeTest.aex"
  $unrelatedPluginFile = Join-Path $secondPluginDir "keep-me.txt"
  New-Item -ItemType Directory -Force -Path $supportFiles, $secondSupportFiles, $pluginDir, $secondPluginDir | Out-Null
  Set-Content -LiteralPath (Join-Path $supportFiles "AfterFX.exe") -Value "fake" -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $secondSupportFiles "AfterFX.exe") -Value "fake" -Encoding ASCII
  Set-Content -LiteralPath $pluginPath -Value "legacy-aex" -Encoding UTF8
  Set-Content -LiteralPath $secondPluginPath -Value "legacy-aex" -Encoding UTF8
  Set-Content -LiteralPath $unrelatedPluginFile -Value "keep" -Encoding UTF8

  $cepExtensionsRoot = Join-Path $testRoot "profile\AppData\Roaming\Adobe\CEP\extensions"
  $cepDestination = Join-Path $cepExtensionsRoot "com.arizona-carrefour.cep"
  $installDir = Join-Path $testRoot "Program Files\arizona-app"
  $statePath = Join-Path $installDir "installer\installed-assets.json"
  $logRoot = Join-Path $testRoot "logs"

  $installExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $payloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($installExit -eq 0) "install script should succeed"
  Assert-True (Test-Path -LiteralPath $cepDestination -PathType Container) "CEP extension should be installed"
  Assert-True ((Get-DirectoryFingerprint $cepDestination) -eq $manifest.cepFingerprint) "installed CEP fingerprint should match"
  Assert-True ($null -eq (Get-PathItem $pluginPath)) "upgrade should remove the first legacy AEX"
  Assert-True ($null -eq (Get-PathItem $pluginDir)) "empty legacy Arizona plugin directory should be removed"
  Assert-True ($null -eq (Get-PathItem $secondPluginPath)) "upgrade should remove the second legacy AEX"
  Assert-True (Test-Path -LiteralPath $unrelatedPluginFile -PathType Leaf) "unrelated plugin directory content must be preserved"
  Assert-True (Test-Path -LiteralPath $statePath -PathType Leaf) "installed asset state should be recorded"

  $installedState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  Assert-True ([int]$installedState.schemaVersion -eq 2) "installed state should use plugin-free schema 2"
  Assert-True ($null -eq $installedState.PSObject.Properties["aex"]) "installed state must not record an AEX"
  Assert-True (![bool]$installedState.releaseManifest.includesAfterEffectsPlugin) "installed state must declare that no plugin is installed"

  $uninstallExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "uninstall-adobe-assets.ps1") `
    -Arguments @(
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($uninstallExit -eq 0) "uninstall script should succeed"
  Assert-True ($null -eq (Get-PathItem $cepDestination)) "CEP extension should be removed"
  Assert-True ($null -eq (Get-PathItem $statePath)) "installed asset state should be removed"
  Assert-True (Test-Path -LiteralPath $unrelatedPluginFile -PathType Leaf) "uninstall must preserve unrelated After Effects files"

  # Legacy fallback: clean exact Arizona assets even when no install state exists.
  New-Item -ItemType Directory -Force -Path $cepDestination, $pluginDir | Out-Null
  Set-Content -LiteralPath (Join-Path $cepDestination "legacy.txt") -Value "legacy" -Encoding UTF8
  Set-Content -LiteralPath $pluginPath -Value "legacy" -Encoding UTF8
  $legacyExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "uninstall-adobe-assets.ps1") `
    -Arguments @(
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($legacyExit -eq 0) "legacy cleanup should succeed without install state"
  Assert-True ($null -eq (Get-PathItem $cepDestination)) "legacy CEP extension should be removed"
  Assert-True ($null -eq (Get-PathItem $pluginDir)) "legacy Arizona AEX directory should be removed"

  # Junction safety: unlink the CEP junction without touching its target contents.
  $junctionTarget = Join-Path $testRoot "cep-dev-target"
  New-Item -ItemType Directory -Force -Path $junctionTarget, $cepExtensionsRoot | Out-Null
  $sentinel = Join-Path $junctionTarget "keep.txt"
  Set-Content -LiteralPath $sentinel -Value "keep" -Encoding UTF8
  New-Item -ItemType Junction -Path $cepDestination -Target $junctionTarget | Out-Null
  Remove-PathSafe -Path $cepDestination -AllowedParent $cepExtensionsRoot -Label "test CEP junction"
  Assert-True ($null -eq (Get-PathItem $cepDestination)) "CEP junction should be unlinked"
  Assert-True (Test-Path -LiteralPath $sentinel -PathType Leaf) "CEP junction target contents must be preserved"

  Write-Host "Installer lifecycle tests passed."
} finally {
  $testRootFull = Get-FullPath $testRoot
  $testParentFull = Get-FullPath $testParent
  Assert-PathInside -Path $testRootFull -Parent $testParentFull -Label "installer test root"
  Remove-PathSafe -Path $testRootFull -AllowedParent $testParentFull -Label "installer test root"
  Remove-DirectoryIfEmptySafe -Path $testParentFull -AllowedParent ([System.IO.Path]::GetTempPath()) -Label "installer test parent" | Out-Null
}
