$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts'))
. (Join-Path $scriptsRoot 'common.ps1')
. (Join-Path $scriptsRoot 'cep-system-update-core.ps1')
. (Join-Path $scriptsRoot 'verify-full-cep-commit-core.ps1')
. (Join-Path $PSScriptRoot 'zxp-fixture.ps1')

function Assert-FullTest {
  param([bool]$Condition, [string]$Message)
  if (!$Condition) { throw "Full CEP commit verification assertion failed: $Message" }
}
function Assert-FullRejected {
  param([scriptblock]$Operation, [string]$Message)
  $caught = $false
  try { & $Operation | Out-Null } catch { $caught = $true }
  Assert-FullTest $caught $Message
}

# Only OS resource/root discovery is mocked. The pins, ZIPs, receipts and full
# XML signatures are real files with ephemeral certificates inside this test.
function Get-CepSystemCommonRoots { return @($script:fullCommonRoot) }
function Get-FullCepInstallerRoot { return $script:fullInstallerRoot }
function Write-InstallerLog { throw 'Read-only verification must not write logs.' }
function Get-InstallerLogRoot { throw 'Read-only verification must not inspect user profiles.' }
function Test-AfterEffectsRunning { throw 'Read-only verification must not inspect After Effects.' }

$testParent = Join-Path ([IO.Path]::GetTempPath()) 'ArizonaFullCepVerificationTests'
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$junctions = [Collections.Generic.List[string]]::new()
$originalIntegrity = ${function:Assert-CepInstalledReleaseIntegrity}
$originalZxpVerification = ${function:Assert-ZxpContentSignature}

function New-FullCase {
  param([string]$Name)
  $root = Join-Path $testRoot $Name
  $script:fullCommonRoot = Join-Path $root 'Common Files'
  $script:fullInstallerRoot = Join-Path $root 'app\installer'
  $target = @(Get-CepSystemLocations)[0].Target
  $payload = New-SyntheticCepPayload -PayloadRoot (Join-Path $script:fullInstallerRoot 'payload') -BundleVersion '2.4.0'
  Expand-ZipToDirectory -Path $payload.Zxp.Path -Destination $target
  $receipt = [pscustomobject]@{
    schemaVersion = 2
    releaseManifest = [pscustomobject]@{ appPackageVersion = '2.4.1'; tauriVersion = '2.4.1'; includesAfterEffectsPlugin = $false }
    cep = [pscustomobject]@{ path = $target; bundleVersion = '2.4.0'; zxpSha256 = $payload.Zxp.Sha256 }
  }
  $receiptPath = Join-Path $script:fullInstallerRoot 'installed-assets.json'
  Write-JsonFileAtomic -Path $receiptPath -Value $receipt
  $pinsPath = Join-Path $script:fullInstallerRoot 'cep-trusted-cert.json'
  Write-JsonFileAtomic -Path $pinsPath -Value ([pscustomobject]@{
    schemaVersion = 1
    certificates = @([pscustomobject]@{ sha256 = $payload.Zxp.CertificateFingerprint })
  })
  return [pscustomobject]@{
    Root = $root; InstallerRoot = $script:fullInstallerRoot; Target = $target
    Receipt = $receipt; ReceiptPath = $receiptPath; PinsPath = $pinsPath; Payload = $payload
  }
}
function Invoke-FullCase {
  param($Case)
  Invoke-VerifyFullCepCommit -InstallerRoot $Case.InstallerRoot -TargetPath $Case.Target
}
function Remove-FullFixturePath {
  param([string]$Path)
  Assert-PathInside -Path $Path -Parent $testRoot -Label 'verification fixture'
  Remove-PathSafe -Path $Path -AllowedParent $testRoot -Label 'verification fixture'
}

