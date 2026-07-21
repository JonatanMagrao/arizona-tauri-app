# Falta para o build oficial

Este checklist substitui o plano inicial do instalador. A arquitetura e os scripts base ja estao em `INSTALLER/README.md`; este arquivo registra apenas o que ainda falta para gerar e validar o instalador oficial.

## Ja preparado

- `INSTALLER/` com scripts, payload ignorado pelo Git e hooks NSIS.
- `src-tauri/tauri.conf.json` apontando para `INSTALLER/nsis/hooks.nsh`.
- `package.json` com comandos `release:*`.
- Hook NSIS para registrar/remover `arizona://`.
- Scripts para detectar After Effects, instalar/remover CEP e AEX, coletar payload e validar o scaffold.
- `npm run release:check` validando paridade de licenca e configuracao base.

O instalador final inclui Tauri App, extensao CEP, plugin AEX e integracoes do Windows. O Admin nao entra no instalador.

## Obrigatorio antes do release real

- Definir/comprar o certificado real de code signing.
- Configurar assinatura do `arizona-app.exe` e do instalador.
- Gerar o AEX em `Release` com `ARIZONA_TAURI_CERT_SHA256`.
- Confirmar que o AEX Release embute a chave publica de bridge correta.
- Rodar `npm run release:collect` com CEP e AEX oficiais.
- Gerar o instalador com `npm run release:installer` ou `npm run release:all`.

## Deep Link

O NSIS ja fica preparado para registrar e remover `arizona://`.

Ainda falta implementar no Tauri o tratamento do argumento recebido pelo app, se o deep link precisar fazer algo alem de abrir o Arizona App.

## CEP e AEX

- Validar se a instalacao CEP via instalador elevado cai no usuario correto.
- Confirmar se a distribuicao final da CEP sera pasta direta, ZIP ou ZXP.
- Testar upgrade quando existir CEP antiga ou junction de desenvolvimento.
- Testar instalacao do AEX em todas as versoes do After Effects instaladas.
- Testar uninstall com After Effects aberto e fechado.

## QA minimo

- Maquina limpa sem After Effects.
- Maquina com After Effects 2024.
- Maquina com After Effects 2025.
- Maquina com After Effects 2026.
- Maquina com mais de uma versao do After.
- Maquina com CEP/AEX antigo.
- Maquina sem permissao admin.
- Upgrade da mesma versao.
- Upgrade de versao anterior.
- Uninstall preservando dados do usuario.
- Uninstall removendo dados do usuario.

## Comandos uteis

```powershell
npm run release:check
npm run release:cep
npm run release:aex
npm run release:collect
npm run release:installer
npm run release:all
```

`release:check` deve passar antes de qualquer tentativa de build oficial.
