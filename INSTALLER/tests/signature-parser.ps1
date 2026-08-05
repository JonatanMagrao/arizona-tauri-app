$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $repoRoot "INSTALLER\scripts\common.ps1")

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (!$Condition) {
    throw "Assertion failed: $Message"
  }
}

$fixturePath = Join-Path $repoRoot "scripts\fixtures\cep-signature-cases.json"
if (!(Test-Path -LiteralPath $fixturePath -PathType Leaf)) {
  throw "Shared CEP signature fixture not found: $fixturePath"
}
$fixture = Get-Content -LiteralPath $fixturePath -Raw | ConvertFrom-Json
Assert-True ([int]$fixture.schemaVersion -eq 1) "shared signature fixture schema must be 1"

foreach ($case in @($fixture.cases)) {
  $caseId = [string]$case.id
  $accepted = $false
  $fingerprint = ""
  try {
    $fingerprint = Get-CepSigningCertificateFingerprintFromXml `
      -Xml ([string]$case.xml) `
      -Label "fixture $caseId"
    $accepted = $true
  } catch {
    $accepted = $false
  }

  Assert-True ($accepted -eq [bool]$case.shouldPass) `
    "PowerShell parser result for $caseId must match the shared fixture"
  if ($accepted) {
    Assert-True ($fingerprint -ceq [string]$case.expectedSha256) `
      "PowerShell fingerprint for $caseId must match the shared fixture"
  }
}

# XmlResolver is null and DTD processing is prohibited even for otherwise
# structurally valid input.
$dtdXml = @"
<!DOCTYPE signatures [<!ENTITY cert "AQIDBA==">]>
<signatures><Signature><KeyInfo><X509Data><X509Certificate>&cert;</X509Certificate></X509Data></KeyInfo></Signature></signatures>
"@
$dtdRejected = $false
try {
  Get-CepSigningCertificateFingerprintFromXml -Xml $dtdXml -Label "DTD fixture" | Out-Null
} catch {
  $dtdRejected = $true
}
Assert-True $dtdRejected "signature XML containing a DTD must be rejected"

Write-Host "PowerShell CEP signature parser tests passed."
