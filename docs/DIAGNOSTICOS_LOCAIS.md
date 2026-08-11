# Diagnósticos locais do Arizona

**Status:** contrato operacional vigente

**Atualizado em:** 11/08/2026

**Fontes da verdade:** `src-tauri/src/diagnostics.rs` e
`ARIZONA-EXTENSION/src/js/main/services/localDiagnostics.ts`

Este documento define o contrato compartilhado entre o Arizona App e a
extensão CEP para registrar eventos e falhas técnicas na própria máquina. Os
dois projetos implementam o contrato separadamente: nenhum importa código do
outro.

Os diagnósticos **não são enviados automaticamente** ao Supabase nem a outro
serviço. Para compartilhar um diagnóstico, o usuário precisa exportar o pacote
e enviá-lo conscientemente ao suporte.

## Pasta e configuração

No Windows, a pasta padrão é:

```text
%LOCALAPPDATA%\com.pc.arizona-app\logs
```

O Arizona App mantém a escolha de pasta neste arquivo fixo:

```text
%LOCALAPPDATA%\com.pc.arizona-app\diagnostics-config.json
```

O formato atual é:

```json
{
  "schemaVersion": 1,
  "directory": null
}
```

- `schemaVersion` é obrigatório para o Tauri e vale `1` neste contrato.
- `directory: null` seleciona a pasta padrão.
- Para uma pasta personalizada, `directory` contém seu caminho local absoluto.
- Caminho relativo ou de rede/UNC, arquivo ausente, JSON inválido ou campo sem
  uma string utilizável fazem o leitor usar a pasta padrão.

O arquivo de configuração permanece no diretório local fixo mesmo quando os
logs são movidos. O Tauri é responsável por gravá-lo; o CEP apenas lê esse
contrato. Não é necessário nem recomendado editar o JSON manualmente.

A gravação atual cria um arquivo temporário no mesmo diretório, sincroniza seu
conteúdo e o move sobre a configuração anterior de forma atômica. No Windows, a
substituição também solicita escrita imediata ao sistema operacional. Isso evita
que o CEP observe um JSON truncado durante a troca normal. O fluxo suportado
continua sendo a tela de Configurações; não edite o arquivo manualmente enquanto
o Arizona App ou o After Effects estiverem abertos.

Se a pasta configurada não puder ser criada ou usada para uma gravação, os
gravadores tentam a pasta padrão. O Tauri expõe essa diferença nestes campos de
localização do status:

| Campo | Significado |
|---|---|
| `directory` | Pasta selecionada e persistida no contrato. |
| `activeDirectory` | Pasta realmente acessível e usada naquele momento. |
| `defaultDirectory` | Pasta padrão calculada pelo aplicativo. |
| `isCustom` | A seleção persistida não é a pasta padrão. |
| `usingFallback` | A pasta ativa é diferente da selecionada. |
| `warnings` | Avisos de fallback ou migração parcial. |

O CEP resolve o destino novamente para cada evento: tenta primeiro `directory`
e depois a pasta padrão. Assim, ele acompanha uma mudança feita pelo Tauri e
também volta à pasta selecionada quando ela se torna acessível novamente. O
registro é de melhor esforço: uma falha no diagnóstico não deve interromper a
operação principal do aplicativo ou do painel.

## Arquivos produzidos

Cada processo mantém seu próprio arquivo diário:

| Componente | Nome |
|---|---|
| Arizona App, núcleo Rust e interface Tauri | `arizona-tauri-AAAA-MM-DD.jsonl` |
| Painel CEP e chamadas ao ExtendScript observadas pelo painel | `arizona-cep-AAAA-MM-DD.jsonl` |

A data do nome usa o calendário local da máquina. Os arquivos são separados
para evitar escrita concorrente entre processos. O ExtendScript não grava no
disco diretamente: o painel CEP registra o início, o resultado ou a falha da
operação e usa `runtime: "extendscript"` quando aplicável.

Durante uma mudança de pasta, um diário histórico pode receber um sufixo único,
como `arizona-cep-AAAA-MM-DD.part-1234-5.jsonl`. O sufixo identifica uma parte
migrada e evita concatenar um arquivo enquanto outro processo ainda pode estar
gravando. Somente os dois nomes diários acima e suas variantes `.part-ID`
estritamente reconhecidas pertencem ao sistema de diagnóstico. A limpeza, a
mudança de pasta e a exportação preservam arquivos não relacionados que estejam
no mesmo diretório.

## Formato JSONL

Os arquivos usam UTF-8 e JSON Lines: cada linha contém um objeto JSON completo
e independente. Isso permite ler um evento por vez mesmo enquanto o arquivo do
dia continua recebendo registros.

