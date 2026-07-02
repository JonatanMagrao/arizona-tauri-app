param(
  [string]$Configuration = "Release",
  [string]$Platform = "x64",
  [string]$SdkRoot = "",
  [string]$TauriCertSha256 = $env:ARIZONA_TAURI_CERT_SHA256,
  [string]$BridgePublicKeyX = $env:ARIZONA_AEX_JWT_ES256_PUBLIC_X,
  [string]$BridgePublicKeyY = $env:ARIZONA_AEX_JWT_ES256_PUBLIC_Y,
  [string]$BridgeKeyId = $env:ARIZONA_AEX_JWT_KID,
  [switch]$AllowDevBridge
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($SdkRoot)) {
  if (![string]::IsNullOrWhiteSpace($env:AE_SDK_ROOT)) {
    $SdkRoot = $env:AE_SDK_ROOT
  } else {
    $SdkRoot = Join-Path $PSScriptRoot "..\..\sdk\ae25.6_61.64bit.AfterEffectsSDK"
  }
}

$sdkHeader = Join-Path $SdkRoot "Examples\Headers\AE_GeneralPlug.h"
if (!(Test-Path -LiteralPath $sdkHeader)) {
  throw "Invalid AE SDK root: $SdkRoot"
}

function Assert-Hex {
  param(
    [string]$Name,
    [string]$Value,
    [int]$ExpectedLength
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Name is required."
  }

  $normalized = $Value -replace '[^0-9A-Fa-f]', ''
  if ($normalized.Length -ne $ExpectedLength -or $normalized -notmatch '^[0-9A-Fa-f]+$') {
    throw "$Name must be $ExpectedLength hex characters."
  }
}

$isRelease = $Configuration.Trim().Equals("Release", [StringComparison]::OrdinalIgnoreCase)
if ($isRelease) {
  Assert-Hex "ARIZONA_TAURI_CERT_SHA256" $TauriCertSha256 64
  Assert-Hex "ARIZONA_AEX_JWT_ES256_PUBLIC_X" $BridgePublicKeyX 64
  Assert-Hex "ARIZONA_AEX_JWT_ES256_PUBLIC_Y" $BridgePublicKeyY 64
  if ([string]::IsNullOrWhiteSpace($BridgeKeyId)) {
    throw "ARIZONA_AEX_JWT_KID is required for Release builds."
  }
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (!(Test-Path -LiteralPath $vswhere)) {
  throw "vswhere.exe was not found. Install Visual Studio 2022 Build Tools."
}

$msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\amd64\MSBuild.exe | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($msbuild)) {
  throw "MSBuild.exe was not found. Install Visual Studio 2022 Build Tools."
}

$env:AE_SDK_ROOT = $SdkRoot
$devFlag = if ($AllowDevBridge) { "1" } else { "0" }
& $msbuild "$PSScriptRoot\ArizonaBridgeTest.vcxproj" `
  /p:Configuration=$Configuration `
  /p:Platform=$Platform `
  /p:ARIZONA_TAURI_CERT_SHA256="$TauriCertSha256" `
  /p:ARIZONA_AEX_JWT_ES256_PUBLIC_X="$BridgePublicKeyX" `
  /p:ARIZONA_AEX_JWT_ES256_PUBLIC_Y="$BridgePublicKeyY" `
  /p:ARIZONA_AEX_JWT_KID="$BridgeKeyId" `
  /p:ARIZONA_ALLOW_DEV_AEX_TOKEN="$devFlag" `
  /p:ARIZONA_ALLOW_DEV_AEX_CLIENT="$devFlag" `
  /m
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
