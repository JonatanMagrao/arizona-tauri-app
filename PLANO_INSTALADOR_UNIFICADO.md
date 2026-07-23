# Falta para o build oficial

## Já preparado

- Instalador NSIS do Tauri com hooks de instalação/desinstalação.
- Payload schema 2 contendo apenas CEP, sem AEX.
- Atalhos do After executados por ExtendScript embutido no Tauri.
- Validação que rejeita qualquer `.aex` no payload.
- Instalação CEP com fingerprint e estado persistido.
- Upgrade/desinstalação que remove com segurança o AEX legado sem criar pastas
  de plugin.
- Teste de ciclo de vida com After Effects 2025/2026, arquivo alheio e junction.
- Liberação de device em toda desinstalação real, sem bloquear a remoção
  quando a rede estiver indisponível.
- Execução invisível dos auxiliares por `nsExec`, sem janela de PowerShell.

O instalador final inclui Tauri App, extensão CEP e integrações Windows. O Admin
e o plugin AEX não entram no pacote.

## Obrigatório antes do release real

- Definir/comprar o certificado real de code signing.
- Configurar assinatura do `arizona-app.exe` e do instalador.
- Rodar `npm run release:cep`.
- Rodar `npm run release:collect`.
- Confirmar que `INSTALLER/payload` não contém pasta `aex` nem arquivo `.aex`.
- Gerar o instalador com `npm run release:installer` ou `npm run release:all`.
- Fazer QA do CEP e dos seis atalhos JSX em máquina/VM limpa.

## CEP e migração do AEX

- Validar se a instalação CEP elevada resolve o perfil correto do usuário.
- Testar upgrade com CEP antiga e junction de desenvolvimento.
- Testar upgrade de máquina que ainda tenha `ArizonaBridgeTest.aex`.
- Confirmar que nenhuma versão do After ganha `Plug-ins\Arizona`.
- Confirmar que arquivo alheio dentro de uma pasta `Arizona` é preservado.

## QA mínimo

- Máquina limpa sem After Effects.
- After Effects 2025.
- After Effects 2026.
- Mais de uma versão instalada.
- CEP antiga.
- AEX legado instalado.
- Sem permissão admin.
- Upgrade da mesma versão e de versão anterior.
- Uninstall preservando dados.
- Uninstall removendo dados e liberando device.

## Comandos

```powershell
npm run release:check
npm run installer:test
npm run release:cep
npm run release:collect
npm run release:installer
npm run release:all
```
