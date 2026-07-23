# Arizona AEGP/AEX — arquivo legado

Este projeto está aposentado e permanece no repositório apenas como referência
histórica da implementação anterior.

O Arizona App atual:

- não compila nem empacota `ArizonaBridgeTest.aex`;
- não cria `Support Files\Plug-ins\Arizona`;
- não usa o named pipe `\\.\pipe\arizona-aegp-bridge`;
- não usa `bridgeToken` para os atalhos;
- executa ExtendScript embutido no Tauri via `AfterFX.exe -r`.

A implementação ativa está em:

```text
src-tauri/src/after_effects.rs
src-tauri/src/after_effects/arizona_actions.jsx
```

O instalador remove `ArizonaBridgeTest.aex` legado durante upgrade ou
desinstalação, sem apagar outros arquivos que possam existir na pasta
`Plug-ins\Arizona`.

Não use `sample/Win/build.ps1` no fluxo de release atual. Também não apague as
chaves públicas/privadas legadas sem uma decisão explícita de encerrar a
compatibilidade com clientes antigos; consulte
`../LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`.
