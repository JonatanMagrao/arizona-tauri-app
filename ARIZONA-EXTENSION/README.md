# Arizona Extension (CEP — After Effects)

Painel CEP do Arizona para After Effects: edição de ofertas e roteiro, com
botão de render local.
Construído sobre [Bolt CEP](https://hyperbrew.co/resources/bolt-cep)
(React + Vite + TypeScript); a documentação do framework fica no site do Bolt,
não aqui.

Este projeto é **independente**: não importa nada do Tauri, do plugin AEX nem
do admin. A única relação com o resto do ecossistema é por contrato:

- lê o recibo de licença `cep-license-receipt.json` gravado pelo Arizona App em
  `%LOCALAPPDATA%\com.pc.arizona-app\`;
- consulta primeiro o cache de previews preparado pelo Arizona App conforme o
  contrato `../docs/CACHE_PREVIEWS_PRODUTOS.md`, mantendo geração local como
  fallback;
- lê `diagnostics-config.json` para gravar seu próprio JSONL na pasta local
  escolhida no Arizona App, conforme `../docs/DIAGNOSTICOS_LOCAIS.md`;
- no build, embute as chaves públicas do manifesto versionado
  `../ADMIN/supabase/license-trusted-keys.json` (única exceção de fronteira,
  build-time e dado público — ver `AGENTS.md` na raiz do repo).

## Licença / bloqueio

- Sem recibo válido, o painel mostra "Painel indisponível" e uma mensagem
  humana explicando o motivo e o que o usuário pode fazer.
- A validação roda a cada 5s; o Arizona App renova o recibo enquanto aberto.
- `src/js/main/services/licenseTrustedKeys.generated.ts` é **gerado** — nunca
  edite na mão. Rotação de chaves: ver `../docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`
  na raiz do repo.
- No navegador (fora do CEP), o painel roda destravado (`browser_dev`).

## Diagnóstico local

Dentro do Adobe CEP, o painel usa o Node do host para gravar
`arizona-cep-AAAA-MM-DD.jsonl`. O ExtendScript não escreve arquivos de log
diretamente; o painel registra as etapas observadas e marca
`runtime: "extendscript"` quando aplicável. A gravação é sequencial e
assíncrona; cada evento tenta a pasta selecionada e depois o fallback local.

A pasta é escolhida em **Configurações > Diagnóstico** no Arizona App e o
fallback é `%LOCALAPPDATA%\com.pc.arizona-app\logs`. A retenção mantém o dia
atual e os 13 anteriores. Não existe envio automático: o usuário exporta e
compartilha o pacote somente quando desejar. Formato, saneamento, migração e
solução de problemas: `../docs/DIAGNOSTICOS_LOCAIS.md`.

## Mecânicas de ofertas suportadas

A extensão reconhece sete famílias atuais: `SIMPLES`,
`DE X POR Y PARCELAMENTO`, `DE X POR Y | X% DESCONTO | LEVE X PAGUE Y`,
`DESCONTO R$ CARTAO CRF`, `TODOS A COM LEVE X PAGUE Y`,
`TODOS A COM X% DESCONTO` e `DE X POR Y MEU CRF POR Z CARTAO CRF`.
O alias `TODOS A LEVE X PAGUE Y` pertence à mesma família Todos A Com.

A identificação tenta primeiro o Comments da precomp de origem e depois seu
nome. Duplicações com sufixo numérico continuam aceitas. As 11 famílias antigas
foram descontinuadas e aparecem como mecânica não mapeada quando nenhuma das
identificações corresponder a uma família atual; não há migração automática dos
arquivos do After Effects.

Consulte o [mapa de nomes do template](src/js/assets/template-identities.json) e o
[alcance da limpeza](../docs/REVISAO_LIMPEZA_MECANICAS_CEP.md).

## Camadas dentro das ofertas

O Editor, suas ações e o Roteiro associam cada produto pelos comentários das
camadas externas, sem depender da ordem das camadas na precomp da oferta:

| Conjunto | Descritivo | Mecânica | Imagem |
|---|---|---|---|
| 1 | `DESCRITIVO 1` | `MECANICA 1` | `PRODUTO 1` |
| 2 | `DESCRITIVO 2` | `MECANICA 2` | `PRODUTO 2` |
| 3 | `DESCRITIVO 3` | `MECANICA 3` | `PRODUTO 3` |

O número identifica o conjunto lógico: `product.index` é esse número menos um.
Os conjuntos ativos são apresentados nessa ordem, mesmo quando as camadas
estão invertidas na timeline. Um descritivo único desativado torna todo o seu
conjunto inativo; isso não renumera os demais. Um número inteiramente ausente
não é obrigatório. Papéis ausentes, comentários duplicados ou origens inválidas
bloqueiam a edição do conjunto afetado; outros conjuntos válidos continuam
editáveis. Descritivo e mecânica precisam ter origem `CompItem`; imagem pode ter
origem `FootageItem` ou `CompItem`, mas a substituição da imagem pelo painel
continua exigindo origem direta `FootageItem`.

A precomp legal externa é localizada por `TEXTO LEGAL`, em qualquer posição.
Dentro dela, texto legal continua na camada 3 e os demais controles legais
preservam suas posições e efeitos. A tarja Eletro/Pneu tem resolução própria,
descrita abaixo. Dentro da precomp descritiva, o texto continua sendo
encontrado pelo nome `DESCRITIVO`.

O fallback destas camadas é controlado por `fallback.offerLayers` no
[template-identities.json](src/js/assets/template-identities.json), ativado
por padrão e independente do fallback das mecânicas. Se ativado, aceita somente
os nomes e aliases declarados no mapa quando nenhum comentário corresponder.
A comparação ignora maiúsculas/minúsculas e espaços externos, preservando
acentos. Comentário reconhecido de outra função ou número prevalece sobre o
nome; comentários duplicados não liberam fallback. Não há fallback por índice,
adjacência ou nomes anteriores não declarados. O asset é relido na próxima
operação; a edição do arquivo de origem exige build para atualizar a distribuição.

Na troca de produtos, comentários permanecem na camada e as origens, escalas e
nomes visuais são trocados. Nomes usados como fallback permanecem em suas
camadas para preservar a identidade. A extensão não preenche comentários no
`.aep` automaticamente.

O comentário externo `MARCADORES` possui localizador disponível, mas nenhuma
operação atual o consome. Não é obrigatório para os produtos e não altera os
marcadores da timeline nem os jumps internos das mecânicas. O schema oficial
das mecânicas abaixo continua configurando apenas suas camadas internas.

## Tarja Eletro/Pneu

O menu é reconstruído a partir da precomp `TARJA_ELETRO_PNEU` da oferta
selecionada, incluindo ofertas importadas. Não existe uma lista global de textos
nem um intervalo fixo de índices. Os comentários `ELETRO` e `PNEU` identificam
os dois textos fixos; camadas de texto sem comentário são opções adicionais.
O dropdown usa o nome atual de cada camada, na ordem da timeline, de cima para
baixo. Adições, remoções e renomeações aparecem na próxima leitura do snapshot.

`CONTROL` e `TARJA` identificam a infraestrutura e ficam fora do menu, assim
como imagens e outras camadas sem texto. `CARTAO CONTROL` mantém os vínculos
das imagens; selecionar uma opção altera somente a visibilidade dos textos
elegíveis. O checkbox Eletro/Pneu controla a camada externa e preserva a opção
interna escolhida. A extensão não reorganiza nem recolore o projeto em runtime.

O mapa `banners.eletroPneu` em `template-identities.json` reúne os nomes da
precomp, os quatro comentários e os aliases das camadas fixas. O nome da
precomp identifica sua estrutura dentro da oferta; `fallback.offerLayers`
controla os aliases de camadas quando faltam comentários. Os textos dinâmicos
não precisam ser cadastrados no JSON. Identidades fixas ausentes ou duplicadas
bloqueiam o menu sem escolher uma camada arbitrariamente.

A seleção e o checkbox carregam um contexto do projeto, oferta, precomp e
lista apresentada. Se essa estrutura mudar antes do clique, a ação é recusada
e solicita atualização, sem usar o índice antigo em uma nova lista. Falhas na
escrita restauram as visibilidades anteriores dentro do grupo de undo.

## Troca de réguas da oferta

O botão **Régua**, ao lado das opções do texto legal, lista as precomps da
pasta da oferta selecionada. A camada em `Miolo` é identificada pelo comentário
`CAMADA OFERTA 01`, `CAMADA OFERTA 02` etc.; a pasta correspondente no painel
Project usa o comentário `OFERTA 01`, `OFERTA 02` etc., com zero à
esquerda para números de um dígito. O comentário `OFERTA 1` não substitui
`OFERTA 01`.

As réguas são identificadas pelos comentários dos itens `CompItem` diretamente
dentro dessa pasta: `OFERTA REGUA 2 PRODUTOS`, `OFERTA REGUA 2 PRODUTOS ELETRO`,
`OFERTA REGUA 3 PRODUTOS` e `OFERTA SIMPLES`. Na ausência de correspondência
por comentário, as flags do mapa permitem nomes como `Oferta_01`, `OFERTA 01`
e os nomes declarados das réguas. A busca continua limitada à pasta da oferta.
Ausências e duplicidades são
informadas no seletor, sem escolher um item arbitrariamente. O tooltip da
mensagem ou da opção indisponível indica o comentário esperado e onde
preenchê-lo no After Effects.

A seleção troca somente o source da camada em `Miolo`, sem copiar conteúdo
entre precomps, ajustar transformações ou mudar a posição na timeline. A ação
tem undo e revalida a oferta, a pasta e a origem antes da troca. O catálogo e a
resolução ficam em `domains/ofertas/offers/`; a mutação fica em `actions/`,
separada da troca de conteúdo entre duas ofertas já existente.

## Troca de mecânicas do produto

O nome da mecânica no card abre o seletor das sete mecânicas, único seletor no
cabeçalho. As opções internas de variação, quando existentes, ficam na área de
configurações abaixo dos preços. A busca usa a mesma
pasta da oferta identificada por `OFERTA 01`, `OFERTA 02` etc. Dentro dela,
a subpasta direta das mecânicas é identificada por `MECANICAS`. As precomps
podem estar em qualquer nível de subpastas dessa pasta; os nomes e comentários
das subpastas intermediárias não são usados.

A identificação prioriza o comentário do item no painel Projeto:

- **Simples:** `SIMPLES 1`, `SIMPLES 2` etc., de acordo com o número do produto.
- **Demais mecânicas:** uma precomp por comentário: `TODOS A COM X% DESCONTO`,
  `DESCONTO R$ CARTAO CRF`, `DE X POR Y PARCELAMENTO`,
  `DE X POR Y MEU CRF POR Z CARTAO CRF`,
  `DE X POR Y | X% DESCONTO | LEVE X PAGUE Y` e `TODOS A COM LEVE X PAGUE Y`.

Com `fallback.projectItems` ativo, o mapa permite `_MECANICAS` e os aliases
de precomps explicitamente declarados quando não há correspondência por
comentário. `SIMPLES {n}` é expandido para o número do produto; os sufixos das
outras famílias são aliases do item, não números de produto. Duplicidades de
comentário ou nome continuam bloqueando a opção. Subpastas intermediárias
continuam sem participar da identificação.

A troca substitui somente o source da camada com comentário `MECANICA 1`,
`MECANICA 2` etc. na régua atual, preservando nome, comentários, transformações
e timing. Não copia valores nem cria precomps. Ausências e duplicidades deixam
a opção indisponível com tooltip informando o comentário e o local da correção.
A operação revalida as referências, recusa ciclos entre precomps e possui undo.
O catálogo em `domains/ofertas/offers/` concentra a política de cópias por
produto; atualmente apenas Simples usa essa política.

## Configuração das mecânicas

O [schema.json das mecânicas](src/js/assets/schema.json) é a configuração
oficial das sete mecânicas. `copyAssets` em `cep.config.ts` copia esse arquivo
para `dist/cep/js/assets/schema.json`, preservando o JSON como arquivo separado.
O bootstrap informa ao host o caminho `js/assets/schema.json` dentro da extensão.
O [teste.json na raiz](../teste.json) permanece como exemplo do formato
aprovado; não é consumido pelo runtime nem pelos testes da extensão.

Edite os valores de `layers` para mudar os comentários esperados das camadas.
Em `effects`, `layer` referencia uma chave de `layers`, `index` é a posição do
efeito e `name` é seu nome. Parcelamento e Meu CRF/Cartão preservam a busca pelo
nome; o índice preenchido nesses dois controles não muda essa regra.
Nos demais efeitos, a posição continua sendo usada e `name` documenta a função.
As opções usam `index` como valor escrito no After e `label` como texto exibido.
A seleção do painel continua começando em zero, com conversão interna para o
valor configurado. Quantidade X é numérica e não possui `options`.

As chaves das mecânicas, camadas e efeitos são contratos fixos. Preserve também
a ordem das opções: suas posições controlam partes do layout. Labels e valores
AE podem ser editados sem alterar os IDs, formatos, labels internos do Roteiro,
regras de localização, fallback e comportamento dos jumps, que ficam no código.
Os nomes antigos explicitamente aceitos para controladora e jumps permanecem
como aliases de fallback em `template-identities.json`.

O host lê diretamente o arquivo, sem embutir os dados no bundle e sem módulo
TypeScript gerado. Cada snapshot ou ação fixa uma única configuração validada;
ela não muda no meio das escritas. A próxima operação lê novamente o asset,
inclusive quando houve erro na leitura anterior. Um JSON inválido bloqueia os
controles da mecânica e informa o erro, sem usar uma configuração antiga.
Descrição, imagem e texto legal continuam independentes dessa configuração.

O build e o leitor usam o mesmo parser e validador. São verificados UTF-8,
sintaxe JSON, chaves duplicadas (incluindo escapes), versão, os sete contratos,
ausência de `null`, referências, índices, opções e comentários únicos.
Para validar somente o arquivo de origem, execute `npm run mechanics:schema`.
Os hooks de build, desenvolvimento, watch e testes executam essa validação.

Para publicar uma edição de `src/js/assets/schema.json`, rode `npm run build`;
o build copia o JSON para o payload. Após o primeiro build com o novo leitor,
no ambiente de desenvolvimento é possível editar diretamente
`dist/cep/js/assets/schema.json` e atualizar as ofertas para testar sem
recompilar ou recarregar o painel. Um build seguinte repõe o asset a partir
do arquivo de origem; leve os ajustes aprovados de volta para a origem.

Na instalação oficial, o JSON faz parte da assinatura do CEP. Alterações
distribuídas aos clientes exigem reempacotamento e assinatura; não edite o
payload assinado instalado. O leitor não modifica o JSON nem os arquivos `.aep`.

## Mapa de nomes e fallback

[`src/js/assets/template-identities.json`](src/js/assets/template-identities.json)
é o mapa distribuído de nomes de camadas, pastas e precomps. `copyAssets` o
copia para `dist/cep/js/assets/template-identities.json`; o bootstrap configura
seu caminho no host junto ao `schema.json`. Não há cópia embutida no bundle.

As três flags booleanas vêm ativadas:

- `fallback.offerLayers`: camadas externas dos produtos, texto legal, aliases
  das tarjas e camada da oferta usada na listagem, navegação, ações e seletores.
- `fallback.mechanicLayers`: camadas internas das sete mecânicas, incluindo
  controladoras e jumps.
- `fallback.projectItems`: pastas, precomps dos seletores e reconhecimento da
  família da precomp de origem por nome.

`false` exige correspondência por comentário nessa categoria. Comentários
reconhecidos têm prioridade; duplicidades não liberam fallback. Um comentário
que identifica outra função não pode ser substituído pelo nome da camada.
Nomes ambíguos, tipos incorretos e alvos fora da pasta esperada são recusados.

`offerLayers`, `projectItems` e `layouts` associam `comment` e `names`.
`{n}` representa o número sem zero inicial e `{nn}` com pelo menos dois dígitos.
`mechanics` é indexado pelas sete chaves oficiais do schema: `comment`/`names`
servem ao seletor, `sourceNames` reconhece a família (admitindo sufixo de
duplicação), e `layers` declara aliases pelas chaves das camadas internas.
Os comentários dessas camadas continuam exclusivamente em `schema.json`.
`named` reúne os nomes já usados diretamente: `Miolo` e o texto `DESCRITIVO`.

O mapa contém aliases seguros observados no template, como `_MECANICAS`,
`TEXTO LEGAL_01` até `TEXTO LEGAL_06` e `POR CENTAGEM DESCONTO`. Nomes de imagens
e nomes antigos da origem de uma camada de mecânica não identificam com
segurança a posição do produto; nesses casos, preserve o comentário ou use
um nome explicitamente mapeado. Não há inferência pela posição na timeline.

Cada operação fixa uma única versão validada do mapa até terminar suas
leituras e escritas; a próxima operação relê o asset. Arquivo ausente ou
inválido bloqueia a resolução, sem reaproveitar versão antiga. O build e o
host verificam versão, booleanos, chaves, aliases duplicados, colisões,
placeholders, JSON estrito e UTF-8. `npm run template:identities` valida o
arquivo de origem. No desenvolvimento, editar o asset em `dist` vale na próxima
operação; leve a alteração para `src` antes do próximo build. Na distribuição
oficial, o JSON integra o payload assinado e mudanças exigem reempacotamento
e assinatura. O mapa nunca renomeia nem preenche comentários no After Effects.

## Mecânica Meu CRF e Cartão CRF

O Comments da precomp `DE X POR Y MEU CRF POR Z CARTAO CRF` identifica a
mecânica implementada em `src/jsx/aeft/domains/ofertas/mechanics/meuCrfCartao.ts`.
As camadas internas são localizadas por `Layer.comment`, sem índice fixo:
`CONTROLADOR DE MECANICA`, `MARCADORES`, `PULO PRECO MEU CRF`,
`PULO PRECO CARTAO CRF`, `PRECO DE`, `PRECO POR` e `PRECO POR CARTAO`.
O comentário atual do jump do cartão no schema oficial é `PULO PRECO CARTAO CRF`.

O fallback por nome é controlado por `fallback.mechanicLayers` em
`template-identities.json` e fica ativado por padrão. Quando ativado, tenta os
nomes configurados somente se nenhum comentário corresponder. Comentários ou
nomes ambíguos não escolhem uma camada arbitrária. Os nomes aceitos, incluindo
os aliases anteriores dos jumps, estão no
[mapa de nomes](src/js/assets/template-identities.json).

O editor mantém os três preços e seus IDs internos. O dropdown nativo chamado
`Unidade` é procurado **somente na controladora identificada**, em qualquer
posição dos seus efeitos, com as opções `Cada`, `Kg`, `A cada 100g` e `Kg/cada`,
nessa ordem. Se estiver ausente ou houver mais de um dropdown válido com esse
nome nessa camada, apenas esse controle fica indisponível e a leitura registra
o erro.

O Jump alterna entre `Preço por` e `Preço por cartão`, usando o segundo marker
da camada identificada por `MARCADORES`. As três camadas precisam ser distintas.
A camada escolhida tem seu início visível alinhado ao marker; a outra é
deslocada para a duração da precomp. A migração não preenche comentários nem
altera os arquivos `.aep` automaticamente.

## Troca de projeto

O botão de pasta ao lado da engrenagem permite abrir outro `.aep` ou `.aepx`
dentro do After Effects. O seletor começa na pasta do projeto atual, permitindo
reabrir o mesmo arquivo ou navegar para outras pastas. Sem projeto salvo ou com
a pasta indisponível, usa a localização padrão do diálogo.
Primeiro escolhe o arquivo; em seguida, fecha o projeto
atual com a confirmação nativa para salvar alterações, limpa os caches do After
(`PurgeTarget.ALL_CACHES`) e abre o arquivo escolhido. Cancelar a escolha ou o
fechamento interrompe a operação. A limpeza de cache não apaga as miniaturas do
Arizona; no After Effects 24.3 ou mais recente, ela limpa RAM e cache de disco.

Após a abertura, o painel descarta os dados do projeto anterior e carrega a aba
ativa com os dados do novo projeto, inclusive ao reabrir o mesmo arquivo. A outra
aba carrega ao ser selecionada. A aba atual é mantida. Se a abertura falhar
depois de fechar o projeto anterior, o painel reflete o estado atual do After.
Se apenas a limpeza de cache falhar, a abertura continua e exibe um aviso.
Enquanto uma ação estiver em andamento, o botão fica indisponível.

Essa atualização ocorre ao abrir pelo botão do painel; não há consulta periódica
para detectar aberturas pelo menu do After Effects.

## Carregamento do roteiro

Ao voltar à aba Roteiro no mesmo projeto, o painel reaproveita o texto extraído
do DOCX se caminho, tamanho e datas de alteração dos metadados ainda coincidem.
O cache fica somente em memória, limitado a um documento de até 2 milhões de
caracteres. Trocar ou reabrir o projeto cria um cache novo; arquivo alterado,
ausente ou ilegível não reutiliza o texto antigo. O botão de atualização e a
escolha manual do DOCX forçam uma nova leitura completa.

Ao atualizar um roteiro já exibido, o conteúdo e a rolagem permanecem na tela
enquanto o ícone de atualização gira. As ações ficam bloqueadas até a consulta
terminar; falhas descartam a validação anterior e exibem a mensagem de erro.

A cada entrada na aba, o painel consulta novamente as ofertas no After para
validar os valores atuais. Essa consulta usa o mesmo resolvedor do Editor e lê
a mecânica do menor conjunto ativo de cada oferta, sem montar os dados de
imagens, descrições e textos legais do editor. Uma associação inválida nesse
primeiro conjunto, ou um número anterior com descrição duplicada ou ausente
mas com camadas órfãs, impede usar o preço de outro produto como substituto.
Erros em conjuntos posteriores não bloqueiam a leitura do primeiro válido.
Não há consulta periódica nem validações antigas em cache.

Os eventos locais de carregamento registram separadamente o tempo da consulta
ao After, da localização do DOCX e da leitura/reutilização do texto. Não gravam
o conteúdo do roteiro, nomes de arquivo ou caminhos.

## Render local

O CEP não executa `aerender` e não possui uma aba de render dedicada. O botão
**Render** do Roteiro apenas adiciona duas saídas à fila nativa do After
Effects: a composição `EXPORT` como MOV usando o modelo `PROXY` e a composição
`EXPORT_MP4` como MP4 usando o modelo `MP4`.

## Comandos

```powershell
npm run dev          # HMR (painel em localhost:3000; exige build prévio uma vez)
npm run build        # build de produção; embute chaves e atualiza a junction do CEP
npm run build:debug  # igual ao build, mas grava %LOCALAPPDATA%\com.pc.arizona-app\cep-license-debug.json
npm run license:keys # (roda sozinho nos pre-hooks) regenera o módulo de chaves
```

O pacote oficial assinado não é gerado pelo `npm run zxp` desta pasta, pois
esse comando do framework pode criar uma identidade descartável. Para gerar o
artefato distribuível com o certificado estável da Arizona, rode na raiz:

```powershell
npm run cep:zxp
```

A extensão instalada no Adobe CEP é uma junction criada pelo build:

```text
%APPDATA%\Adobe\CEP\extensions\com.arizona-carrefour.cep -> dist\cep
```

Depois de um build novo, reinicie o After Effects para recarregar o painel.

## Estrutura

```text
src/js/main/    painel React (UI, hooks, services) — ver src/js/main/AGENTS.md
src/jsx/aeft/   ExtendScript (manipulação do projeto AE) — ver src/jsx/aeft/AGENTS.md
src/js/lib/     runtime do Bolt CEP (csinterface, utils) — não editar sem necessidade
scripts/        gerador do módulo de chaves de licença
cep.config.ts   id, painel, portas e empacotamento
```

Regra de fronteira interna: o front (`js/main`) fala com o After Effects apenas
via `evalTS` através dos services de domínio; objetos nativos do AE só existem
em `src/jsx/aeft`.