Campos comuns:

| Campo | Conteúdo |
|---|---|
| `schemaVersion` | Versão do evento; atualmente `1`. |
| `timestamp` | Data e hora UTC em ISO 8601. |
| `eventId` | Identificador técnico único dentro da execução. |
| `sessionId` | Identificador efêmero da execução local. Não é identidade de pessoa, conta ou dispositivo. |
| `level` | `debug`, `info`, `warning` ou `error`. |
| `source` | Origem técnica, como `tauri-core`, `tauri-ui` ou `cep-panel`. |
| `component` | Domínio técnico da ação. |
| `action` | Ação técnica normalizada. |
| `status` | Estado da ação, por exemplo `started`, `completed`, `failed` ou `ready`. |
| `message` | Explicação técnica curta e humanizada. |
| `code` | Código enumerado opcional para uma falha conhecida. |
| `details` | Objeto opcional, limitado e sanitizado. |
| `recentActions` | Trilha curta incluída em avisos e erros quando houver contexto anterior. |

O CEP também grava `runtime` (`cep` ou `extendscript`), `sequence` e, quando uma
operação reúne várias etapas, `operationId`. Esses campos são específicos do
painel e não são obrigatórios nos eventos do Tauri.

Exemplo reduzido do Tauri:

```json
{"schemaVersion":1,"timestamp":"2026-08-11T14:32:18.125Z","eventId":"sessao-7","sessionId":"sessao","level":"error","source":"tauri-core","component":"diagnosticos","action":"exportar","status":"failed","code":"diagnostics_export_failed","message":"Não foi possível exportar o diagnóstico.","details":{"technicalMessage":"Acesso negado em <caminho-local>"},"recentActions":[{"timestamp":"2026-08-11T14:32:10.000Z","component":"diagnosticos","action":"abrir_configuracoes","status":"completed","message":"Configurações abertas."}]}
```

Exemplo reduzido do CEP:

```json
{"schemaVersion":1,"timestamp":"2026-08-11T14:35:02.481Z","eventId":"sessao-12","sessionId":"sessao","sequence":12,"level":"error","source":"cep-panel","runtime":"extendscript","component":"render","action":"iniciar_render","status":"failed","code":"render_failed","operationId":"render-123","message":"O After Effects não concluiu o render.","details":{"technicalMessage":"Arquivo indisponível em <caminho-local>"},"recentActions":[{"timestamp":"2026-08-11T14:34:59.000Z","component":"render","action":"preparar_render","status":"started","message":"Preparação do render iniciada."}]}
```

Os valores dos exemplos são ilustrativos. Consumidores devem tolerar campos
opcionais ausentes e campos novos em versões compatíveis do contrato.

### Trilha anterior ao erro

Cada processo conserva em memória até 30 ações técnicas recentes. Ao registrar
um evento `warning` ou `error`, inclui em `recentActions` no máximo as 12 ações
anteriores, em ordem cronológica. Cada item contém somente `timestamp`,
`component`, `action`, `status` e `message`.

A trilha ajuda a reconstruir a sequência que levou à falha usando operações
técnicas enumeradas, sem gravar cliques genéricos ou conteúdo de projeto. Ela é
reiniciada com o processo e não é uma gravação de tela nem um histórico de
navegação.

### Filas e gravação de melhor esforço

Tauri e CEP não fazem a escrita de disco no caminho principal da ação do
usuário. Cada um mantém uma fila em memória de até 512 eventos e grava seus
payloads sequencialmente:

- a interface do Tauri despacha os eventos em ordem sem aguardar o diagnóstico;
  o núcleo usa uma thread de escrita e rejeita um evento novo se sua fila já
  estiver cheia;
- o CEP agenda gravações assíncronas pelo Node e, ao atingir o limite, descarta
  o evento pendente mais antigo antes de aceitar o novo.

Essa política impede que uma pasta lenta ou indisponível paralise a interface.
Em contrapartida, um encerramento abrupto, uma fila saturada ou falha nos dois
destinos pode fazer um diagnóstico não chegar ao arquivo. O sistema não promete
entrega durável de todos os eventos.

Antes de mudar a pasta ou exportar, o Tauri tenta esvaziar a própria fila com
espera limitada. O CEP abandona uma tentativa de destino que não responde em 8
segundos e tenta o fallback, mas o Tauri não controla essa fila independente;
aguarde as gravações recentes do CEP aparecerem no arquivo. O encerramento
normal também tenta drenar o Tauri sem transformar uma pasta travada em espera
infinita.

## Retenção de 14 dias

