param(
  [string]$RepoRoot = "",
  [string]$ExePath = "",
  [string]$CertificateThumbprint = $env:ARIZONA_SIGNING_CERT_SHA1,
  [string]$TimestampUrl = $env:ARIZONA_SIGNING_TIMESTAMP_URL
)

. "$PSScriptRoot\common.ps1"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = Get-FullPath (Join-Path $PSScriptRoot "..\..")
}

if ([string]::IsNullOrWhiteSpace($ExePath)) {
  $ExePath = Join-Path $RepoRoot "src-tauri\target\release\arizona-app.exe"
}

if (!(Test-Path -LiteralPath $ExePath -PathType Leaf)) {
  throw "Tauri release exe not found: $ExePath"
}

if ([string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
  throw "ARIZONA_SIGNING_CERT_SHA1 is required to sign the Tauri executable."
}

if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
  $TimestampUrl = "http://timestamp.digicert.com"
}

$signtool = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
if (!$signtool) {
  throw "signtool.exe was not found in PATH. Install Windows SDK or configure PATH."
}

& $signtool.Source sign /fd SHA256 /tr $TimestampUrl /td SHA256 /sha1 $CertificateThumbprint $ExePath
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$signature = Get-AuthenticodeSignature -LiteralPath $ExePath
if ($signature.Status -ne "Valid") {
  throw "Signature is not valid after signing: $ExePath"
}

$certHash = $signature.SignerCertificate.GetCertHashString("SHA256")
Write-Host $certHash
