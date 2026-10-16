$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts'))
. (Join-Path $scriptsRoot 'common.ps1')
. (Join-Path $scriptsRoot 'cep-system-update-core.ps1')
. (Join-Path $PSScriptRoot 'zxp-fixture.ps1')

function Assert-SystemTest {
  param([bool]$Condition, [string]$Message)
  if (!$Condition) { throw "CEP system update assertion failed: $Message" }
}
function Assert-SystemRejected {
  param([scriptblock]$Operation, [string]$Message, [int]$ExitCode = 0)
  $caught = $false
  try { & $Operation | Out-Null }
  catch {
    $caught = $true
    if ($ExitCode -ne 0) {
      Assert-SystemTest ($_.Exception.Data['CepExitCode'] -eq $ExitCode) "$Message (exit code)"
    }
  }
  Assert-SystemTest $caught $Message
}

# Only OS/process discovery and the public certificate allowlist are replaced.
# Hashing, safe paths, XML signatures, ZIP extraction, locks and directory swaps
# execute normally on isolated temporary files and ephemeral test certificates.
function Get-CepSystemCommonRoots { return $script:testCommonRoots }
function Get-CepSystemTrustedCertificates { return @($script:testCertificate) }
function Test-AfterEffectsRunning {
  $script:testAfterCalls++
  return $script:testAfterThreshold -gt 0 -and $script:testAfterCalls -ge $script:testAfterThreshold
}

$testParent = Join-Path ([IO.Path]::GetTempPath()) 'ArizonaCepSystemUpdateTests'
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$script:testCertificate = ''
$script:testCommonRoots = @()
$script:testAfterCalls = 0
$script:testAfterThreshold = 0
$originalExpand = ${function:Expand-ZipToDirectory}
$originalSwap = ${function:Invoke-CepDirectorySwap}
$originalIntegrity = ${function:Assert-CepInstalledReleaseIntegrity}
$originalSnapshot = ${function:Get-CepSystemSnapshot}

function New-SystemUpdateCase {
  param([string]$Name, [string]$InstalledVersion = '1.0.0')
  $root = Join-Path $testRoot $Name
  $script:testCommonRoots = @((Join-Path $root 'Common Files'), (Join-Path $root 'Common Files x86'))
  $script:testAfterCalls = 0
  $script:testAfterThreshold = 0
  $locations = @(Get-CepSystemLocations)
  $old = New-SyntheticZxp -Path (Join-Path $root 'old.zxp') -BundleVersion $InstalledVersion
  $new = New-SyntheticZxp -Path (Join-Path $root 'new.zxp') -BundleVersion '2.0.0'
  $script:testCertificate = $new.CertificateFingerprint
  Expand-ZipToDirectory -Path $old.Path -Destination $locations[0].Target
  return [pscustomobject]@{ Root = $root; Locations = $locations; Old = $old; New = $new; Target = $locations[0].Target; Snapshot = Get-CepDirectorySnapshotToken $locations[0].Target }
}
function Invoke-SystemCase {
  param($Case, [switch]$AllowDowngrade)
  Invoke-CepSystemUpdate -ZxpPath $Case.New.Path -ExpectedSha256 $Case.New.Sha256 -ExpectedVersion $Case.New.BundleVersion -TargetPath $Case.Target -AllowDowngrade:$AllowDowngrade
}
function Assert-SystemCaseUntouched {
  param($Case)
  Assert-SystemTest ((Get-CepDirectorySnapshotToken $Case.Target) -ceq $Case.Snapshot) 'the installed target remains byte-identical'
}