A retenção é local e automática. O sistema mantém o dia atual e os 13 dias de
calendário anteriores; arquivos reconhecidos com data mais antiga são apagados
durante a inicialização e as revisões periódicas do diretório.

O Tauri revisa tanto a pasta ativa quanto a selecionada e a padrão, sem duplicar
caminhos equivalentes. O CEP revisa suas pastas selecionada e de fallback. Assim,
arquivos criados durante um fallback continuam sujeitos à mesma retenção quando
o destino personalizado volta.

Se uma queda interromper uma cópia entre unidades, o temporário interno da
migração também expira pela data do diário após 14 dias. Ele não é tratado como
um log completo e, por isso, não entra em mudanças de pasta nem na exportação.

A data considerada é a do nome do arquivo. Alterar o relógio da máquina ou
renomear um arquivo pode afetar a limpeza. Arquivos com outro nome não são
apagados pelo Arizona.

## Configurações, mudança e migração

Em **Configurações > Diagnóstico**, o usuário pode:

- consultar a pasta selecionada, quantidade de arquivos, tamanho total e
  retenção das pastas locais conhecidas;
- usar **Escolher** para selecionar uma pasta local absoluta;
- usar **Padrão** para voltar a `%LOCALAPPDATA%\com.pc.arizona-app\logs`;
- usar **Abrir pasta** para inspecionar os JSONL em `activeDirectory`, inclusive
  no destino temporário de fallback;
- usar **Exportar diagnóstico** para criar um pacote ZIP.

O After Effects precisa estar fechado durante a troca. Essa exigência permite
isolar o arquivo do CEP antes da transferência e evita perder uma linha que o
painel ainda estivesse acrescentando.

Ao trocar de pasta, o Tauri salva a nova configuração e tenta mover todos os
arquivos `arizona-tauri-*.jsonl` e `arizona-cep-*.jsonl` reconhecidos na pasta
que estava selecionada antes da mudança e no fallback padrão, quando distinto.
Cada arquivo recebe um nome histórico único `.part-ID`; os conteúdos nunca são
concatenados ao diário ativo. Na mesma unidade, a migração usa renomeações.
Entre unidades, ela copia uma parte já isolada, confirma e sincroniza a cópia
antes de remover a origem.

Uma migração pode ser parcial se um arquivo estiver bloqueado, se faltar
permissão ou se o destino ficar indisponível. A tela informa quantos arquivos
foram movidos, confere de novo a origem e mostra avisos sobre os que permaneceram
na pasta anterior. Os novos eventos passam a seguir a configuração compartilhada.

## Exportação para suporte

**Exportar diagnóstico** conclui primeiro os eventos pendentes do Tauri e cria
um `.zip` em um destino local escolhido pelo usuário. A exportação inclui os
arquivos reconhecidos da pasta ativa, da selecionada e da pasta padrão, sem
duplicar diretórios equivalentes. Arquivos residuais recebem um subdiretório no
pacote. O conteúdo possível é:

```text
diagnostico.json
logs/arizona-tauri-AAAA-MM-DD.jsonl
logs/arizona-cep-AAAA-MM-DD.jsonl
logs/arizona-tauri-AAAA-MM-DD.part-ID.jsonl
logs/arizona-cep-AAAA-MM-DD.part-ID.jsonl
logs/residual-1/arizona-tauri-AAAA-MM-DD.jsonl
logs/residual-1/arizona-cep-AAAA-MM-DD.part-ID.jsonl
```

`diagnostico.json` resume horário de geração, versão do aplicativo, sistema,
arquitetura, retenção e quantidade de arquivos. O pacote não inclui
`diagnostics-config.json`, credenciais, sessão de autenticação ou recibo de
licença por desenho. O `sessionId` presente em cada evento é apenas a correlação
efêmera daquela execução do gravador. Se ainda não houver eventos, a exportação
pode conter apenas o resumo.

Criar o ZIP não o envia. O usuário decide se, quando e por qual canal vai
compartilhá-lo. O evento que registra a própria exportação é gravado depois de
fechar o pacote e, portanto, só aparece em uma exportação posterior.

## Privacidade e limites

Antes de persistir strings, os dois gravadores aplicam saneamento equivalente:

- substituem e-mails por `<email>`;
- removem padrões de token, JWT, senha, segredo e código de ativação;
- removem parâmetros de consulta de URLs;
- substituem caminhos locais do Windows e caminhos de rede por
  `<caminho-local>` e mascaram diretórios conhecidos do perfil;
- removem quebras de linha e limitam cada texto a 1.200 caracteres;
- limitam detalhes a 4 níveis, 20 itens por lista e 32 campos por objeto;
- normalizam os identificadores usados em chaves, componentes e ações.

