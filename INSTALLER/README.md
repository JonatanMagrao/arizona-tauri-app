# Arizona Installer

Esta pasta prepara o instalador oficial Windows. O pacote final instala:

- Arizona Tauri App;
- extensão CEP do After Effects;

Não existe payload AEX. Os atalhos do After Effects são ExtendScript embutido no
Tauri e executado com `AfterFX.exe -r`.

## Layout

```text
INSTALLER/
  cep-trusted-cert.json
  nsis/hooks.nsh
  nsis/installer.nsi
  scripts/
  payload/
```

`cep-trusted-cert.json` é versionado no Git, contém **apenas material público**
e fixa quais certificados de assinatura um release pode carregar.

`payload/` é gerado, ignorado pelo Git e contém:

```text
payload/
  cep/com.arizona-carrefour.cep.zxp
  release-manifest.json
```

`release-manifest.json` usa schema 3, declara `includesAfterEffectsPlugin=false`
e registra `cepZxpSha256` (SHA-256 do `.zxp`) e `cepBundleVersion` (lido de
`CSXS/manifest.xml` dentro do pacote). A verificação falha se encontrar pasta
`aex/` ou qualquer arquivo `.aex`.

## Por que o payload é um `.zxp` assinado

O CEP verifica a assinatura a partir da **pasta instalada**. Uma pasta de build
copiada nunca corresponde a `META-INF/signatures.xml`, e por isso toda máquina
precisava do `PlayerDebugMode`. O instalador agora extrai o pacote assinado, e a
árvore extraída é idêntica byte a byte ao `.zxp`.

Nada pode ser removido do pacote: `.debug`, `mimetype` e
`META-INF/signatures.xml` fazem parte do manifesto de assinatura. Apagar
qualquer um deles invalida a verificação da Adobe.

O `.zxp` assinado sai de `npm run cep:zxp` em
`dist-cep/arizona-cep-v<versão-da-extensão>.zxp`. O `release:collect` aceita
exclusivamente o nome derivado de `ARIZONA-EXTENSION/package.json` e também
exige que `ExtensionBundleVersion` seja exatamente essa versão. Um artefato com
a versão do app ou qualquer pacote antigo é recusado antes de alterar o payload.

## Comandos

```powershell
npm run release:check
npm run installer:test
npm run cep:zxp
npm run release:collect
npm run release:installer
npm run release:all
npm run release:verify-public
```

`npm run release:cep` e `npm run cep:zxp` geram o mesmo `.zxp` assinado com a
identidade estável da Arizona. Os fluxos oficiais `release:installer` e
`release:all` sempre constroem um pacote novo antes de coletar o payload; não
reutilizam silenciosamente um artefato antigo de `dist-cep/`.

`release:all` continua sendo o build local, sem exigir acesso a certificado
Authenticode. Para um artefato destinado à distribuição pública, use
`release:verify-public`: ele executa o build e, somente depois, exige
`Get-AuthenticodeSignature.Status = Valid` tanto em
`src-tauri/target/release/arizona-app.exe` quanto no único setup NSIS da versão
configurada (`arizona-app_<versão-configurada>_<arquitetura>-setup.exe`). Ausência, mais de um
setup correspondente ou qualquer status diferente de `Valid` interrompem o
comando. Esse gate apenas verifica; ele não assina nem acessa chaves.

A escolha do artefato CEP usa somente a versão de
`ARIZONA-EXTENSION/package.json`. As versões do app e do Tauri continuam
registradas como metadados do release, mas nunca servem de nome alternativo ou
fallback para localizar o `.zxp`.

## Instalação

O hook NSIS:

1. detecta a instalação `currentUser` da versão 2.0.0 em
   `%LOCALAPPDATA%\arizona-app`, executa o desinstalador legado em modo de
   update e remove a entrada HKCU antes de instalar a cópia `perMachine`;
2. aborta em vez de criar uma segunda cópia quando a entrada 2.0.0 aponta para
   caminho inesperado, está sem desinstalador ou não pode ser removida;
3. confere o SHA-256 do `.zxp`, a identidade e a versão do bundle, a impressão
   digital do único certificado estrutural contra `cep-trusted-cert.json` e a
   assinatura XMLDSig real, inclusive a cobertura SHA-256 exata de todos os
   arquivos, **antes de tocar em qualquer coisa** na máquina;
