param(
  [Parameter(Mandatory = $true)][string]$ZxpPath,
  [Parameter(Mandatory = $true)][string]$ExpectedSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$TargetPath,
  [switch]$AllowDowngrade
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'cep-system-update-core.ps1')

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  try {
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } finally { $identity.Dispose() }

  if (!$elevated) {
    # Encode data into a literal invocation instead of concatenating untrusted
    # filenames into a command line. No path can become PowerShell syntax.
    $quote = { param([string]$Value) "'" + $Value.Replace("'", "''") + "'" }
    $invocation = '& ' + (& $quote $PSCommandPath) +
      ' -ZxpPath ' + (& $quote $ZxpPath) +
      ' -ExpectedSha256 ' + (& $quote $ExpectedSha256) +
      ' -ExpectedVersion ' + (& $quote $ExpectedVersion) +
      ' -TargetPath ' + (& $quote $TargetPath)
    if ($AllowDowngrade) { $invocation += ' -AllowDowngrade' }
    $invocation += '; exit $LASTEXITCODE'
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($invocation))
    $powershell = Join-Path $PSHOME 'powershell.exe'
    try {
      $child = Start-Process -FilePath $powershell -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -Verb RunAs -WindowStyle Hidden -PassThru -Wait
      exit ([int]$child.ExitCode)
    } catch {
      $failure = $_.Exception
      while ($null -ne $failure) {
        if ($failure -is [ComponentModel.Win32Exception] -and $failure.NativeErrorCode -eq 1223) { exit 1223 }
        $failure = $failure.InnerException
      }
      throw
    }
  }

  Invoke-CepSystemUpdate -ZxpPath $ZxpPath -ExpectedSha256 $ExpectedSha256 -ExpectedVersion $ExpectedVersion -TargetPath $TargetPath -AllowDowngrade:$AllowDowngrade
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  if ($_.Exception.Data.Contains('CepExitCode')) { exit ([int]$_.Exception.Data['CepExitCode']) }
  exit 1
}
