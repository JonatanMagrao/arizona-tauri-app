param(
  [switch]$Json,
  [string[]]$AdobeRoots = @(),
  [switch]$IncludeArizonaPluginOnly
)

. "$PSScriptRoot\common.ps1"

function Get-AdobeRoots {
  param([string[]]$RequestedRoots = @())

  $roots = @()
  if ($RequestedRoots.Count -gt 0) {
    foreach ($root in $RequestedRoots) {
      if ([string]::IsNullOrWhiteSpace($root)) {
        continue
      }

      $fullRoot = Get-FullPath $root
      if ((Test-Path -LiteralPath $fullRoot -PathType Container) -and !($roots -contains $fullRoot)) {
        $roots += $fullRoot
      }
    }
    return $roots
  }

  $programFiles = [Environment]::GetFolderPath("ProgramFiles")
  $programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")

  foreach ($root in @($programFiles, $programFilesX86)) {
    if ([string]::IsNullOrWhiteSpace($root)) {
      continue
    }

    $adobeRoot = Join-Path $root "Adobe"
    if ((Test-Path -LiteralPath $adobeRoot -PathType Container) -and !($roots -contains $adobeRoot)) {
      $roots += $adobeRoot
    }
  }

  return $roots
}

$installations = foreach ($adobeRoot in Get-AdobeRoots -RequestedRoots $AdobeRoots) {
  Get-ChildItem -LiteralPath $adobeRoot -Directory -Filter "Adobe After Effects *" -ErrorAction SilentlyContinue |
    ForEach-Object {
      $supportFiles = Join-Path $_.FullName "Support Files"
      $afterFx = Join-Path $supportFiles "AfterFX.exe"
      $pluginDir = Join-Path $supportFiles "Plug-ins\Arizona"
      $pluginPath = Join-Path $pluginDir "ArizonaBridgeTest.aex"
      $afterFxPresent = Test-Path -LiteralPath $afterFx -PathType Leaf
      $pluginPresent = Test-Path -LiteralPath $pluginPath -PathType Leaf

      if ($afterFxPresent -or ($IncludeArizonaPluginOnly -and $pluginPresent)) {
        $version = ""
        if ($_.Name -match "Adobe After Effects\s+(.+)$") {
          $version = $Matches[1]
        }

        [pscustomobject]@{
          name = $_.Name
          version = $version
          root = $_.FullName
          supportFiles = $supportFiles
          afterFx = $afterFx
          afterFxPresent = $afterFxPresent
          pluginDir = $pluginDir
          pluginPath = $pluginPath
          pluginPresent = $pluginPresent
        }
      }
    }
}

$installations = @($installations | Sort-Object root -Unique)

if ($Json) {
  $installations | ConvertTo-Json -Depth 4
} else {
  $installations | Format-Table -AutoSize
}
