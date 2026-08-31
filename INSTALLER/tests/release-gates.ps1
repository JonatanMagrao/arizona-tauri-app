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

function Invoke-VerifyRelease {
  param(
    [Parameter(Mandatory = $true)][string]$PayloadRoot,
    [Parameter(Mandatory = $true)][string]$TrustedCertPath,
    [Parameter(Mandatory = $true)][string]$CepVerifierScript
  )

  $powershell = Join-Path $PSHOME "powershell.exe"
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $powershell -NoProfile -ExecutionPolicy Bypass `
      -File (Join-Path $scriptsRoot "verify-release.ps1") `
      -RequirePayload `
      -PayloadRoot $PayloadRoot `
      -TrustedCertPath $TrustedCertPath `
      -CepVerifierScript $CepVerifierScript 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  return [pscustomobject]@{
    ExitCode = [int]$exitCode
    Output = (($output | ForEach-Object { [string]$_ }) -join "`n")
  }
}

function Invoke-VerifySignedTauri {
  param(
    [Parameter(Mandatory = $true)][string]$TauriExePath,
    [Parameter(Mandatory = $true)][string]$NsisBundlePath
  )

  $powershell = Join-Path $PSHOME "powershell.exe"
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $powershell -NoProfile -ExecutionPolicy Bypass `
      -File (Join-Path $scriptsRoot "verify-release.ps1") `
      -RequireSignedTauri `
      -TauriExePath $TauriExePath `
      -NsisBundlePath $NsisBundlePath 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  return [pscustomobject]@{
    ExitCode = [int]$exitCode
    Output = (($output | ForEach-Object { [string]$_ }) -join "`n")
  }
}

function Write-MockCepVerifier {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [ValidateSet("valid", "success-without-marker", "rejected")]
    [string]$Mode = "valid"
  )

  $lines = @(
    "const mode = '$Mode';",
    'if (process.argv.length !== 3) {',
    '  console.error("CEP ZXP verification failed: expected exactly one ZXP path");',
    '  process.exit(64);',
    '}'
  )
  if ($Mode -eq "rejected") {
    $lines += 'console.error("CEP ZXP verification failed: mock RFC3161 rejection");'
    $lines += 'process.exit(1);'
  } elseif ($Mode -eq "success-without-marker") {
    $lines += 'console.log("mock verifier silently succeeded");'
    $lines += 'process.exit(0);'
  } else {
    $lines += 'console.log("CEP ZXP verification passed: " + process.argv[2]);'
    $lines += 'console.log("fingerprint: mock");'
    $lines += 'console.log("genTime: 2026-08-04T12:00:00.000Z");'
    $lines += 'process.exit(0);'
  }
  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

function Write-TrustedCertManifest {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string[]]$Fingerprints = @()
  )

  $certificates = @($Fingerprints | ForEach-Object {
    [pscustomobject]@{
      id = "test"
      sha256 = $_
      commonName = "com.arizona-carrefour.cep"
      notAfter = "2099-01-01T00:00:00Z"
      addedAt = "2026-01-01T00:00:00Z"
    }
  })
  Write-JsonFileAtomic -Path $Path -Value ([pscustomobject]@{
    schemaVersion = 1
    certificates = $certificates
  })
}

