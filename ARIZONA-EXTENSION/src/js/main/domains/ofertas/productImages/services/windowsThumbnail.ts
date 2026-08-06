import {
  child_process,
  crypto,
  fs,
  path as nodePath,
} from "../../../../../lib/cep/node";
import type { PsdPreview } from "./psdPreview";
import { ensurePreviewCacheDirectory } from "./previewCache";

const SCRIPT_NAME = "arizona-carrefour-shell-thumbnail.ps1";

const POWERSHELL_SCRIPT = String.raw`
param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [int]$Size = 1600
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct NativeSize {
  public int Width;
  public int Height;

  public NativeSize(int width, int height) {
    Width = width;
    Height = height;
  }
}

[Flags]
public enum ShellImageFlags {
  ResizeToFit = 0x00000000,
  BiggerSizeOk = 0x00000001,
  MemoryOnly = 0x00000002,
  IconOnly = 0x00000004,
  ThumbnailOnly = 0x00000008,
  InCacheOnly = 0x00000010,
  CropToSquare = 0x00000020,
  WideThumbnails = 0x00000040,
  IconBackground = 0x00000080,
  ScaleUp = 0x00000100
}

[ComImport]
[Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemImageFactory {
  void GetImage(NativeSize size, ShellImageFlags flags, out IntPtr bitmapHandle);
}

public static class NativeMethods {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  public static extern void SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string path,
    IntPtr bindContext,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
    out IShellItemImageFactory shellItem
  );

  [DllImport("gdi32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool DeleteObject(IntPtr hObject);
}

public static class ShellThumbnailExtractor {
  public static void Save(string inputPath, string outputPath, int size) {
    Guid iid = typeof(IShellItemImageFactory).GUID;
    IShellItemImageFactory factory = null;
    NativeMethods.SHCreateItemFromParsingName(inputPath, IntPtr.Zero, iid, out factory);

    IntPtr bitmapHandle = IntPtr.Zero;

    try {
      factory.GetImage(
        new NativeSize(size, size),
        ShellImageFlags.ThumbnailOnly | ShellImageFlags.BiggerSizeOk,
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
        NativeMethods.DeleteObject(bitmapHandle);
      }

      if (factory != null) {
        Marshal.ReleaseComObject(factory);
      }
    }
  }
}
"@ -ReferencedAssemblies System.Drawing

[ShellThumbnailExtractor]::Save($InputPath, $OutputPath, $Size)
`;

const ensureScriptFile = (directory: string) => {
  const scriptPath = nodePath.join(directory, SCRIPT_NAME);

  if (!fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, "utf8") !== POWERSHELL_SCRIPT) {
    fs.writeFileSync(scriptPath, POWERSHELL_SCRIPT, "utf8");
  }

  return scriptPath;
};

const execFile = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    child_process.execFile(
      command,
      args,
      {
        timeout: 45_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message));
          return;
        }

        resolve();
      }
    );
  });

export const renderWindowsShellThumbnail = async (
  filePath: string,
  maxSize = 1600
): Promise<PsdPreview> => {
  if (process.platform !== "win32") {
    throw new Error("Thumbnail do Windows indisponivel fora do Windows.");
  }

  if (typeof child_process.execFile !== "function") {
    throw new Error("PowerShell indisponivel no painel.");
  }

  const cacheDirectory = ensurePreviewCacheDirectory();
  const scriptPath = ensureScriptFile(cacheDirectory);
  const stats = fs.statSync(filePath);
  const hash = crypto
    .createHash("sha1")
    .update(`${filePath}|${stats.size}|${stats.mtimeMs}|${maxSize}`)
    .digest("hex");
  const outputPath = nodePath.join(cacheDirectory, `${hash}.png`);

  if (!fs.existsSync(outputPath)) {
    await execFile("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-InputPath",
      filePath,
      "-OutputPath",
      outputPath,
      "-Size",
      String(maxSize),
    ]);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("O Windows nao retornou thumbnail para este PSD.");
  }

  return {
    dataUrl: `data:image/png;base64,${fs.readFileSync(outputPath).toString("base64")}`,
    width: maxSize,
    height: maxSize,
  };
};
