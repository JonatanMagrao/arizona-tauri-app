$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $repoRoot "INSTALLER\scripts\common.ps1")
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

function Assert-Rejected {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Operation,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $rejected = $false
  try {
    & $Operation | Out-Null
  } catch {
    $rejected = $true
  }
  Assert-True $rejected $Message
}

$testParent = Join-Path ([System.IO.Path]::GetTempPath()) "ArizonaContentSignatureTests"
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  $valid = New-SyntheticZxp -Path (Join-Path $testRoot "valid.zxp")
  $verification = Assert-ZxpContentSignature -Path $valid.Path
  Assert-True ($verification.CertificateFingerprint -ceq $valid.CertificateFingerprint) `
    "a real XML signature from the ephemeral test certificate should pass"

  $validDirectory = Join-Path $testRoot "valid-directory"
  Expand-ZipToDirectory -Path $valid.Path -Destination $validDirectory
  $directoryVerification = Assert-CepDirectoryContentSignature -Directory $validDirectory
  Assert-True ($directoryVerification.CertificateFingerprint -ceq $valid.CertificateFingerprint) `
    "the extracted signed tree should pass the same verification"
  Assert-True (Test-CepVerifiedContentEqual -Left $verification -Right $directoryVerification) `
    "verified archive and extracted tree should have the same signed file identity"

  $reissued = New-SyntheticZxp -Path (Join-Path $testRoot "reissued.zxp") -ReverseSignedEntries
  $reissuedVerification = Assert-ZxpContentSignature -Path $reissued.Path
  Assert-True ($reissued.Sha256 -cne $valid.Sha256) `
    "the reordered signed manifest must produce a different signature envelope"
  Assert-True (Test-CepVerifiedContentEqual -Left $verification -Right $reissuedVerification) `
    "content equality must ignore signature envelope bytes and reference order"

  $changed = New-SyntheticZxp -Path (Join-Path $testRoot "changed.zxp") -IndexContent "correction"
  $changedVerification = Assert-ZxpContentSignature -Path $changed.Path
  Assert-True (!(Test-CepVerifiedContentEqual -Left $verification -Right $changedVerification)) `
    "different verified digests must prevent same-version preservation"

  $extra = New-SyntheticZxp -Path (Join-Path $testRoot "extra.zxp") -ExtraSignedFiles @{ "main/new.js" = "new" }
  $extraVerification = Assert-ZxpContentSignature -Path $extra.Path
  Assert-True (!(Test-CepVerifiedContentEqual -Left $verification -Right $extraVerification)) `
    "adding a signed file must change content identity"
  Assert-True (!(Test-CepVerifiedContentEqual -Left $extraVerification -Right $verification)) `
    "removing a signed file must change content identity"
  $renamed = New-SyntheticZxp -Path (Join-Path $testRoot "renamed.zxp") -ExtraSignedFiles @{ "main/renamed.js" = "new" }
  $renamedVerification = Assert-ZxpContentSignature -Path $renamed.Path
  Assert-True (!(Test-CepVerifiedContentEqual -Left $extraVerification -Right $renamedVerification)) `
    "equal digest sets with different signed paths must not be treated as identical"

  $invalidSignature = New-SyntheticZxp `
    -Path (Join-Path $testRoot "invalid-signature.zxp") `
    -TamperSignatureValue
  Assert-Rejected { Assert-ZxpContentSignature -Path $invalidSignature.Path } `
    "copying the pinned public certificate without its private-key signature must fail"

  $invalidDigest = New-SyntheticZxp `
    -Path (Join-Path $testRoot "invalid-content-digest.zxp") `
    -TamperContentAfterSigning
  Assert-Rejected { Assert-ZxpContentSignature -Path $invalidDigest.Path } `
    "content changed after signing must fail its PackageContents digest"

  $uncoveredFile = New-SyntheticZxp `
    -Path (Join-Path $testRoot "uncovered-file.zxp") `
    -AddUnsignedFileAfterSigning
  Assert-Rejected { Assert-ZxpContentSignature -Path $uncoveredFile.Path } `
    "every file except META-INF/signatures.xml must be covered exactly"

  Set-Content -LiteralPath (Join-Path $validDirectory "main\index.html") -Value "tampered" -Encoding UTF8
  Assert-Rejected { Assert-CepDirectoryContentSignature -Directory $validDirectory } `
    "the staging-tree verifier must reject a changed extracted file"

  Write-Host "CEP content-signature tests passed."
} finally {
  $testRootFull = Get-FullPath $testRoot
  $testParentFull = Get-FullPath $testParent
  Assert-PathInside -Path $testRootFull -Parent $testParentFull -Label "content signature test root"
  Remove-PathSafe -Path $testRootFull -AllowedParent $testParentFull -Label "content signature test root"
  Remove-DirectoryIfEmptySafe -Path $testParentFull -AllowedParent ([System.IO.Path]::GetTempPath()) -Label "content signature test parent" | Out-Null
}
