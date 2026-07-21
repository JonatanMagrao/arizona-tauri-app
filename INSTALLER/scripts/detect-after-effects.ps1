param(
  [switch]$Json
)

. "$PSScriptRoot\common.ps1"

function Get-AdobeRoots {
  $roots = @()
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

$installations = foreach ($adobeRoot in Get-AdobeRoots) {
  Get-ChildItem -LiteralPath $adobeRoot -Directory -Filter "Adobe After Effects *" -ErrorAction SilentlyContinue |
    ForEach-Object {
      $supportFiles = Join-Path $_.FullName "Support Files"
      $afterFx = Join-Path $supportFiles "AfterFX.exe"
      if (Test-Path -LiteralPath $afterFx -PathType Leaf) {
        $version = ""
        if ($_.Name -match "Adobe After Effects\s+(.+)$") {
          $version = $Matches[1]
        }

        $pluginDir = Join-Path $supportFiles "Plug-ins\Arizona"
        [pscustomobject]@{
          name = $_.Name
          version = $version
          root = $_.FullName
          supportFiles = $supportFiles
          afterFx = $afterFx
          pluginDir = $pluginDir
          pluginPath = Join-Path $pluginDir "ArizonaBridgeTest.aex"
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
