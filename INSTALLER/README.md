# Arizona Installer

This folder prepares the official Windows installer flow for the Arizona
desktop app. It does not bundle the Admin app. The final installer is expected
to install or update:

- Arizona Tauri app.
- After Effects CEP extension.
- After Effects AEX bridge plugin.
- Windows integrations such as `arizona://`.

The Admin project is used only during release checks for public manifests and
license parity.

## Layout

```text
INSTALLER/
  nsis/hooks.nsh
  scripts/
  payload/
```

`scripts/` is versioned and bundled as installer support files.

`payload/` is generated and ignored by Git. It is populated by
`collect-artifacts.ps1` with:

```text
payload/
  cep/com.arizona-carrefour.cep/
  aex/ArizonaBridgeTest.aex
  release-manifest.json
```

## Root scripts

```powershell
npm run release:check
npm run release:cep
npm run release:tauri
npm run release:aex
npm run release:collect
npm run release:installer
npm run release:all
```

`release:all` is the official orchestrator, but it still requires the missing
production inputs listed below.

## Still required for a real official build

See `../PLANO_INSTALADOR_UNIFICADO.md` for the current release checklist.

## NSIS hooks

The Tauri config points to `nsis/hooks.nsh`. The hooks register and unregister
the `arizona://` protocol and call the PowerShell install/uninstall scripts for
Adobe assets.

The uninstall policy is:

- Always remove the CEP extension and AEX plugin installed by Arizona.
- Ask only whether user data/session/logs should also be removed.
