$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$commonScript = Join-Path $repoRoot "INSTALLER\scripts\common.ps1"
. $commonScript

$makensisCandidates = @(
  (Join-Path $env:LOCALAPPDATA "tauri\NSIS\makensis.exe"),
  (Join-Path $env:LOCALAPPDATA "tauri\NSIS\Bin\makensis.exe")
)
$makensis = $makensisCandidates |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($makensis)) {
  throw "Tauri NSIS compiler was not found under LOCALAPPDATA."
}

$testParent = Join-Path ([System.IO.Path]::GetTempPath()) "ArizonaNsisHookTests"
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString("N"))
$outputPath = Join-Path $testRoot "nsis-hooks-test.exe"
$fixturePath = Join-Path $PSScriptRoot "nsis-hooks-compile.nsi"
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  $compilerOutput = & $makensis "/DOUTPUT_PATH=$outputPath" "/V2" $fixturePath 2>&1
  if ($LASTEXITCODE -ne 0) {
    $compilerOutput | ForEach-Object { Write-Host $_ }
    throw "NSIS hook compile test failed with exit code $LASTEXITCODE."
  }

  if (!(Test-Path -LiteralPath $outputPath -PathType Leaf)) {
    throw "NSIS hook compile test did not produce its validation executable."
  }

  Write-Host "NSIS hook compile test passed."
} finally {
  $testRootFull = Get-FullPath $testRoot
  $testParentFull = Get-FullPath $testParent
  Assert-PathInside -Path $testRootFull -Parent $testParentFull -Label "NSIS hook test root"
  Remove-PathSafe -Path $testRootFull -AllowedParent $testParentFull -Label "NSIS hook test root"
  Remove-DirectoryIfEmptySafe -Path $testParentFull -AllowedParent ([System.IO.Path]::GetTempPath()) -Label "NSIS hook test parent" | Out-Null
}
