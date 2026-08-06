# Arizona App

Monorepo com três projetos ativos do ecossistema Arizona. Cada projeto é
independente e se comunica apenas pelos contratos descritos em `AGENTS.md`.

| Projeto | Pasta | Descrição |
|---|---|---|
| **Tauri (Arizona App)** | raiz — `src/` + `src-tauri/` | App desktop: jobs, mídias, produtos, histórico e atalhos do After executados por ExtendScript embutido. |
| **Extensão CEP** | `ARIZONA-EXTENSION/` | Painel React dentro do After Effects, liberado pelo recibo de licença do Arizona App. |
| **Admin** | `ADMIN/` | Gestão de licenças + Supabase. |

`AE-PLUGIN-ARIZONA/` é apenas o arquivo histórico do bridge AEX aposentado. O
build e o instalador atuais não compilam, empacotam nem instalam plugin nativo.

## Licenciamento

Antes de alterar autenticação, licenciamento, Supabase, extensão CEP, secrets,
tokens ou chaves, leia
[LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md](./docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md).

Diagnóstico:

```powershell
npm run license:check
```

O horário de renovação diária é configurado por licença no painel Admin. O
padrão é `04:00` em `America/Sao_Paulo`; isso controla a sessão diária e o
recibo CEP, não a expiração global do refresh token do Supabase. A data limite
da licença é o último dia completo válido: o acesso bloqueia na renovação
diária do dia seguinte.

O usuário final não cria nem digita senha, e não usa autenticador. No primeiro
acesso, o master gera no painel Admin web um código de uso único, com validade
definida na política da licença (15 minutos por padrão). O usuário ativa a
conta com e-mail + código de 12 caracteres e, a partir daí, não se autentica de
novo naquela máquina. O código é guardado no Supabase apenas como hash e
aparece em claro uma única vez para quem o emitiu.

O que substitui o autenticador é a confiança de máquina: o Tauri envia um
`deviceFingerprintHash` derivado do `MachineGuid` do Windows, e o backend
recusa uma credencial que apareça em outro hardware. Cadastrar uma máquina nova
exige um código de ativação recente, e é isso que impede que um registro
copiado do Windows Credential Manager funcione em outro computador.

Quando um device é liberado, o código de recuperação revoga o device e as
sessões de licença. A troca é confirmada pelo próprio código, dentro da janela
de recuperação configurada na licença.

A janela **Gestão** continua disponível no Arizona App para sessões com papel
`admin`, usando as Functions administrativas do backend. O painel Admin web é o
fluxo separado para operações da conta master e da organização.

O Tauri é a autoridade da sessão local: access token, refresh token e recibo
assinado não são entregues ao JavaScript da interface. O recibo offline da
extensão CEP dura no máximo 15 minutos e é removido quando o backend revoga o
acesso e o Tauri consegue sincronizar.

Existe uma segunda identidade criptográfica, independente da chave do recibo: o
certificado que assina o `.zxp` da extensão CEP. A chave do recibo diz se o
usuário tem licença; o certificado diz quem publicou a extensão. O `.p12` fica
em `ARIZONA-EXTENSION/certs/` (gitignored, precisa de backup fora do
repositório) e a impressão digital pública aceita fica em
`INSTALLER/cep-trusted-cert.json`, versionada. É essa assinatura que dispensa o
`PlayerDebugMode` nas máquinas dos clientes.

## Instalação da extensão CEP

O instalador Full oficial é `perMachine` e instala a árvore assinada em:

```text
%CommonProgramW6432%\Adobe\CEP\extensions\com.arizona-carrefour.cep
```

O staging e os backups transacionais ficam em
`%CommonProgramW6432%\Adobe\CEP\.arizona-install-work`, fora da pasta
`extensions`. Os helpers elevados de assets do Full não escrevem no perfil do
usuário nem alteram HKCU.

A instalação/atualização manual iniciada pelo Tauri é um fluxo separado e
continua `per-user` em
`%APPDATA%\Adobe\CEP\extensions\com.arizona-carrefour.cep`. Ambos os fluxos
extraem o `.zxp` assinado; nenhum distribui a pasta crua de build.

Essa validação cobre a extensão CEP. Ela não substitui a assinatura Authenticode
do executável/setup nem o smoke test do Full em uma máquina limpa com After
Effects e `PlayerDebugMode` desligado; esses dois itens precisam de comprovação
separada antes de declarar o instalador público aprovado.

## Comandos do dia a dia

Tudo junto:

```powershell
npm run dev:all
```

Tauri:

```powershell
npm run tauri:dev
npm run tauri:build
npm run cep:dev
npm run cep:build
```

Extensão CEP:

```powershell
cd ARIZONA-EXTENSION
npm run dev
npm run build
```

Pacote assinado da extensão (na raiz):

```powershell
npm run cep:cert   # uma única vez; ver docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md
npm run cep:zxp
npm run cep:verify -- dist-cep/arizona-cep-v2.0.0.zxp
```

O número no nome do `.zxp` acompanha `ARIZONA-EXTENSION/package.json`.

Admin:

```powershell
cd ADMIN
npm run dev
```

## Atalhos do After Effects

O Tauri registra os atalhos globais, exige uma sessão autenticada e executa o
motor JSX embutido através do comando oficial `AfterFX.exe -r`. Os arquivos
materializados ficam nos dados locais do Arizona App, nunca nas pastas
`Plug-ins` ou `Scripts` do Adobe.

Na tela **Configurações > Atalhos After**, **Padrão** e **Limpar** restauram ou
desativam uma ação individual. **Restaurar padrões** repõe as seis combinações
originais e **Limpar todos** deixa todos os campos vazios. Um campo vazio
significa atalho desativado: a combinação não é registrada globalmente. O botão
**Gravar** continua permitindo escolher uma combinação personalizada para cada
ação.

O fonte mantido pelo projeto fica em
`src-tauri/src/after_effects/arizona_actions.jsx`. Em `npm run tauri:dev`, ele
continua legivel e e materializado como `.jsx`. No build release, o
`src-tauri/build.rs` chama `scripts/build-after-effects-jsxbin.mjs`, gera uma
variante `.jsxbin` por acao e embute somente essas variantes no executavel.
JSXBIN dificulta a leitura casual do codigo distribuido, mas nao deve ser
tratado como criptografia ou como uma fronteira de seguranca.

## Documentação

O índice de documentos operacionais e propostas vigentes está em
[docs/README.md](./docs/README.md).

Revisões em andamento:

- [Visualizador de MP4 e limitação de MOV](./docs/REVISAO_VISUALIZADOR_MP4_MOV.md)
- [Privacidade, registros operacionais, diagnóstico e feedback](./docs/roadmap-privacidade-telemetria.md)
- [Atualizações independentes do Tauri e CEP](./docs/arquitetura-atualizacoes-independentes-tauri-cep.md)
- [Cache compartilhado de previews dos produtos](./docs/CACHE_PREVIEWS_PRODUTOS.md)
