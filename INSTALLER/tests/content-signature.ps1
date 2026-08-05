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
