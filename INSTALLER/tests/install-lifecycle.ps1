$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$scriptsRoot = Join-Path $repoRoot "INSTALLER\scripts"
. (Join-Path $scriptsRoot "common.ps1")
. (Join-Path $PSScriptRoot "zxp-fixture.ps1")

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

function Invoke-TestCepInstall {
  param(
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$PayloadRoot,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$CepExtensionsRoot,
    [Parameter(Mandatory = $true)][string]$LogRoot,
    [Parameter(Mandatory = $true)][string]$TrustedCertPath,
    [Parameter(Mandatory = $true)][string]$AfterEffectsProcessName,
    [Parameter(Mandatory = $true)][string]$AdobeRoot,
    [switch]$AllowCepVersionDowngrade
  )

  $arguments = @(
    "-PayloadRoot", $PayloadRoot,
    "-InstallDir", $InstallDir,
    "-CepExtensionsRoot", $CepExtensionsRoot,
    "-LogRoot", $LogRoot,
    "-TrustedCertPath", $TrustedCertPath,
    "-AfterEffectsProcessName", $AfterEffectsProcessName,
    "-AdobeRoots", $AdobeRoot
  )
  if ($AllowCepVersionDowngrade) {
    $arguments += "-AllowCepVersionDowngrade"
  }

  return Invoke-InstallerScript -Script $Script -Arguments $arguments
}

function Assert-InstalledCepVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$Message
  )

  $manifestInfo = Get-CepDirectoryManifestInfo -Directory $Directory
  Assert-True ([string]$manifestInfo.BundleVersion -ceq $ExpectedVersion) $Message
}