try {
  # Validate both shipped entry points using the native PowerShell parser.
  foreach ($name in @('update-cep-system.ps1', 'cep-system-update-core.ps1')) {
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $scriptsRoot $name), [ref]$tokens, [ref]$parseErrors)
    Assert-SystemTest ($parseErrors.Count -eq 0) "$name parses without errors"
    if ($name -eq 'update-cep-system.ps1') {
      $parameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
      Assert-SystemTest (($parameters -join ',') -ceq 'ZxpPath,ExpectedSha256,ExpectedVersion,TargetPath,AllowDowngrade') 'the elevated CLI has no output, root, pin or test override parameters'
    }
  }
  Assert-SystemTest ((Get-CepSystemPackagePath '\\server\share\release.zxp') -ceq '\\server\share\release.zxp') 'UNC paths are accepted only for read-only package input'
  Assert-SystemRejected { Get-CepSystemPackagePath '\\?\C:\release.zxp' } 'device namespace paths are refused'

  $case = New-SystemUpdateCase 'update-and-consolidate'
  Expand-ZipToDirectory -Path $case.Old.Path -Destination $case.Locations[1].Target
  $unrelated = Join-Path $case.Locations[1].Extensions 'com.other.extension'
  New-Item -ItemType Directory -Path $unrelated -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $unrelated 'keep.txt') -Value 'untouched'
  Invoke-SystemCase $case
  Assert-SystemTest ((Get-CepDirectoryManifestInfo $case.Target).BundleVersion -ceq '2.0.0') 'selected machine destination is updated'
  Assert-SystemTest ($null -eq (Get-PathItem $case.Locations[1].Target)) 'only the other exact machine bundle is consolidated'
  Assert-SystemTest (Test-Path -LiteralPath (Join-Path $unrelated 'keep.txt')) 'unrelated extensions survive consolidation'
  Assert-SystemTest (@(Get-ChildItem -LiteralPath $case.Locations[0].Extensions -Force).Count -eq 1) 'staging and backups never appear inside extensions'
  Invoke-SystemCase $case
  Assert-SystemTest ((Get-CepDirectoryManifestInfo $case.Target).BundleVersion -ceq '2.0.0') 'same-version reinstall is supported'

  $case = New-SystemUpdateCase 'hash-version-trust-signature'
  $realHash = $case.New.Sha256
  $case.New.Sha256 = ('0' * 64)
  Assert-SystemRejected { Invoke-SystemCase $case } 'mismatched package hash is refused'
  $case.New.Sha256 = $realHash
  $case.New.BundleVersion = '2.0.1'
  Assert-SystemRejected { Invoke-SystemCase $case } 'confirmed version mismatch is refused'
  $case.New.BundleVersion = '2.0.0'
  $script:testCertificate = ('0' * 64)
  Assert-SystemRejected { Invoke-SystemCase $case } 'untrusted publisher is refused'
  $script:testCertificate = $case.New.CertificateFingerprint
  foreach ($variant in @('TamperSignatureValue', 'TamperContentAfterSigning', 'OmitDebug', 'IncludeSourceMap', 'AddUnsignedFileAfterSigning')) {
    $arguments = @{ Path = Join-Path $case.Root "$variant.zxp"; BundleVersion = '2.0.0' }
    $arguments[$variant] = $true
    $case.New = New-SyntheticZxp @arguments
    Assert-SystemRejected { Invoke-SystemCase $case } "$variant package is refused"
  }
  Assert-SystemCaseUntouched $case

  $case = New-SystemUpdateCase 'exact-target-allowlist'
  $actualTarget = $case.Target
  foreach ($bad in @((Join-Path $case.Root 'arbitrary\Adobe\CEP\extensions\com.arizona-carrefour.cep'), (Join-Path $case.Locations[0].Extensions 'com.other.extension'), 'relative\com.arizona-carrefour.cep', '\\server\share\com.arizona-carrefour.cep')) {
    $case.Target = $bad
    Assert-SystemRejected { Invoke-SystemCase $case } 'non-allowlisted targets are refused'
  }
  $case.Target = $case.Locations[1].Target
  Assert-SystemRejected { Invoke-SystemCase $case } 'missing selected machine destination is never created'
  $case.Target = $actualTarget
  Assert-SystemCaseUntouched $case

  $case = New-SystemUpdateCase 'downgrade' '3.0.0'
  Assert-SystemRejected { Invoke-SystemCase $case } 'newer selected machine release requires confirmation'
  Assert-SystemCaseUntouched $case
  Invoke-SystemCase $case -AllowDowngrade
  Assert-SystemTest ((Get-CepDirectoryManifestInfo $case.Target).BundleVersion -ceq '2.0.0') 'explicitly confirmed downgrade is allowed'
  $case = New-SystemUpdateCase 'newer-other-machine'
  $newer = New-SyntheticZxp -Path (Join-Path $case.Root 'newer.zxp') -BundleVersion '3.0.0'
  Expand-ZipToDirectory -Path $newer.Path -Destination $case.Locations[1].Target
  Assert-SystemRejected { Invoke-SystemCase $case } 'newer secondary machine release blocks consolidation without confirmation'
  Assert-SystemCaseUntouched $case

  $case = New-SystemUpdateCase 'after-effects-open'
  $script:testAfterThreshold = 1
  Assert-SystemRejected { Invoke-SystemCase $case } 'After Effects must be closed before work' 20
  Assert-SystemCaseUntouched $case
  $script:testAfterCalls = 0; $script:testAfterThreshold = 2
  Assert-SystemRejected { Invoke-SystemCase $case } 'After Effects is checked again after extraction' 20
  Assert-SystemCaseUntouched $case

  $case = New-SystemUpdateCase 'shared-full-lock'
  $location = $case.Locations[0]
  New-Item -ItemType Directory -Path $location.Work -Force | Out-Null
  $held = [IO.File]::Open((Join-Path $location.Work 'com.arizona-carrefour.cep.install.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try { Assert-SystemRejected { Invoke-SystemCase $case } 'Full installer lock excludes the independent updater' }
  finally { $held.Dispose() }
  Assert-SystemCaseUntouched $case

  $case = New-SystemUpdateCase 'recovery-backup-preserved'
  $backup = Join-Path $case.Locations[0].Work 'com.arizona-carrefour.cep.bak'
  Expand-ZipToDirectory -Path $case.Old.Path -Destination $backup
  $backupToken = Get-CepDirectorySnapshotToken $backup
  Assert-SystemRejected { Invoke-SystemCase $case } 'preexisting recovery backup is never overwritten'
  Assert-SystemTest ((Get-CepDirectorySnapshotToken $backup) -ceq $backupToken) 'recovery contents are preserved'
  Assert-SystemCaseUntouched $case

  $case = New-SystemUpdateCase 'target-changes-during-extraction'
  $script:raceTarget = $case.Target
  function Expand-ZipToDirectory {
    param($Path, $Destination)
    & $originalExpand -Path $Path -Destination $Destination
    Set-Content -LiteralPath (Join-Path $script:raceTarget 'external-change.txt') -Value 'external change'
  }
  try { Assert-SystemRejected { Invoke-SystemCase $case } 'external target edits abort before swap' }
  finally { Set-Item -Path Function:Expand-ZipToDirectory -Value $originalExpand }
  Assert-SystemTest ((Get-CepDirectoryManifestInfo $case.Target).BundleVersion -ceq '1.0.0') 'old version survives concurrent change'
  Assert-SystemTest (Test-Path -LiteralPath (Join-Path $case.Target 'external-change.txt')) 'external change is preserved, not rolled back'

  $case = New-SystemUpdateCase 'target-removed-during-extraction'
  $script:raceTarget = $case.Target
  $script:raceMovedTarget = Join-Path $case.Root 'external-move'
  function Expand-ZipToDirectory {
    param($Path, $Destination)
    & $originalExpand -Path $Path -Destination $Destination
    [IO.Directory]::Move($script:raceTarget, $script:raceMovedTarget)
  }
  try { Assert-SystemRejected { Invoke-SystemCase $case } 'disappearing machine installation is never recreated' }
  finally { Set-Item -Path Function:Expand-ZipToDirectory -Value $originalExpand }
  Assert-SystemTest (!(Test-Path -LiteralPath $case.Target)) 'selected target remains absent after external move'

  $case = New-SystemUpdateCase 'package-locked-and-staging-tamper'
  $script:packageWriteWasBlocked = $false
  function Expand-ZipToDirectory {
    param($Path, $Destination)
    try {
      $write = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
      $write.Dispose()
    } catch { $script:packageWriteWasBlocked = $true }
    & $originalExpand -Path $Path -Destination $Destination
    Set-Content -LiteralPath (Join-Path $Destination 'main\index.html') -Value 'injected staging change'
  }
  try { Assert-SystemRejected { Invoke-SystemCase $case } 'tampered extracted bytes are refused before target mutation' }
  finally { Set-Item -Path Function:Expand-ZipToDirectory -Value $originalExpand }
  Assert-SystemTest $script:packageWriteWasBlocked 'confirmed package is held read-only through extraction'
  Assert-SystemCaseUntouched $case

  $case = New-SystemUpdateCase 'secondary-appears-during-extraction'
  $script:raceOtherTarget = $case.Locations[1].Target
  function Expand-ZipToDirectory {
    param($Path, $Destination)
    & $originalExpand -Path $Path -Destination $Destination
    & $originalExpand -Path $Path -Destination $script:raceOtherTarget
  }
  try { Assert-SystemRejected { Invoke-SystemCase $case } 'new machine copy appearing after preflight aborts without consolidation' }
  finally { Set-Item -Path Function:Expand-ZipToDirectory -Value $originalExpand }
  Assert-SystemCaseUntouched $case
  Assert-SystemTest (Test-Path -LiteralPath $case.Locations[1].Target) 'new external machine copy is preserved'

  $case = New-SystemUpdateCase 'swap-failure-rollback'
  function Invoke-CepDirectorySwap {
    param($Destination, $Staging, $Backup, $ExtensionsRoot, $WorkRoot)
    & $originalSwap -Destination $Destination -Staging $Staging -Backup $Backup -ExtensionsRoot $ExtensionsRoot -WorkRoot $WorkRoot -AfterBackupMoved { throw 'Injected rename failure' }
  }
  try { Assert-SystemRejected { Invoke-SystemCase $case } 'failure after moving original to backup is rolled back' }
  finally { Set-Item -Path Function:Invoke-CepDirectorySwap -Value $originalSwap }
  Assert-SystemCaseUntouched $case

  $case = New-SystemUpdateCase 'consolidation-failure-rollback'
  $script:testCommonRoots += Join-Path $case.Root 'Common Files z-third'
  $allLocations = @(Get-CepSystemLocations)
  foreach ($location in $allLocations | Select-Object -Skip 1) {
    Expand-ZipToDirectory -Path $case.Old.Path -Destination $location.Target
  }
  $script:rollbackSelected = $case.Target
  $script:rollbackFirstOther = $allLocations[1].Target
  $script:rollbackLastOther = $allLocations[2].Target
  function Get-CepSystemSnapshot {
    param($Location)
    if ($Location.Target -eq $script:rollbackLastOther -and
        !(Test-Path -LiteralPath $script:rollbackFirstOther) -and
        (Get-CepDirectoryManifestInfo $script:rollbackSelected).BundleVersion -ceq '2.0.0') {
      throw 'Injected consolidation failure after one other copy was quarantined'
    }
    & $originalSnapshot $Location
  }
  try { Assert-SystemRejected { Invoke-SystemCase $case } 'consolidation failure restores both target and previously retired copies' }
  finally { Set-Item -Path Function:Get-CepSystemSnapshot -Value $originalSnapshot }
  Assert-SystemCaseUntouched $case
  foreach ($location in $allLocations) {
    Assert-SystemTest ((Get-CepDirectorySnapshotToken $location.Target) -ceq $case.Snapshot) 'all pre-operation machine copies are restored'
  }

  $case = New-SystemUpdateCase 'post-commit-verification-rollback'
  $script:failIntegrityTarget = $case.Target
  function Assert-CepInstalledReleaseIntegrity {
    param($Directory, $ExpectedBundleId, $TrustedCertificateFingerprints)
    if ($Directory -eq $script:failIntegrityTarget) { throw 'Injected post-commit verification failure' }
    & $originalIntegrity -Directory $Directory -ExpectedBundleId $ExpectedBundleId -TrustedCertificateFingerprints $TrustedCertificateFingerprints
  }
  try { Assert-SystemRejected { Invoke-SystemCase $case } 'verification failure restores the previous installed release' }
  finally { Set-Item -Path Function:Assert-CepInstalledReleaseIntegrity -Value $originalIntegrity }
  Assert-SystemCaseUntouched $case

  $case = New-SystemUpdateCase 'links-preserved'
  $linkTarget = Join-Path $case.Root 'developer-build'
  $developmentPackage = New-SyntheticZxp -Path (Join-Path $case.Root 'development.zxp') -BundleVersion '9.0.0'
  Expand-ZipToDirectory -Path $developmentPackage.Path -Destination $linkTarget
  New-Item -ItemType Directory -Path $case.Locations[1].Extensions -Force | Out-Null
  New-Item -ItemType Junction -Path $case.Locations[1].Target -Target $linkTarget | Out-Null
  $linkToken = Get-CepDirectorySnapshotToken $linkTarget
  Invoke-SystemCase $case
  Assert-SystemTest (((Get-Item -LiteralPath $case.Locations[1].Target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) 'other machine junction remains intact'
  Assert-SystemTest ((Get-CepDirectorySnapshotToken $linkTarget) -ceq $linkToken) 'junction target contents remain byte-identical'
  $case.Target = $case.Locations[1].Target
  Assert-SystemRejected { Invoke-SystemCase $case } 'a junction cannot be the selected elevated destination'
  [IO.Directory]::Delete($case.Locations[1].Target, $false)

  $case = New-SystemUpdateCase 'intermediate-junction'
  $outside = Join-Path $case.Root 'outside'
  New-Item -ItemType Directory -Path $outside -Force | Out-Null
  New-Item -ItemType Directory -Path $case.Locations[1].Root -Force | Out-Null
  $link = Join-Path $case.Locations[1].Root 'Adobe'
  New-Item -ItemType Junction -Path $link -Target $outside | Out-Null
  try { Assert-SystemRejected { Invoke-SystemCase $case } 'intermediate junctions refuse elevated writes' }
  finally { [IO.Directory]::Delete($link, $false) }
  Assert-SystemTest (@(Get-ChildItem -LiteralPath $outside -Force).Count -eq 0) 'intermediate junction target stays empty'
  Assert-SystemCaseUntouched $case

  Write-Host 'CEP system update tests passed (real signatures, isolated directories, no UAC or installed-app changes).'
} finally {
  Set-Item -Path Function:Expand-ZipToDirectory -Value $originalExpand
  Set-Item -Path Function:Invoke-CepDirectorySwap -Value $originalSwap
  Set-Item -Path Function:Assert-CepInstalledReleaseIntegrity -Value $originalIntegrity
  Set-Item -Path Function:Get-CepSystemSnapshot -Value $originalSnapshot
  # Explicitly unlink any junction fixture left by a failed assertion first.
  foreach ($link in @(Get-ChildItem -LiteralPath $testRoot -Directory -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 })) {
    Assert-PathInside -Path $link.FullName -Parent $testRoot -Label 'test junction'
    [IO.Directory]::Delete($link.FullName, $false)
  }
  Assert-PathInside -Path $testRoot -Parent $testParent -Label 'CEP system test root'
  Remove-PathSafe -Path $testRoot -AllowedParent $testParent -Label 'CEP system test root'
  Remove-DirectoryIfEmptySafe -Path $testParent -AllowedParent ([IO.Path]::GetTempPath()) | Out-Null
}