4. instala o destino final em
   `%CommonProgramW6432%\Adobe\CEP\extensions\com.arizona-carrefour.cep`
   (`%CommonProgramFiles%` é o fallback quando a variável nativa não existe) e
   extrai staging/backups na pasta irmã
   `Adobe\CEP\.arizona-install-work`, no mesmo volume e fora da área que o CEP
   escaneia, com limites de arquivo, quantidade e tamanho expandido e rejeição
   de caminhos inseguros, duplicados, intermediários reparse e links;
   exige `META-INF/signatures.xml`, `mimetype`, `CSXS/manifest.xml` e `.debug`
   na árvore extraída, repete nela a verificação criptográfica e só então troca
   pelo destino `com.arizona-carrefour.cep` (move o anterior para o work root,
   move o temporário para o lugar por rename e restaura o backup em caso de
   erro ou queda). O helper elevado não escreve em `%APPDATA%` nem altera HKCU;
5. remove `ArizonaBridgeTest.aex` legado, se existir em alguma versão do After;
6. não cria nenhuma pasta em `Support Files\Plug-ins`;
7. grava `installer/installed-assets.json` com schema 2 e somente o destino CEP,
   o SHA-256 instalado e a versão do bundle.

O template NSIS está fixado no gerador `@tauri-apps/cli` 2.8.3. Em uma
instalação NSIS existente, a mesma versão e versões novas do app são aplicadas
no lugar, sem executar o desinstalador anterior. Assim, a sessão no Credential
Manager e os dados locais continuam intactos. Uma versão antiga do app, uma
versão instalada ilegível ou um registro parcial abortam antes de substituir o
executável. A migração legada de WiX continua no fluxo normal; sob `/S`, ela
falha de forma segura e pede o fluxo normal em vez de criar uma segunda cópia.

Para o CEP `perMachine`, o Full compara `ExtensionBundleVersion` por precedência
SemVer:

- payload mais novo: atualiza;
- mesma versão intacta: preserva sem fechar o After Effects;
- mesma versão corrompida: repara com o pacote assinado;
- instalação mais nova e intacta: preserva, mesmo dentro de um Tauri antigo;
- instalação mais nova e corrompida: aborta em vez de fazer downgrade implícito.

O switch técnico `-AllowCepVersionDowngrade` existe somente para rollback
explícito e supervisionado pelo suporte; o setup normal nunca o envia. Toda
troca revalida pacote, árvore extraída e destino imediatamente antes do rename,
e um lock exclusivo impede dois helpers Full simultâneos.

Payload que não confere com o manifesto aborta a instalação com a extensão
anterior intacta e sem remover o AEX legado. Como o work root é irmão de
`extensions` no mesmo volume, a troca final continua sendo um rename, mas crash,
rollback e falha nunca deixam outra cópia do mesmo BundleId visível ao CEP. Um
junction de desenvolvimento é desligado, nunca copiado nem apagado por dentro.

O tratamento de compatibilidade da instalação `currentUser` 2.0.0 no item 1 é
feito pelo hook NSIS antes da instalação dos assets. Ele não muda o escopo do
CEP novo nem dá ao helper elevado de assets autorização para escrever em HKCU.

A instalação/atualização manual iniciada pelo Tauri é um fluxo separado e
continua `per-user` em
`%APPDATA%\Adobe\CEP\extensions\com.arizona-carrefour.cep`. Ela usa seu próprio
work root fora de `extensions`; não altera o destino `perMachine` do Full. O app
mostra o inventário `perUser`/`perMachine`, pede confirmação para downgrade
`perUser` e bloqueia a operação quando uma cópia `perMachine` mais nova
continuaria sendo escolhida pela Adobe.

A migração 2.0.0 preserva os dados autenticados em
`%LOCALAPPDATA%\com.pc.arizona-app`; remove somente o executável, registro e
atalhos da instalação antiga. A causa da duplicidade era a troca de escopo:
2.0.0 usava o padrão `currentUser` (HKCU/LocalAppData), enquanto o instalador
oficial atual usa `perMachine` (HKLM/Program Files).

