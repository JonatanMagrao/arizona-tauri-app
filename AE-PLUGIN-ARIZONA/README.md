# Arizona AEGP/AEX â€” arquivo legado

Este projeto estÃ¡ aposentado e permanece no repositÃ³rio apenas como referÃªncia
histÃ³rica da implementaÃ§Ã£o anterior.

O Arizona App atual:

- nÃ£o compila nem empacota `ArizonaBridgeTest.aex`;
- nÃ£o cria `Support Files\Plug-ins\Arizona`;
- nÃ£o usa o named pipe `\\.\pipe\arizona-aegp-bridge`;
- nÃ£o usa `bridgeToken` para os atalhos;
- executa ExtendScript embutido no Tauri via `AfterFX.exe -r`.

A implementaÃ§Ã£o ativa estÃ¡ em:

```text
src-tauri/src/after_effects.rs
src-tauri/src/after_effects/arizona_actions.jsx
```

O instalador remove `ArizonaBridgeTest.aex` legado durante upgrade ou
desinstalaÃ§Ã£o, sem apagar outros arquivos que possam existir na pasta
`Plug-ins\Arizona`.

NÃ£o use `sample/Win/build.ps1` no fluxo de release atual. TambÃ©m nÃ£o apague as
chaves pÃºblicas/privadas legadas sem uma decisÃ£o explÃ­cita de encerrar a
compatibilidade com clientes antigos; consulte
`../docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`.
