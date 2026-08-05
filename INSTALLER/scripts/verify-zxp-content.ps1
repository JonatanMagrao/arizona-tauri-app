[CmdletBinding(DefaultParameterSetName = "Zxp")]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "Zxp")]
  [string]$ZxpPath,

  [Parameter(Mandatory = $true, ParameterSetName = "Directory")]
  [string]$Directory,

  [string]$TrustedCertPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. "$PSScriptRoot\common.ps1"

try {
  $verification = if ($PSCmdlet.ParameterSetName -eq "Directory") {
    Assert-CepDirectoryContentSignature -Directory $Directory
  } else {
    Assert-ZxpContentSignature -Path $ZxpPath
  }

  if (![string]::IsNullOrWhiteSpace($TrustedCertPath)) {
    $trusted = @(Get-TrustedCepCertificateFingerprints (Get-FullPath $TrustedCertPath))
    if ($trusted.Count -eq 0 -or
        $trusted -notcontains [string]$verification.CertificateFingerprint) {
      throw "CEP content is not signed by a pinned Arizona certificate ($($verification.CertificateFingerprint))."
    }
  }

  Write-Host "CEP content signature verified: $($verification.CertificateFingerprint)"
  exit 0
} catch {
  Write-Error "CEP content signature verification failed: $($_.Exception.Message)"
  exit 1
}
