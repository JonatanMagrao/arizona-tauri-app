param(
  [switch]$SkipAex,
  [switch]$SkipInstallerBuild
)

. "$PSScriptRoot\common.ps1"

$repoRoot = Get-FullPath (Join-Path $PSScriptRoot "..\..")

function Invoke-RepoCommand {
  param([Parameter(Mandatory = $true)][string[]]$Command)

  Push-Location $repoRoot
  try {
    & $Command[0] $Command[1..($Command.Length - 1)]
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  } finally {
    Pop-Location
  }
}

Invoke-RepoCommand @("npm", "run", "license:check")
Invoke-RepoCommand @("npm", "run", "release:cep")

if (!$SkipAex) {
  & "$PSScriptRoot\build-aex-release.ps1" -RepoRoot $repoRoot
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

& "$PSScriptRoot\collect-artifacts.ps1" -RepoRoot $repoRoot
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& "$PSScriptRoot\verify-release.ps1" -RequirePayload
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if (!$SkipInstallerBuild) {
  Invoke-RepoCommand @("npm", "run", "tauri:build")
}