O saneamento é uma defesa de melhor esforço, não uma garantia de anonimização.
Novos eventos devem evitar na origem nomes de cliente, produto ou projeto,
briefings, texto digitado, conteúdo criativo, caminhos, URLs completas,
capturas de tela e qualquer credencial. Logs locais ainda são dados técnicos e
devem ser armazenados e compartilhados com cuidado.

Os JSONL e o ZIP não recebem criptografia própria do Arizona. A proteção depende
das permissões e da segurança do destino. Caminhos de rede/UNC são recusados.
Uma pasta local sincronizada por outro software ainda pode ser copiada por esse
terceiro; isso não é um envio feito pelo Arizona, mas deixa de ser armazenamento
restrito ao dispositivo. Para o comportamento estritamente local, use uma pasta
local não sincronizada. A expiração remove os arquivos reconhecidos normalmente,
sem prometer apagamento forense dos blocos no dispositivo.

A sequência local pode revelar quais fluxos técnicos foram executados durante o
período, mas não é enviada nem agregada como telemetria de funcionalidades e não
identifica deliberadamente a pessoa, a conta, a organização ou o dispositivo.
Também não substitui `licensing.audit_log`: a auditoria remota continua restrita
às ações essenciais de segurança, licenciamento e administração, com finalidade
e retenção próprias.

## Solução de problemas

### Nenhum arquivo do CEP aparece

- O gravador do CEP depende do Node disponível dentro do painel Adobe. No modo
  navegador/HMR fora do CEP ele não grava arquivo local.
- Abra o painel instalado no After Effects, execute uma ação e procure o arquivo
  `arizona-cep-AAAA-MM-DD.jsonl`.
- Confirme se o CEP foi reiniciado depois de atualizar a extensão.

### Os logs aparecem na pasta padrão, não na escolhida

- Verifique se a pasta personalizada ainda existe e permite criação de arquivos.
- Abra **Configurações > Diagnóstico** para conferir a pasta selecionada e o
  aviso **Destino temporário**, que mostra `activeDirectory` durante o fallback.
- Uma falha de escrita faz cada gravador tentar a pasta padrão. Quando o destino
  selecionado voltar, eventos novos podem voltar para ele e deixar o período
  dividido entre as duas pastas.
- O status, a retenção e a exportação também consideram o fallback conhecido. Ao
  escolher outra pasta com o After Effects fechado, o Tauri tenta migrar esses
  arquivos junto com os demais.

### Alguns arquivos ficaram na pasta anterior

- Feche o After Effects antes de copiar manualmente os arquivos restantes ou de
  escolher uma pasta diferente.
- Consulte o aviso exibido na mudança; arquivos bloqueados permanecem no local
  anterior para não perder dados.
- O Tauri volta a procurar resíduos na pasta padrão, mas não conhece uma pasta
  antiga arbitrária depois que outra seleção foi confirmada. Se necessário,
  copie esses arquivos manualmente antes que completem 14 dias. Não edite ou
  concatene JSONL enquanto o Arizona App ou o painel CEP estiverem abertos.

### A configuração foi corrompida ou alterada manualmente

Abra as configurações e use **Padrão**. Enquanto o JSON estiver ausente,
inválido ou apontar para um caminho relativo, os leitores usam a pasta padrão.

### Uma linha JSONL está incompleta

Uma interrupção durante a gravação pode deixar a última linha inválida. Ignore
somente essa linha ao analisar o arquivo; cada uma das anteriores é um JSON
independente. Preserve o arquivo original ao encaminhá-lo para investigação.

### O ZIP está vazio ou não contém o evento mais recente

O pacote inclui os arquivos reconhecidos nas pastas locais conhecidas no momento
da exportação. Confira `activeDirectory`, procure avisos de fallback ou migração
e, para um evento do CEP recém-ocorrido, aguarde a gravação assíncrona aparecer
no JSONL antes de tentar novamente. A própria ação de exportar entra apenas no
próximo pacote.

## Checklist para novos eventos

Antes de adicionar um evento no Tauri ou no CEP:

1. use `component`, `action`, `status` e `code` estáveis e enumeráveis;
2. escreva uma mensagem curta que explique a etapa sem expor conteúdo do
   usuário;
3. use `details` somente para contexto técnico mínimo e limitado;
4. conecte etapas relacionadas por `operationId` no CEP quando isso melhorar o
   diagnóstico;
5. teste o JSONL, a trilha de erro e os padrões de saneamento;
6. preserve os nomes de arquivo, o formato de configuração e a retenção nos
   dois projetos, sem compartilhar imports de runtime.