$testParent = Join-Path ([System.IO.Path]::GetTempPath()) "ArizonaInstallerTests"
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString("N"))
$testAfterEffectsProcessName = "ArizonaAeTest$((Split-Path -Leaf $testRoot).Substring(0, 8))"
$previousCommonProgramW6432 = $env:CommonProgramW6432
$previousCommonProgramFiles = $env:CommonProgramFiles
$nativeCommonFiles = Join-Path $testRoot "Program Files\Common Files"
$x86CommonFiles = Join-Path $testRoot "Program Files (x86)\Common Files"
$env:CommonProgramW6432 = $nativeCommonFiles
$env:CommonProgramFiles = $x86CommonFiles
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  # Exercise the exact swap primitive used by the installer. A failure after
  # destination -> backup must restore the old destination; the backup lives in
  # the sibling work root, never in Adobe's scanned `extensions` directory.
  $swapFixtureRoot = Join-Path $testRoot "swap-rollback-fixture\Adobe\CEP"
  $swapExtensionsRoot = Join-Path $swapFixtureRoot "extensions"
  $swapWorkRoot = Join-Path $swapFixtureRoot ".arizona-install-work"
  $swapDestination = Join-Path $swapExtensionsRoot "com.arizona-carrefour.cep"
  $swapStaging = Join-Path $swapWorkRoot "com.arizona-carrefour.cep.tmp-test"
  $swapBackup = Join-Path $swapWorkRoot "com.arizona-carrefour.cep.bak"
  New-Item -ItemType Directory -Force -Path $swapDestination, $swapStaging | Out-Null
  Set-Content -LiteralPath (Join-Path $swapDestination "old.txt") -Value "old" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $swapStaging "new.txt") -Value "new" -Encoding UTF8
  $rollbackFailureObserved = $false
  try {
    Invoke-CepDirectorySwap `
      -Destination $swapDestination `
      -Staging $swapStaging `
      -Backup $swapBackup `
      -ExtensionsRoot $swapExtensionsRoot `
      -WorkRoot $swapWorkRoot `
      -AfterBackupMoved { throw "injected failure after backup rename" } | Out-Null
  } catch {
    $rollbackFailureObserved = $true
  }
  Assert-True $rollbackFailureObserved "the rollback fixture must inject a commit failure"
  Assert-True (Test-Path -LiteralPath (Join-Path $swapDestination "old.txt") -PathType Leaf) `
    "a failed commit must restore the previous extension"
  Assert-True ($null -eq (Get-PathItem $swapBackup)) `
    "a successful rollback must not leave a recovery backup"
  Assert-True (@(Get-ChildItem -LiteralPath $swapExtensionsRoot -Force -Directory).Count -eq 1) `
    "rollback must leave exactly one visible Arizona BundleId directory"
  Remove-PathSafe `
    -Path (Join-Path $testRoot "swap-rollback-fixture") `
    -AllowedParent $testRoot `
    -Label "swap rollback fixture"

  # The installer ships the signed .zxp, so every test starts from a package.
  $payloadRoot = Join-Path $testRoot "payload"
  $payload = New-SyntheticCepPayload -PayloadRoot $payloadRoot
  $trustedCertPath = Join-Path $testRoot "cep-trusted-cert.json"
  Write-JsonFileAtomic -Path $trustedCertPath -Value ([pscustomobject]@{
    schemaVersion = 1
    certificates = @([pscustomobject]@{
      id = "test"
      sha256 = $payload.Zxp.CertificateFingerprint
    })
  })

  # Version lifecycle policy: automatic runs only move forward, equal intact
  # releases are left byte-for-byte in place, and rollback is always explicit.
  # 2.9 -> 2.10 deliberately proves numeric SemVer ordering rather than a
  # lexical string comparison.
  $policyPayloadOld = New-SyntheticCepPayload `
    -PayloadRoot (Join-Path $testRoot "policy-payload-2.9.0") `
    -BundleVersion "2.9.0"
  $policyPayloadCurrent = New-SyntheticCepPayload `
    -PayloadRoot (Join-Path $testRoot "policy-payload-2.10.0") `
    -BundleVersion "2.10.0"
  $policyPayloadNew = New-SyntheticCepPayload `
    -PayloadRoot (Join-Path $testRoot "policy-payload-2.11.0") `
    -BundleVersion "2.11.0"
  $installScript = Join-Path $scriptsRoot "install-adobe-assets.ps1"
  $policyRoot = Join-Path $testRoot "version-policy"
  $policyCepExtensionsRoot = Join-Path $policyRoot "Common Files\Adobe\CEP\extensions"
  $policyCepDestination = Join-Path $policyCepExtensionsRoot "com.arizona-carrefour.cep"
  $policyCepWorkRoot = Join-Path (Split-Path -Parent $policyCepExtensionsRoot) ".arizona-install-work"
  $policyInstallDir = Join-Path $policyRoot "Program Files\arizona-app"
  $policyStatePath = Join-Path $policyInstallDir "installer\installed-assets.json"
  $policyLogRoot = Join-Path $policyRoot "logs"
  $policyAdobeRoot = Join-Path $policyRoot "Adobe"
  $policySupportFiles = Join-Path $policyAdobeRoot "Adobe After Effects 2025\Support Files"
  $stalePolicyAex = Join-Path $policySupportFiles "Plug-ins\Arizona\ArizonaBridgeTest.aex"
  New-Item -ItemType Directory -Force -Path $policySupportFiles | Out-Null
  Set-Content -LiteralPath (Join-Path $policySupportFiles "AfterFX.exe") -Value "fake" -Encoding ASCII

  $policyInitialExit = Invoke-TestCepInstall `
    -Script $installScript `
    -PayloadRoot $policyPayloadOld.PayloadRoot `
    -InstallDir $policyInstallDir `
    -CepExtensionsRoot $policyCepExtensionsRoot `
    -LogRoot $policyLogRoot `
    -TrustedCertPath $trustedCertPath `
    -AfterEffectsProcessName $testAfterEffectsProcessName `
    -AdobeRoot $policyAdobeRoot
  Assert-True ($policyInitialExit -eq 0) "the SemVer policy fixture should install 2.9.0"
  Assert-InstalledCepVersion `
    -Directory $policyCepDestination `
    -ExpectedVersion "2.9.0" `
    -Message "the initial policy release should be 2.9.0"

  $policyUpgradeExit = Invoke-TestCepInstall `
    -Script $installScript `
    -PayloadRoot $policyPayloadCurrent.PayloadRoot `
    -InstallDir $policyInstallDir `
    -CepExtensionsRoot $policyCepExtensionsRoot `
    -LogRoot $policyLogRoot `
    -TrustedCertPath $trustedCertPath `
    -AfterEffectsProcessName $testAfterEffectsProcessName `
    -AdobeRoot $policyAdobeRoot
  Assert-True ($policyUpgradeExit -eq 0) "2.10.0 should upgrade an intact 2.9.0 installation"
  Assert-InstalledCepVersion `
    -Directory $policyCepDestination `
    -ExpectedVersion "2.10.0" `
    -Message "SemVer must order 2.10.0 after 2.9.0"

  # File metadata is outside the signed content. A distinctive timestamp proves
  # that an equal intact payload is preserved rather than silently re-extracted.
  $policyIndexPath = Join-Path $policyCepDestination "main\index.html"
  $preservedTimestamp = [DateTime]::SpecifyKind(
    [DateTime]::new(2001, 2, 3, 4, 5, 6),
    [DateTimeKind]::Utc
  )
  (Get-Item -LiteralPath $policyIndexPath).LastWriteTimeUtc = $preservedTimestamp
  $preservedTimestampTicks = (Get-Item -LiteralPath $policyIndexPath).LastWriteTimeUtc.Ticks
  $legacyBundledCep = Join-Path $policyInstallDir "installer\payload\cep\com.arizona-carrefour.cep"
  New-Item -ItemType Directory -Force -Path $legacyBundledCep | Out-Null
  Set-Content -LiteralPath (Join-Path $legacyBundledCep "obsolete.txt") -Value "obsolete" -Encoding UTF8
  $policyEqualExit = Invoke-TestCepInstall `
    -Script $installScript `
    -PayloadRoot $policyPayloadCurrent.PayloadRoot `
    -InstallDir $policyInstallDir `
    -CepExtensionsRoot $policyCepExtensionsRoot `
    -LogRoot $policyLogRoot `
    -TrustedCertPath $trustedCertPath `
    -AfterEffectsProcessName $testAfterEffectsProcessName `
    -AdobeRoot $policyAdobeRoot
  Assert-True ($policyEqualExit -eq 0) "an equal intact CEP release should be preserved"
  Assert-True ((Get-Item -LiteralPath $policyIndexPath).LastWriteTimeUtc.Ticks -eq $preservedTimestampTicks) `
    "preserving an equal intact release must not re-extract its files"
  Assert-True ($null -eq (Get-PathItem $legacyBundledCep)) `
    "an in-place upgrade should remove the exact obsolete unpacked CEP installer resource"

  # Equal version plus invalid signed content is a repair, not a preserve.
  Set-Content -LiteralPath $policyIndexPath -Value "corrupted" -Encoding UTF8
  $policyRepairExit = Invoke-TestCepInstall `
    -Script $installScript `
    -PayloadRoot $policyPayloadCurrent.PayloadRoot `
    -InstallDir $policyInstallDir `
    -CepExtensionsRoot $policyCepExtensionsRoot `
    -LogRoot $policyLogRoot `
    -TrustedCertPath $trustedCertPath `
    -AfterEffectsProcessName $testAfterEffectsProcessName `
    -AdobeRoot $policyAdobeRoot
  Assert-True ($policyRepairExit -eq 0) "an equal corrupted CEP release should be repaired"
  $repairedRelease = Assert-CepInstalledReleaseIntegrity `
    -Directory $policyCepDestination `
    -ExpectedBundleId "com.arizona-carrefour.cep" `
    -TrustedCertificateFingerprints @($payload.Zxp.CertificateFingerprint)
  Assert-True ([string]$repairedRelease.BundleVersion -ceq "2.10.0") `
    "same-version repair should restore the verified 2.10.0 release"

  $policyNewerInstallExit = Invoke-TestCepInstall `
    -Script $installScript `
    -PayloadRoot $policyPayloadNew.PayloadRoot `
    -InstallDir $policyInstallDir `
    -CepExtensionsRoot $policyCepExtensionsRoot `
    -LogRoot $policyLogRoot `
    -TrustedCertPath $trustedCertPath `
    -AfterEffectsProcessName $testAfterEffectsProcessName `
    -AdobeRoot $policyAdobeRoot
  Assert-True ($policyNewerInstallExit -eq 0) "2.11.0 should upgrade 2.10.0"
  $newerPreservedTimestamp = [DateTime]::SpecifyKind(
    [DateTime]::new(2002, 3, 4, 5, 6, 7),
    [DateTimeKind]::Utc
  )
  (Get-Item -LiteralPath $policyIndexPath).LastWriteTimeUtc = $newerPreservedTimestamp
  $newerPreservedTimestampTicks = (Get-Item -LiteralPath $policyIndexPath).LastWriteTimeUtc.Ticks
  $policyAutomaticDowngradeExit = Invoke-TestCepInstall `
    -Script $installScript `
    -PayloadRoot $policyPayloadCurrent.PayloadRoot `
    -InstallDir $policyInstallDir `
    -CepExtensionsRoot $policyCepExtensionsRoot `
    -LogRoot $policyLogRoot `
    -TrustedCertPath $trustedCertPath `
    -AfterEffectsProcessName $testAfterEffectsProcessName `
    -AdobeRoot $policyAdobeRoot
  Assert-True ($policyAutomaticDowngradeExit -eq 0) `
    "an automatic run should preserve an intact CEP newer than its payload"
  Assert-InstalledCepVersion `
    -Directory $policyCepDestination `
    -ExpectedVersion "2.11.0" `
    -Message "an automatic 2.10.0 payload must not downgrade installed CEP 2.11.0"
  Assert-True ((Get-Item -LiteralPath $policyIndexPath).LastWriteTimeUtc.Ticks -eq $newerPreservedTimestampTicks) `
    "preserving a newer intact release must not re-extract its files"

  $policyExplicitDowngradeExit = Invoke-TestCepInstall `
    -Script $installScript `
    -PayloadRoot $policyPayloadCurrent.PayloadRoot `
    -InstallDir $policyInstallDir `
    -CepExtensionsRoot $policyCepExtensionsRoot `
    -LogRoot $policyLogRoot `
    -TrustedCertPath $trustedCertPath `
    -AfterEffectsProcessName $testAfterEffectsProcessName `
    -AdobeRoot $policyAdobeRoot `
    -AllowCepVersionDowngrade
  Assert-True ($policyExplicitDowngradeExit -eq 0) `
    "a supervised run should accept the explicit CEP downgrade switch"
  Assert-InstalledCepVersion `
    -Directory $policyCepDestination `
    -ExpectedVersion "2.10.0" `
    -Message "the explicit downgrade should install CEP 2.10.0"

  # A stale schema-1 AEX record must not turn a preserve-only run into a write.
  # Also exercise cleanup of Full 2.1's unpacked CEP when that exact obsolete
  # resource is a junction: unlink the junction and retain its external target.
  Write-JsonFileAtomic -Path $policyStatePath -Value ([pscustomobject]@{
    schemaVersion = 1
    aex = @([pscustomobject]@{ path = $stalePolicyAex })
  })
  $legacyBundledCepTarget = Join-Path $policyRoot "legacy-bundled-cep-target"
  New-Item -ItemType Directory -Force -Path $legacyBundledCepTarget, (Split-Path -Parent $legacyBundledCep) | Out-Null
  $legacyBundledSentinel = Join-Path $legacyBundledCepTarget "keep.txt"
  Set-Content -LiteralPath $legacyBundledSentinel -Value "keep" -Encoding UTF8
  New-Item -ItemType Junction -Path $legacyBundledCep -Target $legacyBundledCepTarget | Out-Null
  $openAePreserveTimestampTicks = (Get-Item -LiteralPath $policyIndexPath).LastWriteTimeUtc.Ticks
  $fakeAfterEffectsExe = Join-Path $testRoot "$testAfterEffectsProcessName.exe"
  Copy-Item -LiteralPath $env:ComSpec -Destination $fakeAfterEffectsExe -Force
  $fakeAfterEffects = Start-Process `
    -FilePath $fakeAfterEffectsExe `
    -ArgumentList @("/c", "ping -n 30 127.0.0.1 > nul") `
    -WindowStyle Hidden `
    -PassThru
  try {
    for ($attempt = 0; $attempt -lt 50 -and
        !(Test-AfterEffectsRunning -ProcessName $testAfterEffectsProcessName); $attempt++) {
      Start-Sleep -Milliseconds 50
    }
    Assert-True (Test-AfterEffectsRunning -ProcessName $testAfterEffectsProcessName) `
      "the isolated After Effects policy fixture should be visible"

    $openAePreserveExit = Invoke-TestCepInstall `
      -Script $installScript `
      -PayloadRoot $policyPayloadCurrent.PayloadRoot `
      -InstallDir $policyInstallDir `
      -CepExtensionsRoot $policyCepExtensionsRoot `
      -LogRoot $policyLogRoot `
      -TrustedCertPath $trustedCertPath `
      -AfterEffectsProcessName $testAfterEffectsProcessName `
      -AdobeRoot $policyAdobeRoot
    Assert-True ($openAePreserveExit -eq 0) `
      "After Effects may remain open when the installed CEP is only being preserved"
    Assert-True ((Get-Item -LiteralPath $policyIndexPath).LastWriteTimeUtc.Ticks -eq $openAePreserveTimestampTicks) `
      "an open-After-Effects preserve run must not rewrite the CEP tree"
    Assert-True ($null -eq (Get-PathItem $stalePolicyAex)) `
      "the stale AEX fixture must remain absent"
    Assert-True ($null -eq (Get-PathItem $legacyBundledCep)) `
      "obsolete unpacked CEP junction should be unlinked during an in-place upgrade"
    Assert-True (Test-Path -LiteralPath $legacyBundledSentinel -PathType Leaf) `
      "cleanup of the obsolete CEP junction must preserve its external target"

    $openAeChangeExit = Invoke-TestCepInstall `
      -Script $installScript `
      -PayloadRoot $policyPayloadNew.PayloadRoot `
      -InstallDir $policyInstallDir `
      -CepExtensionsRoot $policyCepExtensionsRoot `
      -LogRoot $policyLogRoot `
      -TrustedCertPath $trustedCertPath `
      -AfterEffectsProcessName $testAfterEffectsProcessName `
      -AdobeRoot $policyAdobeRoot
    Assert-True ($openAeChangeExit -eq 20) `
      "After Effects should block a CEP upgrade that would change installed files"
    Assert-InstalledCepVersion `
      -Directory $policyCepDestination `
      -ExpectedVersion "2.10.0" `
      -Message "a blocked CEP upgrade must preserve the installed version"
  } finally {
    if ($null -ne $fakeAfterEffects -and !$fakeAfterEffects.HasExited) {
      Stop-Process -Id $fakeAfterEffects.Id -Force -ErrorAction SilentlyContinue
      $fakeAfterEffects.WaitForExit(5000) | Out-Null
    }
  }

  # Hold the exact kernel lock used by the helper. This is deterministic (no
  # timing race between child processes) while still exercising a concurrent
  # installer attempt through the real script entry point.
  New-Item -ItemType Directory -Force -Path $policyCepWorkRoot | Out-Null
  $policyLockPath = Join-Path $policyCepWorkRoot "com.arizona-carrefour.cep.install.lock"
  $policyTokenBeforeLock = Get-CepDirectorySnapshotToken $policyCepDestination
  $policyLockHandle = [System.IO.File]::Open(
    $policyLockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
  try {
    $concurrentInstallExit = Invoke-TestCepInstall `
      -Script $installScript `
      -PayloadRoot $policyPayloadNew.PayloadRoot `
      -InstallDir $policyInstallDir `
      -CepExtensionsRoot $policyCepExtensionsRoot `
      -LogRoot $policyLogRoot `
      -TrustedCertPath $trustedCertPath `
      -AfterEffectsProcessName $testAfterEffectsProcessName `
      -AdobeRoot $policyAdobeRoot
    Assert-True ($concurrentInstallExit -ne 0) `
      "a concurrent CEP helper must fail while another process owns the operation lock"
    Assert-True ((Get-CepDirectorySnapshotToken $policyCepDestination) -ceq $policyTokenBeforeLock) `
      "a rejected concurrent helper must not change the installed CEP tree"
  } finally {
    $policyLockHandle.Dispose()
  }
  Remove-PathSafe `
    -Path $policyLockPath `
    -AllowedParent $policyCepWorkRoot `
    -Label "policy test operation lock"
  Remove-DirectoryIfEmptySafe `
    -Path $policyCepWorkRoot `
    -AllowedParent (Split-Path -Parent $policyCepWorkRoot) `
    -Label "policy test work root" | Out-Null

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

  $cepExtensionsRoot = Join-Path $nativeCommonFiles "Adobe\CEP\extensions"
  $cepDestination = Join-Path $cepExtensionsRoot "com.arizona-carrefour.cep"
  $cepWorkRoot = Join-Path (Split-Path -Parent $cepExtensionsRoot) ".arizona-install-work"
  $installDir = Join-Path $testRoot "Program Files\arizona-app"
  $statePath = Join-Path $installDir "installer\installed-assets.json"
  $logRoot = Join-Path $testRoot "logs"

  $installExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $payloadRoot,
      "-InstallDir", $installDir,
      "-LogRoot", $logRoot,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($installExit -eq 0) "install script should succeed"
  Assert-True (Test-Path -LiteralPath $cepDestination -PathType Container) "CEP extension should be installed"
  # The extracted tree must stay byte-identical to the signed package.
  foreach ($signedEntry in @("META-INF\signatures.xml", "mimetype", "CSXS\manifest.xml", ".debug")) {
    Assert-True (Test-Path -LiteralPath (Join-Path $cepDestination $signedEntry) -PathType Leaf) `
      "extracted CEP extension should keep $signedEntry from the signed package"
  }
  Assert-True (@(Get-ChildItem -LiteralPath $cepExtensionsRoot -Force -Directory).Count -eq 1) `
    "install should leave no staging or backup sibling behind"
  Assert-True ($null -eq (Get-PathItem $cepWorkRoot)) `
    "successful install should remove the empty sibling transaction root"
  Assert-True ($null -eq (Get-PathItem (Join-Path $x86CommonFiles "Adobe\CEP\extensions\com.arizona-carrefour.cep"))) `
    "32-bit NSIS must prefer CommonProgramW6432 over CommonProgramFiles"
  Assert-True ($null -eq (Get-PathItem $pluginPath)) "upgrade should remove the first legacy AEX"
  Assert-True ($null -eq (Get-PathItem $pluginDir)) "empty legacy Arizona plugin directory should be removed"
  Assert-True ($null -eq (Get-PathItem $secondPluginPath)) "upgrade should remove the second legacy AEX"
  Assert-True (Test-Path -LiteralPath $unrelatedPluginFile -PathType Leaf) "unrelated plugin directory content must be preserved"
  Assert-True (Test-Path -LiteralPath $statePath -PathType Leaf) "installed asset state should be recorded"

  # The swap is forbidden whenever After Effects is open, even when no legacy
  # AEX remains. A renamed cmd.exe gives the detector an isolated process name
  # without interacting with the user's real After Effects process.
  $runningMarker = Join-Path $cepDestination "installed-before-running-ae.txt"
  Set-Content -LiteralPath $runningMarker -Value "keep" -Encoding UTF8
  $fakeAfterEffectsExe = Join-Path $testRoot "$testAfterEffectsProcessName.exe"
  Copy-Item -LiteralPath $env:ComSpec -Destination $fakeAfterEffectsExe -Force
  $fakeAfterEffects = Start-Process `
    -FilePath $fakeAfterEffectsExe `
    -ArgumentList @("/c", "ping -n 30 127.0.0.1 > nul") `
    -WindowStyle Hidden `
    -PassThru
  try {
    for ($attempt = 0; $attempt -lt 50 -and
        !(Test-AfterEffectsRunning -ProcessName $testAfterEffectsProcessName); $attempt++) {
      Start-Sleep -Milliseconds 50
    }
    Assert-True (Test-AfterEffectsRunning -ProcessName $testAfterEffectsProcessName) `
      "the isolated After Effects process fixture should be visible"
    $runningExit = Invoke-InstallerScript `
      -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
      -Arguments @(
        "-PayloadRoot", $payloadRoot,
        "-InstallDir", $installDir,
        "-CepExtensionsRoot", $cepExtensionsRoot,
        "-LogRoot", $logRoot,
        "-AfterEffectsProcessName", $testAfterEffectsProcessName,
        "-AdobeRoots", $adobeRoot
      )
    Assert-True ($runningExit -eq 20) "install should return the After Effects running code before staging or swap"
    Assert-True (Test-Path -LiteralPath $runningMarker -PathType Leaf) "an open After Effects process must preserve the installed tree"
    Assert-True (@(Get-ChildItem -LiteralPath $cepExtensionsRoot -Force -Directory).Count -eq 1) "an open After Effects process must not create staging or backup siblings"
  } finally {
    if ($null -ne $fakeAfterEffects -and !$fakeAfterEffects.HasExited) {
      Stop-Process -Id $fakeAfterEffects.Id -Force -ErrorAction SilentlyContinue
      $fakeAfterEffects.WaitForExit(5000) | Out-Null
    }
  }

  $installedState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  Assert-True ([int]$installedState.schemaVersion -eq 2) "installed state should use plugin-free schema 2"
  Assert-True ($null -eq $installedState.PSObject.Properties["aex"]) "installed state must not record an AEX"
  Assert-True (![bool]$installedState.releaseManifest.includesAfterEffectsPlugin) "installed state must declare that no plugin is installed"
  # Uninstall depends on cep.path only; the recorded identity is for diagnostics.
  Assert-True ((Get-FullPath ([string]$installedState.cep.path)) -eq (Get-FullPath $cepDestination)) "installed state should record the CEP destination"
  Assert-True ([string]$installedState.cep.zxpSha256 -eq $payload.Zxp.Sha256) "installed state should record the installed .zxp hash"
  Assert-True ([string]$installedState.cep.bundleVersion -eq $payload.Zxp.BundleVersion) "installed state should record the CEP bundle version"

  $uninstallLegacyBackup = Join-Path $cepExtensionsRoot "com.arizona-carrefour.cep.bak-uninstall"
  $uninstallWorkBackup = Join-Path $cepWorkRoot "com.arizona-carrefour.cep.bak"
  New-Item -ItemType Directory -Force -Path $cepWorkRoot | Out-Null
  Copy-Item -LiteralPath $cepDestination -Destination $uninstallLegacyBackup -Recurse
  Copy-Item -LiteralPath $cepDestination -Destination $uninstallWorkBackup -Recurse

  $uninstallExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "uninstall-adobe-assets.ps1") `
    -Arguments @(
      "-InstallDir", $installDir,
      "-LogRoot", $logRoot,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($uninstallExit -eq 0) "uninstall script should succeed"
  Assert-True ($null -eq (Get-PathItem $cepDestination)) "CEP extension should be removed"
  Assert-True ($null -eq (Get-PathItem $uninstallLegacyBackup)) "uninstall should clean legacy scannable backups"
  Assert-True ($null -eq (Get-PathItem $cepWorkRoot)) "uninstall should clean the Arizona transaction work root"
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
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
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

  # Installing over a development junction replaces the link, never its target.
  New-Item -ItemType Junction -Path $cepDestination -Target $junctionTarget | Out-Null
  $staleBackup = Join-Path $cepExtensionsRoot "com.arizona-carrefour.cep.bak"
  $staleLegacyBackup = Join-Path $cepExtensionsRoot "com.arizona-carrefour.cep.bak-old"
  $staleTemporary = Join-Path $cepExtensionsRoot "com.arizona-carrefour.cep.tmp-old"
  New-Item -ItemType Directory -Force -Path $staleBackup, $staleLegacyBackup, $staleTemporary | Out-Null
  $junctionInstallExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $payloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-TrustedCertPath", $trustedCertPath,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($junctionInstallExit -eq 0) "install should replace a CEP junction"
  $installedItem = Get-PathItem $cepDestination
  Assert-True (($installedItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) "installed CEP extension should no longer be a junction"
  Assert-True (Test-Path -LiteralPath (Join-Path $cepDestination "META-INF\signatures.xml") -PathType Leaf) "installed CEP extension should come from the signed package"
  Assert-True (Test-Path -LiteralPath $sentinel -PathType Leaf) "install must not delete the junction target contents"
  Assert-True ($null -eq (Get-PathItem (Join-Path $junctionTarget "META-INF"))) "install must not write through the junction"
  Assert-True ($null -eq (Get-PathItem $staleBackup)) "install should clean the shared Rust/PowerShell .bak leftover"
  Assert-True ($null -eq (Get-PathItem $staleLegacyBackup)) "install should clean legacy .bak-* leftovers"
  Assert-True ($null -eq (Get-PathItem $staleTemporary)) "install should clean .tmp-* leftovers"
  Assert-True (@(Get-ChildItem -LiteralPath $cepExtensionsRoot -Force -Directory).Count -eq 1) "install should leave no staging or backup sibling behind"
  Assert-True ($null -eq (Get-PathItem $cepWorkRoot)) "successful install should remove its empty sibling work root"

  # Simulate a crash after staging -> destination but before deleting the old
  # backup. The backup is outside `extensions`, and a failed next extraction
  # must clean it while preserving the committed destination.
  $transactionBackup = Join-Path $cepWorkRoot "com.arizona-carrefour.cep.bak"
  New-Item -ItemType Directory -Force -Path $cepWorkRoot | Out-Null
  Copy-Item -LiteralPath $cepDestination -Destination $transactionBackup -Recurse
  $postCommitMarker = Join-Path $cepDestination "installed-after-commit-crash.txt"
  Set-Content -LiteralPath $postCommitMarker -Value "keep" -Encoding UTF8

  $conflictingPayloadRoot = Join-Path $testRoot "payload-extraction-conflict"
  New-SyntheticCepPayload -PayloadRoot $conflictingPayloadRoot -IncludeExtractionConflict | Out-Null
  $postCommitRecoveryExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $conflictingPayloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-TrustedCertPath", $trustedCertPath,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($postCommitRecoveryExit -ne 0) "the deliberately conflicting extraction should fail"
  Assert-True (Test-Path -LiteralPath $postCommitMarker -PathType Leaf) `
    "a stale post-commit backup must not replace the committed extension"
  Assert-True ($null -eq (Get-PathItem $transactionBackup)) "the obsolete post-commit backup should be removed"
  Assert-True (@(Get-ChildItem -LiteralPath $cepExtensionsRoot -Force -Directory).Count -eq 1) `
    "post-commit recovery failure must leave exactly one visible BundleId directory"
  Assert-True ($null -eq (Get-PathItem $cepWorkRoot)) "failed extraction should clean the empty transaction root"

  # Simulate a crash after destination -> .bak but before staging -> destination.
  # The next run must restore that sole previous installation before extracting,
  # and it must remain available even when the new extraction then fails.
  $recoveryMarker = Join-Path $cepDestination "installed-before-crash.txt"
  Set-Content -LiteralPath $recoveryMarker -Value "keep" -Encoding UTF8
  New-Item -ItemType Directory -Force -Path $cepWorkRoot | Out-Null
  [System.IO.Directory]::Move($cepDestination, $transactionBackup)
  Assert-True ($null -eq (Get-PathItem $cepDestination)) "crash fixture should leave the CEP destination absent"
  Assert-True ($null -ne (Get-PathItem $transactionBackup)) "crash fixture should leave the previous CEP in the sibling work root"
  Assert-True (@(Get-ChildItem -LiteralPath $cepExtensionsRoot -Force -Directory).Count -eq 0) `
    "a crash backup must never be visible as another CEP extension"
  $recoveryExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $conflictingPayloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-TrustedCertPath", $trustedCertPath,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($recoveryExit -ne 0) "the deliberately conflicting extraction should fail"
  Assert-True (Test-Path -LiteralPath $cepDestination -PathType Container) "an interrupted .bak must be restored to the CEP destination"
  Assert-True (Test-Path -LiteralPath $recoveryMarker -PathType Leaf) "a failed extraction must preserve the restored previous extension"
  Assert-True ($null -eq (Get-PathItem $transactionBackup)) "the restored recovery backup should no longer remain in the work root"
  Assert-True (@(Get-ChildItem -LiteralPath $cepExtensionsRoot -Force -Directory).Count -eq 1) "failed extraction should clean staging but keep the restored destination"
  Assert-True ($null -eq (Get-PathItem $cepWorkRoot)) "recovery followed by extraction failure should leave no work items"

  $legacyCrashBackup = Join-Path $cepExtensionsRoot "com.arizona-carrefour.cep.bak-legacy-crash"
  [System.IO.Directory]::Move($cepDestination, $legacyCrashBackup)
  $legacyRecoveryExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $conflictingPayloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-TrustedCertPath", $trustedCertPath,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($legacyRecoveryExit -ne 0) "the conflicting extraction should still fail after a legacy backup recovery"
  Assert-True (Test-Path -LiteralPath $recoveryMarker -PathType Leaf) "a unique legacy .bak-* should be restored before extraction"
  Assert-True ($null -eq (Get-PathItem $legacyCrashBackup)) "a uniquely restored legacy backup should no longer remain as a sibling"
  Assert-True (@(Get-ChildItem -LiteralPath $cepExtensionsRoot -Force -Directory).Count -eq 1) `
    "legacy recovery failure must leave exactly one visible BundleId directory"

  $ambiguousBackupA = Join-Path $cepExtensionsRoot "com.arizona-carrefour.cep.bak-crash-a"
  $ambiguousBackupB = Join-Path $cepExtensionsRoot "com.arizona-carrefour.cep.bak-crash-b"
  [System.IO.Directory]::Move($cepDestination, $ambiguousBackupA)
  Copy-Item -LiteralPath $ambiguousBackupA -Destination $ambiguousBackupB -Recurse
  $ambiguousRecoveryExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $conflictingPayloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-TrustedCertPath", $trustedCertPath,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($ambiguousRecoveryExit -ne 0) "the conflicting extraction should fail with ambiguous legacy backups"
  Assert-True ($null -eq (Get-PathItem $cepDestination)) "multiple legacy backups should not be chosen arbitrarily"
  Assert-True ($null -eq (Get-PathItem $ambiguousBackupA)) "the first ambiguous backup must leave the scanned extensions root"
  Assert-True ($null -eq (Get-PathItem $ambiguousBackupB)) "the second ambiguous backup must leave the scanned extensions root"
  Assert-True (@(Get-ChildItem -LiteralPath $cepExtensionsRoot -Force -Directory).Count -eq 0) `
    "an ambiguity failure must leave no duplicate BundleId visible to CEP"
  $ambiguousRecoveryCandidates = @(Get-ChildItem -LiteralPath $cepWorkRoot -Force -Directory |
    Where-Object { $_.Name -like "com.arizona-carrefour.cep.legacy-recovery-*" })
  Assert-True ($ambiguousRecoveryCandidates.Count -eq 2) `
    "ambiguous recovery backups must be preserved outside the scanned extensions root"
  [System.IO.Directory]::Move($ambiguousRecoveryCandidates[0].FullName, $cepDestination)
  Remove-PathSafe `
    -Path $ambiguousRecoveryCandidates[1].FullName `
    -AllowedParent $cepWorkRoot `
    -Label "ambiguous recovery test backup"
  Remove-DirectoryIfEmptySafe `
    -Path $cepWorkRoot `
    -AllowedParent (Split-Path -Parent $cepWorkRoot) `
    -Label "ambiguous recovery work root" | Out-Null

  # Every payload rejection below must happen before the existing extension or
  # the legacy AEX is touched.
  New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
  Set-Content -LiteralPath $pluginPath -Value "legacy-aex" -Encoding UTF8
  $preservedMarker = Join-Path $cepDestination "installed-before-mismatch.txt"
  Set-Content -LiteralPath $preservedMarker -Value "keep" -Encoding UTF8

  $forgedPayloadRoot = Join-Path $testRoot "payload-copied-public-certificate"
  New-SyntheticCepPayload -PayloadRoot $forgedPayloadRoot -TamperSignatureValue | Out-Null
  $forgedExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $forgedPayloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-TrustedCertPath", $trustedCertPath,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($forgedExit -ne 0) "a package that copies the pinned certificate without a valid private-key signature must fail"
  Assert-True (Test-Path -LiteralPath $preservedMarker -PathType Leaf) "an invalid XML signature must preserve the installed extension"
  Assert-True (Test-Path -LiteralPath $pluginPath -PathType Leaf) "an invalid XML signature must preserve the legacy AEX"

  $foreignPayloadRoot = Join-Path $testRoot "payload-foreign-certificate"
  New-SyntheticCepPayload `
    -PayloadRoot $foreignPayloadRoot `
    -CertificateSeed "foreign-certificate" | Out-Null
  $foreignExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $foreignPayloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-TrustedCertPath", $trustedCertPath,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($foreignExit -ne 0) "a package carrying a foreign certificate must fail the install"
  Assert-True (Test-Path -LiteralPath $preservedMarker -PathType Leaf) "an untrusted certificate must preserve the installed extension"
  Assert-True (Test-Path -LiteralPath $pluginPath -PathType Leaf) "an untrusted certificate must preserve the legacy AEX"

  $missingDebugPayloadRoot = Join-Path $testRoot "payload-missing-debug"
  New-SyntheticCepPayload -PayloadRoot $missingDebugPayloadRoot -OmitDebug | Out-Null
  $missingDebugExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $missingDebugPayloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-TrustedCertPath", $trustedCertPath,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($missingDebugExit -ne 0) "a package without signed .debug must fail the install"
  Assert-True (Test-Path -LiteralPath $preservedMarker -PathType Leaf) "a missing .debug must preserve the installed extension"
  Assert-True (Test-Path -LiteralPath $pluginPath -PathType Leaf) "a missing .debug must preserve the legacy AEX"

  # A payload that does not match the manifest also aborts before any mutation.
  $tamperedPayloadRoot = Join-Path $testRoot "payload-tampered"
  New-SyntheticCepPayload -PayloadRoot $tamperedPayloadRoot -Sha256Override ("0" * 64) | Out-Null
  $mismatchExit = Invoke-InstallerScript `
    -Script (Join-Path $scriptsRoot "install-adobe-assets.ps1") `
    -Arguments @(
      "-PayloadRoot", $tamperedPayloadRoot,
      "-InstallDir", $installDir,
      "-CepExtensionsRoot", $cepExtensionsRoot,
      "-LogRoot", $logRoot,
      "-TrustedCertPath", $trustedCertPath,
      "-AfterEffectsProcessName", $testAfterEffectsProcessName,
      "-AdobeRoots", $adobeRoot
    )
  Assert-True ($mismatchExit -ne 0) "a payload hash mismatch must fail the install"
  Assert-True (Test-Path -LiteralPath $preservedMarker -PathType Leaf) "a payload hash mismatch must abort before touching the installed extension"
  Assert-True (Test-Path -LiteralPath $pluginPath -PathType Leaf) "a payload hash mismatch must abort before removing the legacy AEX"
  Assert-True (@(Get-ChildItem -LiteralPath $cepExtensionsRoot -Force -Directory).Count -eq 1) "a rejected payload must not leave a staging directory behind"

  Write-Host "Installer lifecycle tests passed."
} finally {
  $env:CommonProgramW6432 = $previousCommonProgramW6432
  $env:CommonProgramFiles = $previousCommonProgramFiles
  $testRootFull = Get-FullPath $testRoot
  $testParentFull = Get-FullPath $testParent
  Assert-PathInside -Path $testRootFull -Parent $testParentFull -Label "installer test root"
  Remove-PathSafe -Path $testRootFull -AllowedParent $testParentFull -Label "installer test root"
  Remove-DirectoryIfEmptySafe -Path $testParentFull -AllowedParent ([System.IO.Path]::GetTempPath()) -Label "installer test parent" | Out-Null
}
