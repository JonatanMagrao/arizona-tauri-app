param(
  [string]$Configuration = "Release",
  [string]$Platform = "x64",
  [string]$SdkRoot = ""
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

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (!(Test-Path -LiteralPath $vswhere)) {
  throw "vswhere.exe was not found. Install Visual Studio 2022 Build Tools."
}

$msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\amd64\MSBuild.exe | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($msbuild)) {
  throw "MSBuild.exe was not found. Install Visual Studio 2022 Build Tools."
}

$env:AE_SDK_ROOT = $SdkRoot
& $msbuild "$PSScriptRoot\ArizonaBridgeTest.vcxproj" /p:Configuration=$Configuration /p:Platform=$Platform /m
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
