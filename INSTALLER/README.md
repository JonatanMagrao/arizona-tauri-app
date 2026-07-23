# Arizona Installer

Esta pasta prepara o instalador oficial Windows. O pacote final instala:

- Arizona Tauri App;
- extensão CEP do After Effects;

Não existe payload AEX. Os atalhos do After Effects são ExtendScript embutido no
Tauri e executado com `AfterFX.exe -r`.

## Layout

```text
INSTALLER/
  nsis/hooks.nsh
  scripts/
  payload/
```

`payload/` é gerado, ignorado pelo Git e contém:

```text
payload/
  cep/com.arizona-carrefour.cep/
  release-manifest.json
```

`release-manifest.json` usa schema 2 e declara
`includesAfterEffectsPlugin=false`. A verificação falha se encontrar pasta
`aex/` ou qualquer arquivo `.aex`.

## Comandos

```powershell
npm run release:check
npm run installer:test
npm run release:cep
npm run release:collect
npm run release:installer
npm run release:all
```

## Instalação

O hook NSIS:

1. instala e valida o fingerprint da extensão CEP em
   `%APPDATA%\Adobe\CEP\extensions\com.arizona-carrefour.cep`;
2. remove `ArizonaBridgeTest.aex` legado, se existir em alguma versão do After;
3. não cria nenhuma pasta em `Support Files\Plug-ins`;
4. grava `installer/installed-assets.json` com schema 2 e somente o destino CEP.

O protocolo legado `arizona://` não é mais registrado. Em upgrade ou
desinstalação, a chave antiga é removida somente se ainda apontar para o
executável desta instalação.

Se um AEX legado precisa ser removido e o After Effects está aberto, o
instalador pede para fechá-lo. Sem AEX legado, o After pode permanecer aberto.

## Desinstalação

- remove a extensão CEP;
- limpa o AEX legado exato encontrado por estado antigo ou descoberta segura;
- só remove `Plug-ins\Arizona` quando a pasta fica vazia;
- preserva qualquer outro arquivo da pasta;
- aborta se uma limpeza necessária falhar;
- tenta liberar o device e sempre remove a sessão local em uma desinstalação
  real; falha de rede não bloqueia a remoção;
- remove os demais dados locais somente quando a caixa padrão do desinstalador
  estiver marcada.

PowerShell e os comandos auxiliares são executados por `nsExec`, sem abrir
janela de terminal. O teste também compila os hooks NSIS para impedir regressão.

O teste isolado cobre instalação CEP, ausência de criação de plugins, limpeza de
AEX legado em duas versões, preservação de arquivo alheio, junction CEP e
compilação dos hooks sem `ExecWait`:

```powershell
npm run installer:test
```

Logs:

```text
%LOCALAPPDATA%\Arizona Installer\logs\installer.log
```
