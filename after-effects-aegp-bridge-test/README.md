# Arizona AEGP Bridge Test

Native After Effects AEGP/AEX test plugin for the Arizona Tauri bridge.

## Current Build

The compiled plugin is an invisible AEGP receiver. It does not add a Window menu
command. When After Effects loads the plugin, it starts this local Windows named
pipe:

```text
\\.\pipe\arizona-aegp-bridge
```

The pipe server queues commands only after two checks pass:

```text
1. the named-pipe client process is an Authenticode-signed Tauri executable;
2. the command carries a short `bridgeToken` JWT accepted by the AEX bridge.
```

Release builds should pin the Tauri publisher certificate with
`ARIZONA_TAURI_CERT_SHA256` and the AEX bridge token public key coordinates.
Release builds fail before compilation if these values are missing. Development
fallback for an unsigned `arizona-app.exe` plus the `arizona-aex-dev-token`
bridge token is available only when building Debug with `-AllowDevBridge`.

After Effects suite calls are executed later from the AEGP idle hook.

Supported commands:

```text
show_alert
move_layers_backward
move_layers_forward
move_jump_marker
select_jump_marker_layer
adjust_markers_to_tail
```

`show_alert` is kept as a diagnostic command. The production test command is
split into native C++ actions based on the root `Mover Layers Para Markers.jsx`
script:

```text
Ctrl+Numpad1 -> move_layers_backward
Ctrl+Numpad3 -> move_layers_forward
Ctrl+Numpad2 -> move_jump_marker
Ctrl+Numpad0 -> select_jump_marker_layer
Ctrl+NumpadDecimal -> adjust_markers_to_tail
```

`select_jump_marker_layer` selects the topmost visible, unlocked layer that is
active at the current timeline frame, whose layer/source name contains `Oferta_`
followed by a digit, and that has any marker comment containing `Pulo`.

`move_jump_marker` moves the selected layers' jump marker to the current timeline
frame, clamping it to at least 27 frames after each layer's in point.

`adjust_markers_to_tail` mirrors the CEP panel's "Ajuste Marker" action for the
`Miolo` comp: it moves comp markers 2 through 6 to the tail, moves matching layer
groups with them, returns to offer 1, and selects offer 1 layers.

`move_layers_to_markers` is still accepted by the plugin as a compatibility alias
for `move_layers_forward`.

## Folder Layout

```text
plugin/ArizonaBridgeTest.aex
sample/Win/ArizonaBridgeTest.sln
sample/Win/ArizonaBridgeTest.vcxproj
sample/Win/build.ps1
sdk/ae25.6_61.64bit.AfterEffectsSDK/Examples/Headers
sdk/ae25.6_61.64bit.AfterEffectsSDK/Examples/Resources
sdk/ae25.6_61.64bit.AfterEffectsSDK/Examples/Util
src/ArizonaBridgeTest.cpp
src/ArizonaBridgeTest.h
src/ArizonaBridgeTest_PiPL.r
src/BridgeContext.h
src/actions/MoveLayersToMarkers.cpp
src/actions/MoveLayersToMarkers.h
src/actions/ShowAlert.cpp
src/actions/ShowAlert.h
```

`plugin/ArizonaBridgeTest.aex` is the compiled Windows x64 plugin that was
tested in After Effects 2025.

`src/` is the source for the test plugin.

`sample/Win/` is the prepared Visual Studio project for future Windows x64
tests.

`sdk/` contains only the SDK pieces needed by this build: headers, PiPL resources
and the small Adobe utility sources used by the project. The full Adobe samples
and extra tooling are intentionally not vendored here.

## Build

Build from this folder:

```powershell
.\sample\Win\build.ps1
```

By default, the script uses the bundled SDK under `sdk/`. You can still override
it with `-SdkRoot` or `AE_SDK_ROOT` when testing another SDK version.

The output is written to:

```text
plugin/ArizonaBridgeTest.aex
```

## Install

Copy:

```text
plugin/ArizonaBridgeTest.aex
```

To:

```text
C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\Plug-ins\Arizona\ArizonaBridgeTest.aex
```

Then restart After Effects.

## Tauri Connection Plan

Use the local Windows Named Pipe between Tauri and the AEGP plugin:

```text
Tauri global shortcut
> Tauri validates license
> Tauri sends JSON command through named pipe
> AEGP queues command
> AEGP idle hook executes command on After Effects main thread
```

Important rule: the IPC listener can run on a background thread, but calls into
After Effects suites must be executed from the plugin's registered hook/idle
path, not directly from the IPC thread.

Command shape:

```json
{
  "type": "ae.command",
  "protocolVersion": "arizona.aex.v1",
  "id": "aegp_cmd_1780000000000",
  "seq": 42,
  "issuedAt": "2026-07-01T18:00:00.000Z",
  "expiresAt": "2026-07-01T18:00:10.000Z",
  "command": "move_layers_forward",
  "args": null,
  "bridgeToken": "eyJ..."
}
```

The AEX side validates the protocol version, command allowlist, argument schema,
sequence replay, short command expiry window, and the JWT claims:

```text
iss = arizona-app
aud = arizona-aex-bridge
feature/features includes ae_bridge
nbf/iat/exp are inside the accepted clock window
alg = ES256
```

The Tauri app registers configurable global shortcuts for each action, validates
the current license, then sends the matching command to the plugin with the
short bridge token returned by the backend license validation.

## Release Security Configuration

Set these MSBuild properties or environment variables when building the AEX for
production:

```powershell
$env:ARIZONA_TAURI_CERT_SHA256 = "<SHA-256 thumbprint of the signed Tauri exe certificate>"
$env:ARIZONA_AEX_JWT_ES256_PUBLIC_X = "<P-256 public key X coordinate as 64 hex chars>"
$env:ARIZONA_AEX_JWT_ES256_PUBLIC_Y = "<P-256 public key Y coordinate as 64 hex chars>"
$env:ARIZONA_AEX_JWT_KID = "v1"
.\sample\Win\build.ps1 -Configuration Release
```

`ARIZONA_AEX_JWT_ES256_PUBLIC_X` and
`ARIZONA_AEX_JWT_ES256_PUBLIC_Y` are the raw 32-byte P-256 coordinates, not a
PEM file. The backend should sign bridge tokens with the matching private key.

After signing the Tauri executable, extract the certificate hash with:

```powershell
$sig = Get-AuthenticodeSignature .\src-tauri\target\release\arizona-app.exe
$sig.SignerCertificate.GetCertHashString("SHA256")
```

For local AEX smoke tests only:

```powershell
.\sample\Win\build.ps1 -Configuration Debug -AllowDevBridge
npm run tauri:dev:bridge
```