O protocolo legado `arizona://` não é mais registrado. Em upgrade ou
desinstalação, a chave antiga é removida somente se ainda apontar para o
executável desta instalação.

A instalação, atualização ou reparo da extensão exige o After Effects fechado.
Quando o CEP igual ou mais novo é apenas preservado e não existe AEX legado, o
After Effects pode permanecer aberto. A preflight de desinstalação também
bloqueia quando um AEX legado carregado precisa ser removido.

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

## Verificação de release

`verify-release.ps1 -RequirePayload` usa portões positivos sobre o payload:

1. `cep/com.arizona-carrefour.cep.zxp` existe e nenhuma pasta de build
   `cep/com.arizona-carrefour.cep/` sobrou;
2. o SHA-256 do pacote confere com `release-manifest.json`;
3. o pacote contém `META-INF/signatures.xml`, `mimetype`, `CSXS/manifest.xml` e
   `.debug`, e o `ExtensionBundleVersion` confere com o manifesto;
4. a impressão digital do certificado de assinatura está em
   `cep-trusted-cert.json`;
5. `scripts/verify-cep-zxp.mjs` valida a assinatura do conteúdo com o
   `ZXPSignCmd` oficial e valida criptograficamente o carimbo RFC 3161: CMS,
   cadeia e EKU do TSA, `genTime` e `messageImprint` sobre o `SignatureValue`
   canônico final. O Node também exige que o certificado de assinatura da
   Arizona estivesse dentro de `notBefore`/`notAfter` no `genTime`; conferir
   somente a validade do certificado do TSA não basta.

A impressão digital é o SHA-256 em hex minúsculo sobre os **bytes DER crus** do
único `X509Certificate` no caminho exato
`Signature > KeyInfo > X509Data > X509Certificate`, sempre no namespace
XMLDSig. O documento inteiro precisa ter exatamente uma `Signature`, um
`KeyInfo`, um `X509Data` e um certificado, sem material de chave alternativo;
qualquer elemento-isca ou outra ambiguidade reprova o pacote.
Essa definição é compartilhada por Node, PowerShell e Rust. Lista vazia em
`cep-trusted-cert.json` reprova tudo, de propósito.

O pin isolado é uma checagem de identidade. No release, ele é combinado com a
verificação da assinatura Adobe e do timestamp. No cliente, app e instalador
também verificam a XMLDSig e os digests da árvore antes da troca; depois o CEP da
Adobe valida novamente a assinatura ao carregar a pasta com `PlayerDebugMode`
desligado.

Esse é o portão que teria pego o pacote sem assinatura chegando ao cliente.

Para distribuição pública, `verify-release.ps1 -RequireSignedTauri` acrescenta
um portão Authenticode: exige o executável Tauri final, seleciona exatamente um
setup NSIS cujo nome corresponda ao `productName` e à versão de
`tauri.conf.json`, e reprova ambos se `Get-AuthenticodeSignature` não retornar
`Valid`. Setups ausentes, de versão antiga ou ambíguos também são reprovados.

## Testes

Os testes cobrem instalação CEP a partir de `.zxp`, política SemVer de
upgrade/preservação/reparo/downgrade explícito, recuperação transacional,
rollback, crashes antes/depois do commit sem BundleId duplicado, seleção da raiz
nativa x64 mesmo sob PowerShell de 32 bits,
ausência de plugins, limpeza de AEX legado, preservação de arquivo alheio,
junction CEP sem tocar no alvo, limites e caminhos ZIP hostis e o mesmo conjunto
compartilhado de XMLs adversariais nos parsers Node, PowerShell e Rust. Os gates
de release também reprovam certificado alheio, pacote sem assinatura, pacote
adulterado, timestamp inválido, pasta de build e lista de pins vazia, além de
compilar os hooks sem `ExecWait`:

```powershell
npm run installer:test
```

Esses testes não substituem o smoke test em uma máquina limpa com
`PlayerDebugMode` desligado. A assinatura Authenticode do EXE/setup também é um
gate separado da assinatura CEP e não deve ser considerada aprovada por esta
suite.

Logs:

```text
%LOCALAPPDATA%\Arizona Installer\logs\installer.log
```
