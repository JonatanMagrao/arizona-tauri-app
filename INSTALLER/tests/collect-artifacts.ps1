$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$collectScript = Join-Path $repoRoot "INSTALLER\scripts\collect-artifacts.ps1"
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

function Assert-CollectRejected {
  param(
    [Parameter(Mandatory = $true)][string]$FakeRepo,
    [Parameter(Mandatory = $true)][string]$PayloadRoot,
    [Parameter(Mandatory = $true)][string]$ZxpPath,
    [Parameter(Mandatory = $true)][string]$Message
  )

  $rejected = $false
  try {
    & $collectScript -RepoRoot $FakeRepo -PayloadRoot $PayloadRoot -ZxpPath $ZxpPath
  } catch {
    $rejected = $true
  }
  Assert-True $rejected $Message
}

$testParent = Join-Path ([System.IO.Path]::GetTempPath()) "ArizonaCollectArtifactTests"
$testRoot = Join-Path $testParent ([guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
  $fakeRepo = Join-Path $testRoot "repo"
  $payloadRoot = Join-Path $fakeRepo "INSTALLER\payload"
  $extensionVersion = "0.1.0"
  $appVersion = "2.2.0"
  New-Item -ItemType Directory -Force -Path `
    (Join-Path $fakeRepo "ARIZONA-EXTENSION"), `
    (Join-Path $fakeRepo "src-tauri"), `
    (Join-Path $fakeRepo "dist-cep"), `
    $payloadRoot | Out-Null

  Write-JsonFileAtomic -Path (Join-Path $fakeRepo "package.json") -Value ([pscustomobject]@{
    version = $appVersion
  })
  Write-JsonFileAtomic -Path (Join-Path $fakeRepo "ARIZONA-EXTENSION\package.json") -Value ([pscustomobject]@{
    version = $extensionVersion
  })
  Write-JsonFileAtomic -Path (Join-Path $fakeRepo "src-tauri\tauri.conf.json") -Value ([pscustomobject]@{
    version = $appVersion
  })

  New-Item -ItemType Directory -Force -Path (Join-Path $payloadRoot "cep") | Out-Null
  $marker = Join-Path $payloadRoot "cep\preserve-before-validation.txt"
  Set-Content -LiteralPath $marker -Value "keep" -Encoding UTF8

  $staleAppArtifact = Join-Path $fakeRepo "dist-cep\arizona-cep-v$appVersion.zxp"
  New-SyntheticZxp -Path $staleAppArtifact -BundleVersion $appVersion | Out-Null
  Assert-CollectRejected `
    -FakeRepo $fakeRepo `
    -PayloadRoot $payloadRoot `
    -ZxpPath $staleAppArtifact `
    -Message "collect must never accept the desktop app-version artifact"
  Assert-True (Test-Path -LiteralPath $marker -PathType Leaf) `
    "rejecting a stale artifact must happen before mutating the existing payload"

  $expectedArtifact = Join-Path $fakeRepo "dist-cep\arizona-cep-v$extensionVersion.zxp"
  New-SyntheticZxp -Path $expectedArtifact -BundleVersion "0.0.9" | Out-Null
  Assert-CollectRejected `
    -FakeRepo $fakeRepo `
    -PayloadRoot $payloadRoot `
    -ZxpPath $expectedArtifact `
    -Message "the exact filename must still be rejected when its bundle version is stale"
  Assert-True (Test-Path -LiteralPath $marker -PathType Leaf) `
    "rejecting a bundle-version mismatch must happen before mutating the payload"

  $validArtifact = New-SyntheticZxp `
    -Path $expectedArtifact `
    -BundleVersion $extensionVersion
  & $collectScript `
    -RepoRoot $fakeRepo `
    -PayloadRoot $payloadRoot `
    -ZxpPath $expectedArtifact

  $collectedZxp = Join-Path $payloadRoot "cep\com.arizona-carrefour.cep.zxp"
  $manifestPath = Join-Path $payloadRoot "release-manifest.json"
  Assert-True (Test-Path -LiteralPath $collectedZxp -PathType Leaf) `
    "the unique extension-version artifact should be collected"
  Assert-True (Test-Path -LiteralPath $manifestPath -PathType Leaf) `
    "collection should write release-manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  Assert-True ([string]$manifest.cepBundleVersion -ceq $extensionVersion) `
    "release manifest bundle version must come from the matching CEP package"
  Assert-True ((Get-FileSha256 $collectedZxp) -eq $validArtifact.Sha256) `
    "collection must copy the selected ZXP byte for byte"
  Assert-True (!(Test-Path -LiteralPath $marker)) `
    "a successful collection should replace the old generated payload"

  Write-Host "Artifact collection regression tests passed."
} finally {
  $testRootFull = Get-FullPath $testRoot
  $testParentFull = Get-FullPath $testParent
  Assert-PathInside -Path $testRootFull -Parent $testParentFull -Label "artifact collection test root"
  Remove-PathSafe -Path $testRootFull -AllowedParent $testParentFull -Label "artifact collection test root"
  Remove-DirectoryIfEmptySafe -Path $testParentFull -AllowedParent ([System.IO.Path]::GetTempPath()) -Label "artifact collection test parent" | Out-Null
}