$testParent = Join-Path ([System.IO.Path]::GetTempPath()) "ArizonaReleaseGateTests"
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  $packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
  $tauriConfig = Get-Content -LiteralPath (Join-Path $repoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
  $extensionPackageJson = Get-Content -LiteralPath (Join-Path $repoRoot "ARIZONA-EXTENSION\package.json") -Raw | ConvertFrom-Json

  $publicReleaseCommand = [string](Get-JsonProperty $packageJson.scripts "release:verify-public")
  Assert-True (![string]::IsNullOrWhiteSpace($publicReleaseCommand)) `
    "package.json must expose a public-distribution verification entry point"
  Assert-True ($publicReleaseCommand.StartsWith("npm run release:all && ", [System.StringComparison]::Ordinal)) `
    "the public-distribution command must run the normal release build before its signature gate"
  Assert-True ($publicReleaseCommand.Contains("verify-release.ps1 -RequirePayload -RequireSignedTauri")) `
    "the public-distribution command must require both the payload and Authenticode gates"

  # The public gate is separate from release:all so local/reproducible builds do
  # not require access to the publisher certificate.
  $normalReleaseCommand = [string](Get-JsonProperty $packageJson.scripts "release:all")
  Assert-True (!$normalReleaseCommand.Contains("RequireSignedTauri")) `
    "the normal local release build must remain usable without an Authenticode certificate"
  Assert-True (!$normalReleaseCommand.Contains("tauri:clean") -and !$normalReleaseCommand.Contains("cargo clean")) `
    "the release must not erase reusable Cargo build artifacts"

  $cepDevCleanCommand = [string](Get-JsonProperty $packageJson.scripts "cep:dev-clean")
  Assert-True ($cepDevCleanCommand.Contains("ensure-cep-dev-link.mjs --remove")) `
    "package.json must expose the scoped CEP development-junction cleanup"

  $postCepZxpCommand = [string](Get-JsonProperty $packageJson.scripts "postcep:zxp")
  Assert-True ($postCepZxpCommand -ceq "npm run cep:dev-clean") `
    "every successful signed CEP build must remove its development junction afterwards"

  $signedFixtureSource = Join-Path $PSHOME "powershell.exe"
  Assert-True (Test-Path -LiteralPath $signedFixtureSource -PathType Leaf) `
    "the Windows-signed PowerShell executable is required as the Authenticode fixture"
  $fixtureSignature = Get-AuthenticodeSignature -LiteralPath $signedFixtureSource
  Assert-True ([string]$fixtureSignature.Status -ceq "Valid") `
    "the Authenticode fixture must have Status=Valid"

  $authenticodeRoot = Join-Path $testRoot "authenticode"
  $signedExePath = Join-Path $authenticodeRoot "arizona-app.exe"
  $nsisRoot = Join-Path $authenticodeRoot "nsis"
  $expectedSetupName = "arizona-app_$($tauriConfig.version)_x64-setup.exe"
  $signedSetupPath = Join-Path $nsisRoot $expectedSetupName
  New-Item -ItemType Directory -Force -Path $nsisRoot | Out-Null
  Copy-Item -LiteralPath $signedFixtureSource -Destination $signedExePath
  Copy-Item -LiteralPath $signedFixtureSource -Destination $signedSetupPath

  $validAuthenticodeResult = Invoke-VerifySignedTauri `
    -TauriExePath $signedExePath `
    -NsisBundlePath $nsisRoot
  if ($validAuthenticodeResult.ExitCode -ne 0) {
    Write-Host $validAuthenticodeResult.Output
  }
  Assert-True ($validAuthenticodeResult.ExitCode -eq 0) `
    "one version-matched NSIS setup and the Tauri executable should pass when both signatures are valid"
  Assert-True ($validAuthenticodeResult.Output -match "Tauri release executable Authenticode signature is valid") `
    "the public gate must report the valid Tauri executable"
  Assert-True ($validAuthenticodeResult.Output -match "NSIS setup $([regex]::Escape([string]$tauriConfig.version)) Authenticode signature is valid") `
    "the public gate must report the valid version-matched NSIS setup"

  $missingExeResult = Invoke-VerifySignedTauri `
    -TauriExePath (Join-Path $authenticodeRoot "missing-arizona-app.exe") `
    -NsisBundlePath $nsisRoot
  Assert-True ($missingExeResult.ExitCode -ne 0) "a missing Tauri executable must fail the public gate"
  Assert-True ($missingExeResult.Output -match "Tauri release executable not found") `
    "the missing-executable failure must name the absent artifact"

  $emptyNsisRoot = Join-Path $authenticodeRoot "empty-nsis"
  New-Item -ItemType Directory -Force -Path $emptyNsisRoot | Out-Null
  $missingSetupResult = Invoke-VerifySignedTauri `
    -TauriExePath $signedExePath `
    -NsisBundlePath $emptyNsisRoot
  Assert-True ($missingSetupResult.ExitCode -ne 0) "a missing version-matched NSIS setup must fail the public gate"
  Assert-True ($missingSetupResult.Output -match "NSIS setup .* version $([regex]::Escape([string]$tauriConfig.version)) not found") `
    "the missing-setup failure must name the expected release version"

  $staleNsisRoot = Join-Path $authenticodeRoot "stale-nsis"
  New-Item -ItemType Directory -Force -Path $staleNsisRoot | Out-Null
  Copy-Item -LiteralPath $signedFixtureSource -Destination (Join-Path $staleNsisRoot "arizona-app_2.1.0_x64-setup.exe")
  $staleSetupResult = Invoke-VerifySignedTauri `
    -TauriExePath $signedExePath `
    -NsisBundlePath $staleNsisRoot
  Assert-True ($staleSetupResult.ExitCode -ne 0) "a signed setup for a stale version must not satisfy the public gate"
  Assert-True ($staleSetupResult.Output -match "version $([regex]::Escape([string]$tauriConfig.version)) not found") `
    "the stale-setup failure must continue to require the configured version"

  Copy-Item -LiteralPath $signedFixtureSource -Destination (Join-Path $nsisRoot "arizona-app_$($tauriConfig.version)_arm64-setup.exe")
  $ambiguousSetupResult = Invoke-VerifySignedTauri `
    -TauriExePath $signedExePath `
    -NsisBundlePath $nsisRoot
  Assert-True ($ambiguousSetupResult.ExitCode -ne 0) "multiple version-matched NSIS setups must fail closed"
  Assert-True ($ambiguousSetupResult.Output -match "Ambiguous NSIS setups") `
    "the multiple-setup failure must explicitly name the ambiguity"

  $unsignedExePath = Join-Path $authenticodeRoot "unsigned-arizona-app.exe"
  Copy-Item -LiteralPath $signedFixtureSource -Destination $unsignedExePath
  [System.IO.File]::AppendAllText($unsignedExePath, "tampered")
  $unsignedExeResult = Invoke-VerifySignedTauri `
    -TauriExePath $unsignedExePath `
    -NsisBundlePath $staleNsisRoot
  Assert-True ($unsignedExeResult.ExitCode -ne 0) "an unsigned Tauri executable must fail the public gate"
  Assert-True ($unsignedExeResult.Output -match "Status=NotSigned") `
    "the unsigned-executable failure must expose the Authenticode status"

  $unsignedNsisRoot = Join-Path $authenticodeRoot "unsigned-nsis"
  New-Item -ItemType Directory -Force -Path $unsignedNsisRoot | Out-Null
  $unsignedSetupPath = Join-Path $unsignedNsisRoot $expectedSetupName
  Copy-Item -LiteralPath $signedFixtureSource -Destination $unsignedSetupPath
  [System.IO.File]::AppendAllText($unsignedSetupPath, "tampered")
  $unsignedSetupResult = Invoke-VerifySignedTauri `
    -TauriExePath $signedExePath `
    -NsisBundlePath $unsignedNsisRoot
  Assert-True ($unsignedSetupResult.ExitCode -ne 0) "an unsigned NSIS setup must fail the public gate"
  Assert-True ($unsignedSetupResult.Output -match "Status=NotSigned") `
    "the unsigned-setup failure must expose the Authenticode status"

  $commonInstallerScript = Get-Content -LiteralPath (Join-Path $scriptsRoot "common.ps1") -Raw
  $installAdobeAssets = Get-Content -LiteralPath (Join-Path $scriptsRoot "install-adobe-assets.ps1") -Raw
  $uninstallAdobeAssets = Get-Content -LiteralPath (Join-Path $scriptsRoot "uninstall-adobe-assets.ps1") -Raw
  Assert-True ($commonInstallerScript.Contains('CommonProgramW6432')) `
    "native Common Files resolution must be safe when the i386 NSIS host launches 32-bit PowerShell"
  foreach ($fullHelper in @($installAdobeAssets, $uninstallAdobeAssets)) {
    Assert-True ($fullHelper.Contains('Get-SystemCommonProgramFiles')) `
      "Full helpers must share the native system Common Files resolver"
    Assert-True ($fullHelper.Contains('Adobe\CEP\extensions')) `
      "Full helpers must target the system Adobe CEP extensions root"
    Assert-True ($fullHelper.Contains('.arizona-install-work')) `
      "Full helpers must keep transactions in the sibling Arizona work root"
    Assert-True (!$fullHelper.Contains('CsxsRegistryBasePath')) `
      "elevated Full helpers must not accept a per-user CSXS registry root"
    Assert-True (!$fullHelper.Contains('Disable-CepPlayerDebugMode')) `
      "elevated Full helpers must not mutate per-user CEP debug state"
    Assert-True (!$fullHelper.Contains('Join-Path $env:APPDATA "Adobe\CEP\extensions"')) `
      "Full helpers must not target a per-user CEP extension directory"
  }
  Assert-True (!$installAdobeAssets.Contains('$env:APPDATA')) `
    "Full install helper must not write under APPDATA"
  Assert-True (!$installAdobeAssets.Contains('Join-Path $cepExtensionsRootFull "com.arizona-carrefour.cep.tmp-')) `
    "CEP staging must never be a child of the scanned extensions root"
  Assert-True (!$installAdobeAssets.Contains('Join-Path $cepExtensionsRootFull "com.arizona-carrefour.cep.bak')) `
    "CEP backups must never be children of the scanned extensions root"

  # The fingerprint contract (P2), shared with src-tauri/src/cep_manager.rs:
  # lowercase hex SHA-256 over the raw DER bytes carried by signatures.xml.
  $fingerprintProbe = New-SyntheticZxp -Path (Join-Path $testRoot "fingerprint-probe.zxp") -CertificateSeed "arizona-fingerprint-probe"
  $actualFingerprint = Get-ZxpSigningCertificateFingerprint $fingerprintProbe.Path
  Assert-True ($actualFingerprint -cmatch "^[0-9a-f]{64}$") "signing fingerprint must be lowercase hex SHA-256 over the DER bytes"
  Assert-True ($actualFingerprint -ceq $fingerprintProbe.CertificateFingerprint) "fixture and helper must agree on the fingerprint"
  $probeVerification = Assert-ZxpContentSignature -Path $fingerprintProbe.Path
  Assert-True ($probeVerification.CertificateFingerprint -ceq $actualFingerprint) "the synthetic package must carry a real XML signature for the pinned certificate"

  function New-GatePayload {
    param(
      [Parameter(Mandatory = $true)][string]$Name,
      [string]$CertificateSeed = "arizona-release-certificate",
      [switch]$OmitSignatures,
      [switch]$OmitDebug,
      [switch]$IncludeSourceMap
    )

    return New-SyntheticCepPayload `
      -PayloadRoot (Join-Path $testRoot $Name) `
      -AppPackageVersion ([string]$packageJson.version) `
      -TauriVersion ([string]$tauriConfig.version) `
      -BundleVersion ([string]$extensionPackageJson.version) `
      -CertificateSeed $CertificateSeed `
      -OmitSignatures:$OmitSignatures `
      -OmitDebug:$OmitDebug `
      -IncludeSourceMap:$IncludeSourceMap
  }

  $validVerifierPath = Join-Path $testRoot "mock-cep-verifier-valid.mjs"
  $missingMarkerVerifierPath = Join-Path $testRoot "mock-cep-verifier-missing-marker.mjs"
  $rejectedVerifierPath = Join-Path $testRoot "mock-cep-verifier-rejected.mjs"
  Write-MockCepVerifier -Path $validVerifierPath -Mode valid
  Write-MockCepVerifier -Path $missingMarkerVerifierPath -Mode success-without-marker
  Write-MockCepVerifier -Path $rejectedVerifierPath -Mode rejected

  # 1. A structurally valid payload with the pinned certificate and a positive
  #    shared-verifier result passes. Cryptographic behavior itself is exercised
  #    by scripts/verify-cep-zxp.mjs against a real package; this fixture checks
  #    the PowerShell handoff and all independent release-manifest gates.
  $trustedPayload = New-GatePayload -Name "payload-trusted"
  $trustedCertPath = Join-Path $testRoot "cep-trusted-cert.json"
  Write-TrustedCertManifest -Path $trustedCertPath -Fingerprints @($trustedPayload.Zxp.CertificateFingerprint)

  $trustedResult = Invoke-VerifyRelease `
    -PayloadRoot $trustedPayload.PayloadRoot `
    -TrustedCertPath $trustedCertPath `
    -CepVerifierScript $validVerifierPath
  if ($trustedResult.ExitCode -ne 0) {
    Write-Host $trustedResult.Output
  }
  Assert-True ($trustedResult.ExitCode -eq 0) "a payload signed by the pinned certificate should pass verification"

  # 2. A foreign certificate is rejected. This is the gate that catches shipping
  #    an extension that Adobe CEP will refuse to load without PlayerDebugMode.
  $foreignPayload = New-GatePayload -Name "payload-foreign" -CertificateSeed "somebody-elses-certificate"
  $foreignResult = Invoke-VerifyRelease -PayloadRoot $foreignPayload.PayloadRoot -TrustedCertPath $trustedCertPath -CepVerifierScript $validVerifierPath
  Assert-True ($foreignResult.ExitCode -ne 0) "a payload signed by another certificate must fail verification"
  Assert-True ($foreignResult.Output -match "does not trust") "the untrusted-certificate failure must name the problem"
  Assert-True ($foreignResult.Output -match [regex]::Escape($foreignPayload.Zxp.CertificateFingerprint)) "the failure must show the payload fingerprint"

  # 3. An unsigned package is rejected the same way.
  $unsignedPayload = New-GatePayload -Name "payload-unsigned" -OmitSignatures
  $unsignedResult = Invoke-VerifyRelease -PayloadRoot $unsignedPayload.PayloadRoot -TrustedCertPath $trustedCertPath -CepVerifierScript $validVerifierPath
  Assert-True ($unsignedResult.ExitCode -ne 0) "an unsigned payload must fail verification"
  Assert-True ($unsignedResult.Output -match "not a signed .zxp") "the unsigned failure must say the payload is not a signed .zxp"

  # 4. A payload whose bytes drifted from the manifest is rejected.
  $tamperedPayload = New-GatePayload -Name "payload-tampered"
  [System.IO.File]::AppendAllText($tamperedPayload.Zxp.Path, "tampered")
  $tamperedResult = Invoke-VerifyRelease -PayloadRoot $tamperedPayload.PayloadRoot -TrustedCertPath $trustedCertPath -CepVerifierScript $validVerifierPath
  Assert-True ($tamperedResult.ExitCode -ne 0) "a payload that no longer matches the manifest must fail verification"
  Assert-True ($tamperedResult.Output -match "SHA-256 does not match") "the tampered-payload failure must name the hash mismatch"

  # 5. An unsigned build folder in the payload is rejected outright.
  $folderPayload = New-GatePayload -Name "payload-folder"
  New-Item -ItemType Directory -Force -Path (Join-Path $folderPayload.PayloadRoot "cep\com.arizona-carrefour.cep") | Out-Null
  $folderResult = Invoke-VerifyRelease -PayloadRoot $folderPayload.PayloadRoot -TrustedCertPath $trustedCertPath -CepVerifierScript $validVerifierPath
  Assert-True ($folderResult.ExitCode -ne 0) "an unsigned build folder in the payload must fail verification"
  Assert-True ($folderResult.Output -match "never an unsigned build folder") "the build-folder failure must explain the distribution shape"

  # 6. An empty pinned manifest fails closed instead of trusting everything.
  $emptyCertPath = Join-Path $testRoot "cep-trusted-cert-empty.json"
  Write-TrustedCertManifest -Path $emptyCertPath
  $emptyResult = Invoke-VerifyRelease -PayloadRoot $trustedPayload.PayloadRoot -TrustedCertPath $emptyCertPath -CepVerifierScript $validVerifierPath
  Assert-True ($emptyResult.ExitCode -ne 0) "an empty pinned certificate list must fail closed"
  Assert-True ($emptyResult.Output -match "No trusted CEP signing certificate") "the empty-pin failure must ask for the certificate"

  # 7. .debug is signed content and must survive all the way to the payload.
  $missingDebugPayload = New-GatePayload -Name "payload-missing-debug" -OmitDebug
  $missingDebugResult = Invoke-VerifyRelease -PayloadRoot $missingDebugPayload.PayloadRoot -TrustedCertPath $trustedCertPath -CepVerifierScript $validVerifierPath
  Assert-True ($missingDebugResult.ExitCode -ne 0) "a payload without .debug must fail verification"
  Assert-True ($missingDebugResult.Output -match "\.debug") "the missing-debug failure must name the entry"

  # 8. Production packages keep signed .debug metadata but never source maps.
  $sourceMapPayload = New-GatePayload -Name "payload-source-map" -IncludeSourceMap
  $sourceMapResult = Invoke-VerifyRelease -PayloadRoot $sourceMapPayload.PayloadRoot -TrustedCertPath $trustedCertPath -CepVerifierScript $validVerifierPath
  Assert-True ($sourceMapResult.ExitCode -ne 0) "a payload containing a source map must fail verification"
  Assert-True ($sourceMapResult.Output -match "forbidden source-map entry") "the source-map failure must name the problem"
  Assert-True ($sourceMapResult.Output -match "bundle\.JS\.MAP") "source-map matching must be case-insensitive after path normalization"

  # 9. The shared cryptographic verifier must positively attest success. Both
  #    a nonzero result and a zero result without its stable marker fail closed.
  $rejectedResult = Invoke-VerifyRelease -PayloadRoot $trustedPayload.PayloadRoot -TrustedCertPath $trustedCertPath -CepVerifierScript $rejectedVerifierPath
  Assert-True ($rejectedResult.ExitCode -ne 0) "a cryptographically rejected signature or timestamp must fail release verification"
  Assert-True ($rejectedResult.Output -match "cryptographic verification failed") "the verifier rejection must name the failed cryptographic gate"
  Assert-True ($rejectedResult.Output -match "mock RFC3161 rejection") "the verifier diagnostic must be preserved"

  $missingMarkerResult = Invoke-VerifyRelease -PayloadRoot $trustedPayload.PayloadRoot -TrustedCertPath $trustedCertPath -CepVerifierScript $missingMarkerVerifierPath
  Assert-True ($missingMarkerResult.ExitCode -ne 0) "a verifier that exits zero without attesting success must fail closed"
  Assert-True ($missingMarkerResult.Output -match "without its success marker") "the missing-marker failure must name the problem"

  # 10. An unavailable shared verifier also fails closed.
  $missingVerifierResult = Invoke-VerifyRelease -PayloadRoot $trustedPayload.PayloadRoot -TrustedCertPath $trustedCertPath -CepVerifierScript (Join-Path $testRoot "missing-verifier.mjs")
  Assert-True ($missingVerifierResult.ExitCode -ne 0) "release verification must require the shared CEP verifier"
  Assert-True ($missingVerifierResult.Output -match "CEP ZXP verifier not found") "the missing-verifier failure must name the dependency"

  Write-Host "Release gate tests passed."
} finally {
  $testRootFull = Get-FullPath $testRoot
  $testParentFull = Get-FullPath $testParent
  Assert-PathInside -Path $testRootFull -Parent $testParentFull -Label "release gate test root"
  Remove-PathSafe -Path $testRootFull -AllowedParent $testParentFull -Label "release gate test root"
  Remove-DirectoryIfEmptySafe -Path $testParentFull -AllowedParent ([System.IO.Path]::GetTempPath()) -Label "release gate test parent" | Out-Null
}