try {
  foreach ($name in @('verify-full-cep-commit.ps1', 'verify-full-cep-commit-core.ps1')) {
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $scriptsRoot $name), [ref]$tokens, [ref]$parseErrors)
    Assert-FullTest ($parseErrors.Count -eq 0) "$name parses without errors"
    $source = Get-Content -LiteralPath (Join-Path $scriptsRoot $name) -Raw
    Assert-FullTest ($source -notmatch '(?i)\bAPPDATA\b|\bHKCU\b|\bCurrentUser\b|Start-Process|Write-InstallerLog|New-Item|Remove-Item|Move-Item|Set-Content') "$name has no user-profile, elevation or mutation operations"
    if ($name -eq 'verify-full-cep-commit.ps1') {
      $parameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
      Assert-FullTest (($parameters -join ',') -ceq 'InstallerRoot,TargetPath') 'CLI has no certificate, output or test overrides'
      Assert-FullTest ($source.Contains("Write-Output 'FULL CEP commit verified'")) 'success emits the Rust marker'
    }
  }

  $case = New-FullCase 'verified-read-only'
  $machineBefore = Get-CepDirectorySnapshotToken $case.Target
  $resourcesBefore = Get-CepDirectorySnapshotToken $case.InstallerRoot
  $result = Invoke-FullCase $case
  Assert-FullTest ($result.TargetPath -ceq $case.Target -and $result.BundleVersion -ceq '2.4.0') 'valid Full commit is accepted'
  Assert-FullTest ((Get-CepDirectorySnapshotToken $case.Target) -ceq $machineBefore) 'verification preserves every machine byte'
  Assert-FullTest ((Get-CepDirectorySnapshotToken $case.InstallerRoot) -ceq $resourcesBefore) 'verification preserves every resource byte and creates no files'

  $case = New-FullCase 'same-content-reissue'
  $case.Payload = New-SyntheticCepPayload -PayloadRoot $case.Payload.PayloadRoot -BundleVersion '2.4.0' -ReverseSignedEntries
  Assert-FullTest ($case.Receipt.cep.zxpSha256 -cne $case.Payload.Zxp.Sha256) 'fixture reissue has a different ZIP/signature envelope'
  Invoke-FullCase $case | Out-Null

  $case = New-FullCase 'preserved-manual-install-without-archive-hash'
  $case.Receipt.cep.zxpSha256 = $null
  Write-JsonFileAtomic -Path $case.ReceiptPath -Value $case.Receipt
  Invoke-FullCase $case | Out-Null

  $case = New-FullCase 'same-version-different-content'
  $case.Payload = New-SyntheticCepPayload -PayloadRoot $case.Payload.PayloadRoot -BundleVersion '2.4.0' -IndexContent '<html>revised content</html>'
  Assert-FullRejected { Invoke-FullCase $case } 'equal version with different signed content cannot authorize cleanup'

  foreach ($variant in @('TamperSignatureValue', 'TamperContentAfterSigning', 'OmitSignatures', 'OmitDebug', 'IncludeSourceMap', 'AddUnsignedFileAfterSigning')) {
    $case = New-FullCase "invalid-payload-$variant"
    $arguments = @{ PayloadRoot = $case.Payload.PayloadRoot; BundleVersion = '2.4.0' }
    $arguments[$variant] = $true
    New-SyntheticCepPayload @arguments | Out-Null
    Assert-FullRejected { Invoke-FullCase $case } "$variant payload is rejected with a matching outer ZIP hash"
  }
  $case = New-FullCase 'wrong-payload-hash'
  $case.Payload.Manifest.cepZxpSha256 = '0' * 64
  Write-JsonFileAtomic -Path (Join-Path $case.Payload.PayloadRoot 'release-manifest.json') -Value $case.Payload.Manifest
  Assert-FullRejected { Invoke-FullCase $case } 'manifest hash must match actual payload'

  $case = New-FullCase 'foreign-payload-publisher'
  New-SyntheticCepPayload -PayloadRoot $case.Payload.PayloadRoot -BundleVersion '2.4.0' -CertificateSeed 'foreign-payload' | Out-Null
  Assert-FullRejected { Invoke-FullCase $case } 'validly signed payload from an unpinned publisher is rejected'
  $case = New-FullCase 'foreign-installed-publisher'
  $foreign = New-SyntheticZxp -Path (Join-Path $case.Root 'foreign.zxp') -BundleVersion '2.4.0' -CertificateSeed 'foreign-machine'
  Remove-FullFixturePath $case.Target
  Expand-ZipToDirectory -Path $foreign.Path -Destination $case.Target
  Assert-FullRejected { Invoke-FullCase $case } 'installed signature also requires a pinned publisher'

  foreach ($variant in @('tampered-content', 'unsigned-extra', 'missing-file', 'bad-signature', 'wrong-version', 'wrong-bundle')) {
    $case = New-FullCase "installed-$variant"
    switch ($variant) {
      'tampered-content' { Set-Content -LiteralPath (Join-Path $case.Target 'main\index.html') -Value 'modified' }
      'unsigned-extra' { Set-Content -LiteralPath (Join-Path $case.Target 'extra.js') -Value 'unlisted' }
      'missing-file' { Remove-FullFixturePath (Join-Path $case.Target '.debug') }
      default {
        $arguments = @{ Path = Join-Path $case.Root 'replacement.zxp'; BundleVersion = '2.4.0' }
        if ($variant -eq 'bad-signature') { $arguments.TamperSignatureValue = $true }
        if ($variant -eq 'wrong-version') { $arguments.BundleVersion = '2.4.1' }
        if ($variant -eq 'wrong-bundle') { $arguments.BundleId = 'com.other.cep' }
        $replacement = New-SyntheticZxp @arguments
        Remove-FullFixturePath $case.Target
        Expand-ZipToDirectory -Path $replacement.Path -Destination $case.Target
      }
    }
    Assert-FullRejected { Invoke-FullCase $case } "$variant installed content is rejected"
  }

  foreach ($kind in @('receipt', 'manifest', 'pins')) {
    foreach ($json in @('null', '[]', '{', '{}', '{"schemaVersion":"2"}', '{"schemaVersion":2.1}')) {
      $case = New-FullCase ("metadata-$kind-" + [guid]::NewGuid().ToString('N'))
      $path = switch ($kind) {
        'receipt' { $case.ReceiptPath }
        'manifest' { Join-Path $case.Payload.PayloadRoot 'release-manifest.json' }
        'pins' { $case.PinsPath }
      }
      Set-Content -LiteralPath $path -Value $json
      Assert-FullRejected { Invoke-FullCase $case } "$kind null, missing or malformed fields are rejected"
    }
  }
  foreach ($field in @('path', 'bundleVersion', 'zxpSha256')) {
    $case = New-FullCase "receipt-$field"
    $case.Receipt.cep.$field = 'incorrect'
    Write-JsonFileAtomic -Path $case.ReceiptPath -Value $case.Receipt
    Assert-FullRejected { Invoke-FullCase $case } "receipt $field must identify the committed machine release"
  }
  foreach ($field in @('schemaVersion', 'cepExtensionId', 'cepZxpFileName', 'includesAfterEffectsPlugin', 'cepBundleVersion')) {
    $case = New-FullCase "manifest-$field"
    $case.Payload.Manifest.$field = 'incorrect'
    Write-JsonFileAtomic -Path (Join-Path $case.Payload.PayloadRoot 'release-manifest.json') -Value $case.Payload.Manifest
    Assert-FullRejected { Invoke-FullCase $case } "release manifest $field is validated"
  }
  foreach ($missing in @('installed-assets.json', 'payload\release-manifest.json', 'payload\cep\com.arizona-carrefour.cep.zxp', 'cep-trusted-cert.json')) {
    $case = New-FullCase ('missing-' + [guid]::NewGuid().ToString('N'))
    Remove-FullFixturePath (Join-Path $case.InstallerRoot $missing)
    Assert-FullRejected { Invoke-FullCase $case } "missing $missing cannot authorize cleanup"
  }
  $case = New-FullCase 'oversized-receipt'
  [IO.File]::WriteAllText($case.ReceiptPath, (' ' * (2MB + 1)))
  Assert-FullRejected { Invoke-FullCase $case } 'oversized metadata is rejected before JSON parsing'

  $case = New-FullCase 'path-allowlist'
  $validTarget = $case.Target
  foreach ($bad in @('relative', '\\server\share\com.arizona-carrefour.cep', (Join-Path $case.Root 'com.arizona-carrefour.cep'), (Join-Path (Split-Path -Parent $case.Target) 'com.other.cep'))) {
    $case.Target = $bad
    Assert-FullRejected { Invoke-FullCase $case } 'non-allowlisted destination is rejected'
  }
  $case.Target = $validTarget
  $case.InstallerRoot = Join-Path $case.Root 'alternate-resource-root'
  Assert-FullRejected { Invoke-FullCase $case } 'caller cannot select another resource/pin root'
  $case = New-FullCase 'target-absent'
  Remove-FullFixturePath $case.Target
  Assert-FullRejected { Invoke-FullCase $case } 'missing machine target is rejected without recreation'
  Assert-FullTest (!(Test-Path -LiteralPath $case.Target)) 'missing target remains absent'

  foreach ($where in @('target', 'target-ancestor', 'resource-root', 'resource-ancestor')) {
    $case = New-FullCase "junction-$where"
    $path = switch ($where) {
      'target' { $case.Target }
      'target-ancestor' { Join-Path $script:fullCommonRoot 'Adobe' }
      'resource-root' { $case.InstallerRoot }
      'resource-ancestor' { Join-Path $case.InstallerRoot 'payload' }
    }
    $moved = Join-Path $case.Root 'junction-target'
    Assert-PathInside -Path $path -Parent $testRoot
    Assert-PathInside -Path $moved -Parent $testRoot
    [IO.Directory]::Move($path, $moved)
    New-Item -ItemType Junction -Path $path -Target $moved | Out-Null
    $junctions.Add($path)
    $before = Get-CepDirectorySnapshotToken $moved
    Assert-FullRejected { Invoke-FullCase $case } "$where junction is rejected"
    Assert-FullTest ((Get-CepDirectorySnapshotToken $moved) -ceq $before) "$where linked contents remain unchanged"
    [IO.Directory]::Delete($path, $false)
    [void]$junctions.Remove($path)
  }

  $case = New-FullCase 'resources-held-read-only'
  $script:fullReadOnlyPaths = @($case.ReceiptPath, $case.PinsPath, $case.Payload.Zxp.Path, (Join-Path $case.Payload.PayloadRoot 'release-manifest.json'))
  $script:fullBlockedWrites = 0
  function Assert-ZxpContentSignature {
    param($Path)
    foreach ($resource in $script:fullReadOnlyPaths) {
      try {
        $writer = [IO.File]::Open($resource, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
        $writer.Dispose()
      } catch { $script:fullBlockedWrites++ }
    }
    & $originalZxpVerification -Path $Path
  }
  try { Invoke-FullCase $case | Out-Null }
  finally { Set-Item -Path Function:Assert-ZxpContentSignature -Value $originalZxpVerification }
  Assert-FullTest ($script:fullBlockedWrites -eq 4) 'all critical resource files deny concurrent writes'

  $case = New-FullCase 'machine-changes-during-verification'
  function Assert-CepInstalledReleaseIntegrity {
    param($Directory, $ExpectedBundleId, $TrustedCertificateFingerprints)
    $verified = & $originalIntegrity -Directory $Directory -ExpectedBundleId $ExpectedBundleId -TrustedCertificateFingerprints $TrustedCertificateFingerprints
    Set-Content -LiteralPath (Join-Path $Directory 'main\index.html') -Value 'concurrent external change'
    return $verified
  }
  try { Assert-FullRejected { Invoke-FullCase $case } 'machine changes during verification invalidate the evidence' }
  finally { Set-Item -Path Function:Assert-CepInstalledReleaseIntegrity -Value $originalIntegrity }

  # CLI failure path runs unelevated and rejects its relative input before any
  # real machine or profile can be inspected. No special testing CLI exists.
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = Join-Path $PSHOME 'powershell.exe'
  $start.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $scriptsRoot 'verify-full-cep-commit.ps1') + '" -InstallerRoot relative -TargetPath relative'
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($start)
  try {
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    Assert-FullTest ($process.ExitCode -eq 1 -and !$stdout.Contains('FULL CEP commit verified')) 'CLI failures return 1 without a success marker'
    Assert-FullTest (![string]::IsNullOrWhiteSpace($stderr)) 'CLI failures report their reason'
  } finally { $process.Dispose() }
  Write-Host 'Full CEP commit verification tests passed (read-only verifier, real signatures, isolated fixtures).'
} finally {
  Set-Item -Path Function:Assert-CepInstalledReleaseIntegrity -Value $originalIntegrity
  Set-Item -Path Function:Assert-ZxpContentSignature -Value $originalZxpVerification
  foreach ($link in $junctions) {
    Assert-PathInside -Path $link -Parent $testRoot -Label 'verification fixture junction'
    if ($null -ne (Get-PathItem $link)) { [IO.Directory]::Delete($link, $false) }
  }
  Assert-PathInside -Path $testRoot -Parent $testParent -Label 'verification test root'
  Remove-PathSafe -Path $testRoot -AllowedParent $testParent -Label 'verification test root'
  Remove-DirectoryIfEmptySafe -Path $testParent -AllowedParent ([IO.Path]::GetTempPath()) | Out-Null
}
