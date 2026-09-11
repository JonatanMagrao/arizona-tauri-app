param(
  [Parameter(Mandatory=$true)][string]$TasksPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct ArizonaPreviewSize {
  public int Width;
  public int Height;

  public ArizonaPreviewSize(int width, int height) {
    Width = width;
    Height = height;
  }
}

[Flags]
public enum ArizonaShellImageFlags {
  ResizeToFit = 0x00000000,
  BiggerSizeOk = 0x00000001,
  ThumbnailOnly = 0x00000008
}

[ComImport]
[Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IArizonaShellItemImageFactory {
  void GetImage(ArizonaPreviewSize size, ArizonaShellImageFlags flags, out IntPtr bitmapHandle);
}

public static class ArizonaPreviewNativeMethods {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  public static extern void SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string path,
    IntPtr bindContext,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    out IArizonaShellItemImageFactory shellItem
  );

  [DllImport("gdi32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool DeleteObject(IntPtr hObject);
}

public static class ArizonaShellThumbnailExtractor {
  private static void SavePng(string inputPath, string outputPath, int size) {
    using (Image source = Image.FromFile(inputPath)) {
      double scale = Math.Min(1.0, (double)size / Math.Max(source.Width, source.Height));
      if (scale == 1.0) {
        source.Save(outputPath, ImageFormat.Png);
        return;
      }

      int width = Math.Max(1, (int)Math.Round(source.Width * scale));
      int height = Math.Max(1, (int)Math.Round(source.Height * scale));
      using (Bitmap preview = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
        using (Graphics graphics = Graphics.FromImage(preview)) {
          graphics.CompositingMode = CompositingMode.SourceCopy;
          graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
          using (ImageAttributes attributes = new ImageAttributes()) {
            attributes.SetWrapMode(WrapMode.TileFlipXY);
            graphics.DrawImage(source, new Rectangle(0, 0, width, height),
              0, 0, source.Width, source.Height, GraphicsUnit.Pixel, attributes);
          }
        }
        preview.Save(outputPath, ImageFormat.Png);
      }
    }
  }

  public static void Save(string inputPath, string outputPath, int size) {
    // Decode PNGs directly: FromHbitmap discards their transparency.
    if (String.Equals(Path.GetExtension(inputPath), ".png", StringComparison.OrdinalIgnoreCase)) {
      SavePng(inputPath, outputPath, size);
      return;
    }

    Guid iid = typeof(IArizonaShellItemImageFactory).GUID;
    IArizonaShellItemImageFactory factory = null;
    ArizonaPreviewNativeMethods.SHCreateItemFromParsingName(
      inputPath,
      IntPtr.Zero,
      iid,
      out factory
    );

    IntPtr bitmapHandle = IntPtr.Zero;

    try {
      factory.GetImage(
        new ArizonaPreviewSize(size, size),
        ArizonaShellImageFlags.ThumbnailOnly | ArizonaShellImageFlags.BiggerSizeOk,
        out bitmapHandle
      );

      if (bitmapHandle == IntPtr.Zero) {
        throw new InvalidOperationException("Thumbnail not available.");
      }

      using (Bitmap bitmap = Image.FromHbitmap(bitmapHandle)) {
        bitmap.Save(outputPath, ImageFormat.Png);
      }
    } finally {
      if (bitmapHandle != IntPtr.Zero) {
        ArizonaPreviewNativeMethods.DeleteObject(bitmapHandle);
      }

      if (factory != null) {
        Marshal.ReleaseComObject(factory);
      }
    }
  }
}
"@ -ReferencedAssemblies System.Drawing

$tasks = Get-Content -LiteralPath $TasksPath -Raw -Encoding UTF8 | ConvertFrom-Json

foreach ($task in $tasks) {
  if (Test-Path -LiteralPath $task.outputPath -PathType Leaf) {
    continue
  }

  $temporaryPath = $task.outputPath + "." + $PID + ".tmp"

  try {
    [ArizonaShellThumbnailExtractor]::Save(
      [string]$task.inputPath,
      $temporaryPath,
      [int]$task.size
    )
    Move-Item -LiteralPath $temporaryPath -Destination $task.outputPath -Force
  } catch {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    Write-Warning ("Preview indisponivel para " + [string]$task.inputPath + ": " + $_.Exception.Message)
  }
}
