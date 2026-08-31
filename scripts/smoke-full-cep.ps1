param(
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
} else {
  $RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
}

function Assert-Smoke {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if (!$Condition) {
    throw $Message
  }
}

function Stop-SmokeAfterEffects {
  $processes = @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue)
  foreach ($process in $processes) {
    [void]$process.CloseMainWindow()
  }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and
      @(Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue).Count -gt 0) {
    Start-Sleep -Milliseconds 250
  }
  Get-Process -Name "AfterFX" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Invoke-SmokeUninstall {
  param([Parameter(Mandatory = $true)][string]$InstallDir)

  $uninstaller = Join-Path $InstallDir "uninstall.exe"
  if (!(Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    return
  }
  $arguments = '/S /UPDATE "_?={0}"' -f $InstallDir
  $process = Start-Process `
    -FilePath $uninstaller `
    -ArgumentList $arguments `
    -Verb RunAs `
    -Wait `
    -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Smoke rollback uninstaller failed with exit code $($process.ExitCode)."
  }
}

$tauriConfig = Get-Content -LiteralPath (Join-Path $RepoRoot "src-tauri\tauri.conf.json") -Raw |
  ConvertFrom-Json
$appVersion = [string]$tauriConfig.version
$productName = [string]$tauriConfig.productName
$setupName = "{0}_{1}_x64-setup.exe" -f $productName, $appVersion
$setupPath = Join-Path $RepoRoot "src-tauri\target\release\bundle\nsis\$setupName"
$afterEffectsPath = "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe"
$jsxPath = Join-Path $RepoRoot "scripts\cep-smoke-after-effects.jsx"
$installDir = Join-Path $env:ProgramFiles "arizona-app"
$systemCommonFiles = if (![string]::IsNullOrWhiteSpace($env:CommonProgramW6432)) {
  $env:CommonProgramW6432
} else {
  $env:CommonProgramFiles
}
$systemCep = Join-Path $systemCommonFiles "Adobe\CEP\extensions\com.arizona-carrefour.cep"
$userCep = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.arizona-carrefour.cep"
$expectedDevTarget = Join-Path $RepoRoot "ARIZONA-EXTENSION\dist\cep"
$debugKey = "HKCU:\Software\Adobe\CSXS.12"
$debugName = "PlayerDebugMode"
$smokeRoot = Join-Path $env:LOCALAPPDATA `
  ("Arizona Smoke\{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), [guid]::NewGuid().ToString("N"))
$parkedJunction = Join-Path $smokeRoot "com.arizona-carrefour.cep.dev-junction"
$proofPath = Join-Path $smokeRoot "ae-menu-proof.txt"
$screenshotPath = Join-Path $smokeRoot "after-effects-arizona-panel.png"

$junctionParked = $false
$fullInstalled = $false
$debugKeyItem = Get-Item -LiteralPath $debugKey -ErrorAction SilentlyContinue
$debugExisted = $null -ne $debugKeyItem -and
  $debugKeyItem.GetValueNames() -contains $debugName
$debugValue = if ($debugExisted) {
  $debugKeyItem.GetValue($debugName, $null, "DoNotExpandEnvironmentNames")
} else {
  $null
}
$debugKind = if ($debugExisted) {
  [string]$debugKeyItem.GetValueKind($debugName)
} else {
  ""
}

New-Item -ItemType Directory -Path $smokeRoot | Out-Null

try {
  Assert-Smoke (Test-Path -LiteralPath $setupPath -PathType Leaf) `
    "Full setup $appVersion not found: $setupPath"
  Assert-Smoke (Test-Path -LiteralPath $afterEffectsPath -PathType Leaf) `
    "After Effects 2026 not found: $afterEffectsPath"
  Assert-Smoke (Test-Path -LiteralPath $jsxPath -PathType Leaf) `
    "After Effects smoke JSX not found: $jsxPath"
  Assert-Smoke (!(Test-Path -LiteralPath $systemCep)) `
    "System CEP already exists; refusing to overwrite an installation outside this smoke: $systemCep"
  Assert-Smoke (!(Test-Path -LiteralPath $installDir)) `
    "Arizona is already installed; refusing to replace it during smoke: $installDir"

  $openProcesses = @(Get-Process -Name "AfterFX", "CEPHtmlEngine", "arizona-app" -ErrorAction SilentlyContinue)
  Assert-Smoke ($openProcesses.Count -eq 0) `
    "Close After Effects, CEPHtmlEngine and Arizona before running this smoke."

  $userItem = Get-Item -LiteralPath $userCep -Force -ErrorAction SilentlyContinue
  $devTarget = ""
  if ($null -ne $userItem) {
    $devTarget = [string](@($userItem.Target)[0])
    Assert-Smoke ($userItem.LinkType -eq "Junction") `
      "Per-user CEP is neither absent nor the expected development junction: $userCep"
    Assert-Smoke (
      [System.IO.Path]::GetFullPath($devTarget).Equals(
        [System.IO.Path]::GetFullPath($expectedDevTarget),
        [System.StringComparison]::OrdinalIgnoreCase
      )
    ) "Development junction points to an unexpected target: $devTarget"
  }

  [pscustomobject]@{
    repoRoot = $RepoRoot
    setupPath = $setupPath
    userCep = $userCep
    devTarget = $devTarget
    systemCep = $systemCep
    debugExisted = $debugExisted
    debugValue = [string]$debugValue
    debugKind = $debugKind
  } | ConvertTo-Json -Depth 3 |
    Set-Content -LiteralPath (Join-Path $smokeRoot "before.json") -Encoding UTF8

  if ($null -ne $userItem) {
    [System.IO.Directory]::Move($userCep, $parkedJunction)
    $junctionParked = $true
    Assert-Smoke (!(Test-Path -LiteralPath $userCep)) `
      "Development junction remained in Adobe's scanned per-user directory."
    Assert-Smoke ((Get-Item -LiteralPath $parkedJunction -Force).LinkType -eq "Junction") `
      "Parked development path is no longer a junction."
    Assert-Smoke (Test-Path -LiteralPath (Join-Path $expectedDevTarget "CSXS\manifest.xml") -PathType Leaf) `
      "Parking the junction affected its repository target."
  }

  if ($debugExisted) {
    Remove-ItemProperty -LiteralPath $debugKey -Name $debugName
  }
  $debugKeyAfter = Get-Item -LiteralPath $debugKey -ErrorAction SilentlyContinue
  Assert-Smoke (
    $null -eq $debugKeyAfter -or
    $debugKeyAfter.GetValueNames() -notcontains $debugName
  ) "PlayerDebugMode is still enabled for CSXS.12."

  $installer = Start-Process `
    -FilePath $setupPath `
    -ArgumentList "/S" `
    -Verb RunAs `
    -Wait `
    -PassThru
  Assert-Smoke ($installer.ExitCode -eq 0) `
    "Full installer failed with exit code $($installer.ExitCode)."
  $fullInstalled = $true

  Assert-Smoke (Test-Path -LiteralPath $installDir -PathType Container) `
    "Full installer did not create $installDir."
  Assert-Smoke (Test-Path -LiteralPath $systemCep -PathType Container) `
    "Full installer did not create the system CEP tree: $systemCep"
  $systemCepItem = Get-Item -LiteralPath $systemCep -Force
  Assert-Smoke (($systemCepItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) `
    "Installed system CEP is unexpectedly a reparse point."
  Assert-Smoke (!(Test-Path -LiteralPath $userCep)) `
    "Full installer unexpectedly created a per-user CEP tree."

  $installedStatePath = Join-Path $installDir "installer\installed-assets.json"
  $installedState = Get-Content -LiteralPath $installedStatePath -Raw | ConvertFrom-Json
  Assert-Smoke ([int]$installedState.schemaVersion -eq 2) `
    "Installed assets state has an unexpected schema."
  Assert-Smoke (
    [System.IO.Path]::GetFullPath([string]$installedState.cep.path).Equals(
      [System.IO.Path]::GetFullPath($systemCep),
      [System.StringComparison]::OrdinalIgnoreCase
    )
  ) "Installed assets state points to an unexpected CEP path."

  $verifyScript = Join-Path $installDir "installer\scripts\verify-zxp-content.ps1"
  $trustedCertPath = Join-Path $installDir "installer\cep-trusted-cert.json"
  $verificationOutput = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -NoProfile `
    -NonInteractive `
    -ExecutionPolicy Bypass `
    -File $verifyScript `
    -Directory $systemCep `
    -TrustedCertPath $trustedCertPath 2>&1
  Assert-Smoke ($LASTEXITCODE -eq 0) `
    "Installed CEP cryptographic verifier failed: $($verificationOutput -join ' ')"
  $verificationText = ($verificationOutput | ForEach-Object { [string]$_ }) -join "`n"
  Assert-Smoke (
    $verificationText -match "CEP content signature verified: 64fc86ad828a9a6bb8554bbe164f2584cdac03ee88db82dc29ec3916749c9713"
  ) "Installed CEP verifier did not confirm the pinned Arizona identity."

  $debugKeyDuring = Get-Item -LiteralPath $debugKey -ErrorAction SilentlyContinue
  Assert-Smoke (
    $null -eq $debugKeyDuring -or
    $debugKeyDuring.GetValueNames() -notcontains $debugName
  ) "PlayerDebugMode was re-enabled before launching After Effects."

  $env:ARIZONA_SMOKE_ROOT = $smokeRoot.Replace("\", "/")
  $afterEffects = Start-Process -FilePath $afterEffectsPath -PassThru
  $windowDeadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    $afterEffects.Refresh()
  } while ((Get-Date) -lt $windowDeadline -and $afterEffects.MainWindowHandle -eq 0)
  Assert-Smoke ($afterEffects.MainWindowHandle -ne 0) `
    "After Effects did not expose its main window within 90 seconds."
  Start-Sleep -Seconds 10

  Start-Process `
    -FilePath $afterEffectsPath `
    -ArgumentList @("-r", ('"{0}"' -f $jsxPath)) |
    Out-Null
  $proofDeadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $proofDeadline -and !(Test-Path -LiteralPath $proofPath -PathType Leaf)) {
    Start-Sleep -Milliseconds 500
  }
  Assert-Smoke (Test-Path -LiteralPath $proofPath -PathType Leaf) `
    "After Effects did not write the CEP menu proof within 60 seconds."
  $proof = ConvertFrom-StringData (Get-Content -LiteralPath $proofPath -Raw)
  Assert-Smoke ([int]$proof.commandId -gt 0) `
    "After Effects did not register the Arizona - Carrefour menu command."
  Assert-Smoke ([string]$proof.executed -eq "true") `
    "After Effects registered but did not execute the Arizona CEP panel command: $($proof.error)"

  $cepDeadline = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 500
    $cepProcesses = @(Get-Process -Name "CEPHtmlEngine" -ErrorAction SilentlyContinue)
  } while ((Get-Date) -lt $cepDeadline -and $cepProcesses.Count -eq 0)
  Assert-Smoke ($cepProcesses.Count -gt 0) `
    "Arizona menu opened but no CEPHtmlEngine process appeared."

  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ArizonaSmokeWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
}
"@
  $afterEffects.Refresh()
  [void][ArizonaSmokeWindow]::ShowWindow($afterEffects.MainWindowHandle, 5)
  [void][ArizonaSmokeWindow]::SetForegroundWindow($afterEffects.MainWindowHandle)
  Start-Sleep -Seconds 2
  $rect = New-Object ArizonaSmokeWindow+RECT
  Assert-Smoke ([ArizonaSmokeWindow]::GetWindowRect($afterEffects.MainWindowHandle, [ref]$rect)) `
    "Could not measure the After Effects window for visual evidence."
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  Assert-Smoke ($width -gt 0 -and $height -gt 0) `
    "After Effects window has invalid dimensions."
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  $logsRoot = Join-Path $smokeRoot "logs"
  New-Item -ItemType Directory -Path $logsRoot | Out-Null
  Get-ChildItem -LiteralPath $env:TEMP -File -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -eq "CEP12-AEFT.log" -or
      $_.Name -like "CEPHtmlEngine12-AEFT-26.0-com.arizona-carrefour.cep.main*.log"
    } |
    Copy-Item -Destination $logsRoot -Force

  [pscustomobject]@{
    passed = $true
    smokeRoot = $smokeRoot
    setupSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupPath).Hash
    setupAuthenticode = [string](Get-AuthenticodeSignature -LiteralPath $setupPath).Status
    cepVerification = $verificationText
    commandId = [int]$proof.commandId
    commandExecuted = [string]$proof.executed
    cepHtmlEngineProcesses = $cepProcesses.Count
    screenshot = $screenshotPath
  } | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $smokeRoot "result.json") -Encoding UTF8

  Stop-SmokeAfterEffects
  Invoke-SmokeUninstall -InstallDir $installDir
  $fullInstalled = $false
  Assert-Smoke (!(Test-Path -LiteralPath $systemCep)) `
    "System CEP remained after smoke rollback uninstall."
} finally {
  Stop-SmokeAfterEffects

  if ($fullInstalled -or (Test-Path -LiteralPath (Join-Path $installDir "uninstall.exe"))) {
    try {
      Invoke-SmokeUninstall -InstallDir $installDir
      $fullInstalled = $false
    } catch {
      Write-Warning $_
    }
  }

  if ($debugExisted) {
    New-Item -ItemType Directory -Path $debugKey -Force | Out-Null
    New-ItemProperty `
      -LiteralPath $debugKey `
      -Name $debugName `
      -PropertyType $debugKind `
      -Value $debugValue `
      -Force | Out-Null
  } else {
    Remove-ItemProperty `
      -LiteralPath $debugKey `
      -Name $debugName `
      -ErrorAction SilentlyContinue
  }

  if ($junctionParked) {
    if (Test-Path -LiteralPath $systemCep) {
      Write-Warning "System CEP remains installed; development junction stays parked at $parkedJunction."
    } elseif (Test-Path -LiteralPath $userCep) {
      Write-Warning "Per-user CEP path is occupied; development junction stays parked at $parkedJunction."
    } elseif (Test-Path -LiteralPath $parkedJunction) {
      [System.IO.Directory]::Move($parkedJunction, $userCep)
      $junctionParked = $false
    }
  }

  Remove-Item Env:\ARIZONA_SMOKE_ROOT -ErrorAction SilentlyContinue
}

Write-Host "Full CEP smoke passed and the development environment was restored."
Write-Host "Evidence: $smokeRoot"
