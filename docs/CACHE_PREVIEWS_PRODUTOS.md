# Cache compartilhado de previews dos produtos

**Status:** operacional  
**Última revisão:** 2026-08-06  
**Fontes da verdade:** `src-tauri/src/product_preview_cache.rs` e
`ARIZONA-EXTENSION/src/js/main/domains/ofertas/productImages/services/prewarmedPreview.ts`

Este documento define o contrato em disco entre o Arizona App (Tauri) e a
extensão CEP para antecipar miniaturas de produtos. Os projetos continuam
independentes: nenhum importa código do outro e não existe envio de comandos do
Tauri ao painel.

## Quando o cache é preparado

O aquecimento começa em segundo plano depois que o comando **Abrir no After**
consegue localizar e disparar o `.aep` do Jobinho.

- O After Effects não espera o cache terminar.
- A unidade de deduplicação é o código do Jobão, pois `PRODUTOS` pertence ao
  Jobão e é compartilhado por seus Jobinhos.
- Um Jobão concluído não inicia outra fila durante a mesma execução do app.
- Depois de reiniciar o app, uma varredura rápida compara os arquivos com o
  cache persistente e gera somente chaves ausentes.
- Um manifesto deixado como `preparing` por interrupção não bloqueia a retomada.

## Diretórios

Raiz compartilhada:

```text
%LOCALAPPDATA%\Arizona Carrefour\Product Viewer\preview-cache\prewarmed-v1\
```

Estrutura:

```text
prewarmed-v1\
  files\
    <cacheKey>.png
  jobs\
    <jobao>.json
  tasks\
    <arquivos temporarios durante o aquecimento>
  arizona-product-preview-v1.ps1
```

Os previews são PNG de até `512 x 512`, obtidos pelo thumbnail provider do
Windows. Cada arquivo é gravado em um temporário e movido para o nome final;
assim, o CEP nunca deve observar um PNG parcialmente escrito.

## Identidade e invalidação

O Jobão organiza e deduplica a fila, mas não define sozinho a validade de uma
miniatura. A chave de cada arquivo é:

```text
sha256(
  lowerCase(caminhoAbsolutoComBarrasInvertidas)
  + U+001F + tamanhoEmBytes
  + U+001F + modifiedAtEmMilissegundosTruncado
  + U+001F + "512"
)
```

Vetor de compatibilidade:

```text
caminho: i:\job\produtos\item.psd
tamanho: 42
modifiedAt: 1000
tamanhoPreview: 512
cacheKey: 15a0f4d5d4a0c021fc07d3f127b3d504a5391c604c86312c9dd50dcc5a61af9d
```

Alterar path, tamanho ou data de modificação produz outra chave. Isso permite
que uma imagem atualizada pelo Google Drive seja regenerada sem invalidar o
restante do Jobão.

## Manifesto por Jobão

Cada manifesto registra:

- versão do contrato;
- código do Jobão e path de `PRODUTOS`;
- estado `preparing` ou `complete`;
- horário da última varredura;
- path, tamanho, modificação, chave e disponibilidade de cada preview.

Falhas individuais do thumbnail provider são registradas como indisponíveis
quando a execução chega a `complete`. O CEP continua capaz de interpretar o
arquivo original e gerar seu preview localmente.

## Leitura pelo CEP

Antes de ler PNG ou interpretar PSD, o CEP calcula a mesma chave e procura
`files\<cacheKey>.png`.

1. Se o arquivo existir, ele é usado imediatamente.
2. Se ainda estiver sendo preparado ou não estiver disponível, o fluxo local
   anterior continua sem erro.
3. A limpeza de cache existente remove também `prewarmed-v1`; a próxima
   abertura de um Jobinho volta a aquecer o Jobão.

## Evolução do contrato

Qualquer alteração na normalização, algoritmo de hash, tamanho ou formato deve
criar uma nova pasta versionada (`prewarmed-v2`, por exemplo) e ser implementada
nos dois projetos. Nunca reutilize `prewarmed-v1` com semântica diferente.
