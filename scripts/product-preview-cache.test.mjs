import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("../src-tauri/src/product_preview_cache.ps1", import.meta.url));
const windowsOnly = { skip: process.platform !== "win32" && "Requires Windows System.Drawing" };

// Synthetic transparent pixels deliberately contain visible RGB data underneath.
const harness = String.raw`
param([string]$FixtureRoot, [string]$HelperPath, [int]$Width, [int]$Height, [switch]$Existing)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System.Drawing;
using System.Drawing.Imaging;
public static class PreviewFixture {
  public static void Save(string path, int width, int height) {
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
          var color = Color.FromArgb(0, 240, 20, 180);
          if (x < width / 4 && y < height / 4) color = Color.FromArgb(255, 220, 40, 20);
          if (x >= width * 3 / 4 && y < height / 4) color = Color.FromArgb(255, 20, 180, 40);
          if (x < width / 4 && y >= height * 3 / 4) color = Color.FromArgb(255, 20, 40, 220);
          if (x >= width * 3 / 4 && y >= height * 3 / 4) color = Color.FromArgb(128, 220, 120, 30);
          bitmap.SetPixel(x, y, color);
        }
      }
      bitmap.Save(path, ImageFormat.Png);
    }
  }
}
"@
function Read-Preview([string]$ImagePath) {
  $bitmap = [System.Drawing.Bitmap]::new($ImagePath)
  try {
    $pixels = @()
    foreach ($point in @(@(0.125, 0.125), @(0.875, 0.125), @(0.125, 0.875), @(0.875, 0.875), @(0.5, 0.5))) {
      $pixel = $bitmap.GetPixel([int][Math]::Floor($bitmap.Width * $point[0]), [int][Math]::Floor($bitmap.Height * $point[1]))
      $pixels += ,@([int]$pixel.A, [int]$pixel.R, [int]$pixel.G, [int]$pixel.B)
    }
    return @{ width = $bitmap.Width; height = $bitmap.Height; pixels = $pixels }
  } finally {
    $bitmap.Dispose()
  }
}
$inputPath = Join-Path $FixtureRoot 'source.PNG'
$outputPath = Join-Path $FixtureRoot 'preview.png'
$tasksPath = Join-Path $FixtureRoot 'tasks.json'
[PreviewFixture]::Save($inputPath, $Width, $Height)
$sourceHash = (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash
$source = Read-Preview $inputPath
$beforeOutputHash = $null
$beforeOutputTime = $null
if ($Existing) {
  Copy-Item -LiteralPath $inputPath -Destination $outputPath
  [System.IO.File]::SetLastWriteTimeUtc($outputPath, [DateTime]::new(2020, 1, 1))
  $beforeOutputHash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
  $beforeOutputTime = [System.IO.File]::GetLastWriteTimeUtc($outputPath).Ticks.ToString()
}
$tasks = ConvertTo-Json -InputObject @(@{ inputPath = $inputPath; outputPath = $outputPath; size = 512 })
[System.IO.File]::WriteAllText($tasksPath, $tasks, [System.Text.UTF8Encoding]::new($false))
& $HelperPath -TasksPath $tasksPath
@{
  source = $source
  preview = Read-Preview $outputPath
  sourceHashBefore = $sourceHash
  sourceHashAfter = (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash
  outputHashBefore = $beforeOutputHash
  outputHashAfter = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
  outputTimeBefore = $beforeOutputTime
  outputTimeAfter = [System.IO.File]::GetLastWriteTimeUtc($outputPath).Ticks.ToString()
  temporaryFiles = @(Get-ChildItem -LiteralPath $FixtureRoot -Filter '*.tmp').Count
} | ConvertTo-Json -Depth 5 -Compress
`;

function runPreview(width, height, existing = false) {
  const temporaryRoot = realpathSync(tmpdir());
  const fixtureRoot = mkdtempSync(path.join(temporaryRoot, "arizona-preview-alpha-test-"));
  try {
    const harnessPath = path.join(fixtureRoot, "fixture.ps1");
    writeFileSync(harnessPath, harness);
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harnessPath,
      "-FixtureRoot", fixtureRoot, "-HelperPath", helperPath,
      "-Width", String(width), "-Height", String(height), ...(existing ? ["-Existing"] : []),
    ], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout.trim());
    assert.equal(data.sourceHashAfter, data.sourceHashBefore, "original PNG must remain unchanged");
    assert.equal(data.temporaryFiles, 0, "preview generation must finish its temporary output");
    return data;
  } finally {
    const resolved = realpathSync(fixtureRoot);
    assert.equal(path.dirname(resolved), temporaryRoot, "cleanup must stay inside the temporary root");
    assert.ok(path.basename(resolved).startsWith("arizona-preview-alpha-test-"));
    rmSync(resolved, { recursive: true, force: true });
  }
}

function assertTransparencyAndCorners(preview) {
  const expected = [[255, 220, 40, 20], [255, 20, 180, 40], [255, 20, 40, 220], [128, 220, 120, 30]];
  for (const [index, pixel] of expected.entries()) {
    assert.equal(preview.pixels[index][0], pixel[0], `corner ${index} alpha`);
    for (let channel = 1; channel < 4; channel++) {
      assert.ok(Math.abs(preview.pixels[index][channel] - pixel[channel]) <= 2, `corner ${index} channel ${channel}`);
    }
  }
  assert.equal(preview.pixels[4][0], 0, "hidden RGB must remain invisible");
}

test("PNG previews preserve transparent, partial and opaque alpha without enlarging small sources", windowsOnly, () => {
  const { source, preview } = runPreview(16, 8);
  assert.deepEqual(source.pixels[4], [0, 240, 20, 180], "fixture includes hidden RGB");
  assert.deepEqual([preview.width, preview.height], [16, 8]);
  assertTransparencyAndCorners(preview);
});

test("large PNG previews retain proportions, transparent regions and all four corners", windowsOnly, () => {
  const { preview } = runPreview(1024, 256);
  assert.deepEqual([preview.width, preview.height], [512, 128]);
  assertTransparencyAndCorners(preview);
});

test("an existing cached PNG is reused without rewriting its bytes or timestamp", windowsOnly, () => {
  const result = runPreview(16, 8, true);
  assert.equal(result.outputHashAfter, result.outputHashBefore);
  assert.equal(result.outputTimeAfter, result.outputTimeBefore);
});
