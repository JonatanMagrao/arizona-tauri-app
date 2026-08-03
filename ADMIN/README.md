# Arizona Admin

Projeto React/Vite separado para administrar o licenciamento do Arizona.

Este projeto concentra:

- painel web admin;
- Supabase migrations/functions;
- scripts de chave de licenca (`scripts/`) e o manifesto de chaves publicas
  confiaveis (`supabase/license-trusted-keys.json`).

ATENCAO: os scripts `license:keygen*` e `bridge:keygen*` fazem ROTACAO de
chave. Eles se recusam a sobrescrever chave existente sem `--force` e fazem
backup datado, mas gerar chave nova sem atualizar extensao/plugin bloqueia
usuarios validos. Leia `../LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md` antes.
Diagnostico de paridade: `npm run license:check` (aqui ou na raiz do repo).

Durante desenvolvimento:

```powershell
cd ADMIN
npm run dev
```

Abra a URL mostrada pelo Vite. A porta inicial e `1430`.
Ela é fixa porque faz parte da allowlist do Google OAuth e do Supabase. Feche o
processo que estiver usando a porta se o Vite não conseguir iniciar.

Depois do build, a pagina fica em `ADMIN/dist/index.html`.
Para testar o build:

```powershell
cd ADMIN
npm run build
npm run preview
```

Abra a URL mostrada pelo Vite. A porta inicial do preview e `1431`.
Ela também é fixa pela configuração de redirect OAuth.

Fluxo atual:

1. Criar o usuário master no Supabase Auth e vinculá-lo explicitamente em
   `licensing.master_accounts`.
2. Entrar no painel local exclusivamente com Google OAuth. O Supabase vincula a
   identidade Google ao usuário Auth existente quando o e-mail verificado é o
   mesmo; o backend ainda exige o vínculo explícito de `auth_user_id` em
   `licensing.master_accounts`. A sessão fica em `sessionStorage`: sobrevive a
   recarregamentos na mesma aba, mas é removida ao sair ou fechar a aba. Tokens
   expirados são renovados pelo refresh token. O painel bloqueia localmente
   depois de 30 minutos sem atividade e exige novo OAuth Google no máximo 8
   horas depois do login. Esses limites pertencem somente ao Admin; o ciclo
   diário da licença continua sendo o horário de renovação configurado, mas o
   app do usuário não pede autenticador nenhum.
3. Salvar a licença com seats, validade, renovação diária e usuários.
4. Apenas o master define quem é gestor, pelo toggle **Perfil** na lista de
   usuários deste painel. Salvar a licença preserva os papéis existentes: a
   linha marcada como **Gestor** continua `admin` e as demais continuam `user`.
5. A emissão de código acontece neste painel web e também na Gestão dentro do
   Arizona App: com a licença ativa, master e gestores emitem código para
   usuários permitidos. Na Gestão, o gestor administra somente usuários comuns
   — listar, adicionar (sempre como usuário), gerar código, liberar device e
   remover — nunca a si mesmo, outro gestor ou uma identidade master; as
   Functions `admin-*` aplicam essas mesmas regras no backend. Nomear ou
   rebaixar gestores continua exclusivo do master, neste painel.
6. O código de ativação/recuperação usa a validade configurada na licença, é de
   uso único e aparece em claro somente no resultado da emissão, com botão de
   copiar.
7. Não é possível emitir código para uma identidade master
   (`protected_identity`). Gestores também não emitem código para si nem para
   outro gestor.
8. O acesso do usuário é e-mail + código de 12 caracteres, sem autenticador.
   Concluída a ativação, ele não se autentica de novo naquela máquina: a
   confiança passa a ser do hardware, provado pelo `deviceFingerprintHash` que
   o app envia. Divergência de hardware devolve `device_not_active` e registra
   `device.fingerprint_mismatch` na auditoria. Uma validação que chega **sem**
   fingerprint — caso da v2.1.1, que nunca envia o campo — é recusada com
   `device_not_active` e a mensagem "Update the app to continue.",
   independentemente do que está gravado para aquele device.
9. Cadastrar máquina exige a concessão que o consumo do código emite. Só uma
   ativação respaldada por código pode gravar o fingerprint; a validação comum
   nunca grava. A concessão vale 30 minutos, é de uso único e é gasta antes de
   o device ser gravado, então um mesmo código cadastra no máximo uma máquina.
   Sem ela, a resposta é sempre `device_activation_expired` — o caminho é pedir
   um código novo. Uma máquina que não consegue se identificar (fingerprint
   vazio) é recusada com `device_identity_required` **antes** de gastar a
   concessão, então a mesma concessão continua válida para nova tentativa.
10. O vínculo de máquina vale para a frota inteira desde o primeiro dia: uma
    validação cujo device **não tem** fingerprint gravado é recusada com
    `device_not_active` e a mensagem "Reactivate this machine.", registrando
    `device.fingerprint_mismatch` com `outcome: "unbound"` na auditoria. Todo
    device que estava em campo precisa passar por uma ativação com código na
    2.2.0 — é essa ativação que grava o fingerprint. Na prática, cada usuário
    recebe um código novo junto com o instalador 2.2.0.
11. Somente o master pode suspender a licença inteira com **Suspender licença
    agora**, na seção da licença. A suspensão marca a organização como
    `paused`: toda validação passa a devolver `organization_not_active`, o app
    se esconde e mostra o motivo na janela de acesso em até ~30 segundos (o
    app valida a cada 30 s); tokens já emitidos para a extensão/plugin podem
    sobreviver por até 15 minutos — esse é o teto de atraso do bloqueio. Nada
    é apagado: a credencial guardada na máquina é mantida e o app tenta
    retomar sozinho a cada 60 segundos, então **Reativar licença** devolve o
    acesso de todos automaticamente, sem novo código. `license_expired` se
    comporta do mesmo jeito reversível. A suspensão bloqueia os usuários, não a
    gestão do master: com a licença pausada o master continua salvando a
    licença, liberando devices, removendo membros, lendo a auditoria e zerando
    tempos — apenas **Gerar código** exige licença ativa. Já a Gestão dentro do
    Arizona App exige licença ativa: durante a suspensão os gestores não
    gerenciam; somente o master, por este painel. A telemetria (`track-event`)
    também é recusada enquanto a licença estiver pausada ou expirada.
12. A v2.1.1 foi aposentada e está bloqueada no backend: ela não envia o
    fingerprint e toda validação dela falha com `device_not_active` ("Update
    the app to continue."). O usuário precisa instalar a 2.2.0. Ativar na
    2.1.1 consome o código e falha do mesmo jeito — o suporte só deve entregar
    código **depois** que a versão nova estiver instalada. O TOTP saiu do
    produto: nenhum cliente cadastra autenticador e o backend não exige nem
    reseta fatores.
13. Cada usuário pode ter apenas uma máquina ativa. Liberar um device não
    remove o usuário; remover o usuário revoga devices e sessões.
14. Device liberado não volta sozinho: nenhuma validação comum o reativa, e a
    mesma instalação só retorna com um código novo **consumido depois da
    liberação**. Revogar o device anula a concessão de vínculo que ainda não
    tenha sido gasta — isso vale para **Liberar** no painel, para a liberação
    feita pelo próprio app e para a remoção do membro. Sem isso, uma concessão
    emitida antes devolveria o lugar à máquina liberada, em silêncio, por até
    30 minutos depois da ação do administrador.
15. A liberação feita pelo próprio app (**Liberar e sair**) envia o `installId`
    da instalação, e o backend recusa a liberação pedida por uma instalação que
    não é a dona do lugar ativo. Com a v2.1.1 bloqueada na validação, toda a
    frota que valida envia o campo.
16. Somente o master, neste painel web separado, pode usar **Zerar tempos** em
    um usuário. A ação reinicia os contadores das políticas atribuíveis ao ID,
    e-mail e papel daquele membro, preservando limites globais de IP e de
    outros atores. Usuário, licença, device e sessão não são alterados.
17. A data escolhida em **Validade** é o último dia completo válido: o acesso
    bloqueia na hora da renovação diária do dia seguinte, em
    `America/Sao_Paulo`. A expiração é um bloqueio reversível: prorrogar a
    validade devolve o acesso automaticamente, sem novo código.

### Quando o usuário diz que o app pediu "um novo código de ativação"

É a mesma frase para três situações, todas resolvidas pelo master neste painel
(ou por um gestor na Gestão do Arizona App, com a licença ativa, para usuários
comuns):

| Mensagem no app (2.2.0) | Código | O que aconteceu |
|---|---|---|
| "O acesso desta máquina foi liberado pelo administrador." | `device_revoked` | O device foi liberado |
| "Esta máquina não corresponde ao cadastro." | `device_not_active` | O fingerprint gravado não confere com o que a máquina envia — ou a validação chegou sem fingerprint (v2.1.1 ou máquina não identificada; mensagem "Update the app to continue.") — ou o device ainda não tem fingerprint gravado (mensagem "Reactivate this machine."; precisa de uma ativação com código na 2.2.0) |
| "Esta sessão é antiga demais para cadastrar a máquina." | `device_activation_expired` | A concessão de vínculo expirou, já foi usada ou foi anulada por uma liberação |

Nos três casos o app apaga a credencial guardada e volta para a janela de
ativação. O usuário não tem como resolver sozinho: sem um código novo, não
existe concessão de vínculo e nenhuma máquina é cadastrada. Antes de entregar
um código, confirme que a máquina está na 2.2.0 — na 2.1.1 o código é consumido
e a ativação falha do mesmo jeito.

Dois códigos NÃO entram nessa lista porque são bloqueios reversíveis:
`license_expired` e `organization_not_active`. Neles o app se esconde e mostra
o motivo, mas mantém a credencial e tenta retomar sozinho a cada 60 segundos.
Não emita código novo nesses casos — prorrogue a validade ou reative a licença
e o acesso de todos volta automaticamente.

O que o master faz: na linha do usuário, coluna **Ativação**, clicar em **Gerar
código** (o botão vira **Ver código** enquanto houver um código válido em
aberto). Gerar um código novo cancela o anterior ainda aberto do mesmo usuário.
Para um usuário que já está ativo, o código emitido é de recuperação: ao ser
consumido, ele revoga o device atual e as sessões de licença daquele usuário.

Se o usuário ainda aparece com máquina ativa e a intenção é liberar aquele
lugar antes, use **Liberar** na coluna **Dispositivo** — essa ação respeita o
**Intervalo entre trocas** configurado na licença e anula qualquer concessão de
vínculo em aberto, de modo que a máquina liberada não consiga voltar sozinha.

Cancelar um código já consumido cuja máquina ainda não foi cadastrada é o único
caso sem botão no painel: **Liberar** fica indisponível porque não há máquina
ativa. As saídas são remover o membro, que anula a concessão, ou esperar os 30
minutos de validade. A concessão é de uso único e só serve para a sessão criada
por aquele código, então a espera não deixa a licença exposta a terceiros.

Uma auditoria em `licensing.audit_log` distingue o que de fato ocorreu:
`device.released`, `device.self_released`, `device.self_release_rejected`,
`device.fingerprint_mismatch`, `member.activation_code_consumed` e
`member.recovery_code_consumed`.

### Limites dos códigos de ativação

Os valores abaixo são os padrões. O master pode alterá-los em **Políticas de
acesso e teste** no painel da licença:

| Operação | Escopo | Padrão |
|---|---|---:|
| Gerar código | usuário destinatário | 3 por hora |
| Gerar código | master/gestor emissor | 10 por hora |
| Gerar código | endereço IP | 20 por hora |
| Tentar ativação | e-mail destinatário | 8 por hora |
| Tentar ativação | endereço IP | 30 por hora |

São configuráveis por licença:

- validade do código: 5 a 60 minutos;
- gerações por usuário: 1 a 50;
- janela de geração: 1 a 1440 minutos;
- tentativas por e-mail: 1 a 100;
- janela de tentativas: 1 a 1440 minutos;
- liberações por usuário: 1 a 100;
- janela de liberações: 1 a 1440 minutos;
- intervalo mínimo entre trocas: 0 a 365 dias;
- janela de recuperação: 5 a 60 minutos.

| Campo no Admin | O que controla |
|---|---|
| Validade do código | Por quanto tempo o código exibido pode ser usado |
| Gerações por usuário | Quantos códigos podem ser emitidos para o mesmo usuário |
| Janela de geração | Período móvel usado para contar essas emissões |
| Tentativas por e-mail | Quantas tentativas de ativação, certas ou erradas, o mesmo e-mail pode fazer |
| Janela de tentativas | Período móvel usado para contar essas tentativas |
| Liberações por usuário | Quantas vezes devices do mesmo usuário podem ser liberados |
| Janela de liberações | Período móvel usado para contar essas liberações |
| Intervalo entre trocas | Dias completos que a máquina atual precisa permanecer ativa antes de poder ser liberada; `0` permite liberar imediatamente |
| Janela de recuperação | Prazo para registrar a máquina depois de usar o código de recuperação |

O botão **Políticas de acesso** abre uma janela com a explicação de cada campo.
Ela também oferece dois preenchimentos rápidos:

- **Perfil de teste:** código por 30 min; 10 gerações em 5 min; 30 tentativas
  em 5 min; 20 liberações em 5 min; troca imediata; recuperação por 30 min.
- **Padrão de produção:** código por 15 min; 3 gerações em 60 min; 8 tentativas
  em 60 min; 10 liberações em 60 min; intervalo mínimo de 7 dias entre trocas;
  recuperação por 15 min.

O intervalo é contado a partir da ativação da máquina atual. Ao completar esse
período, a máquina pode ser liberada e a próxima ativação é imediata: não existe
uma segunda espera após a liberação.

O perfil apenas preenche o formulário. Clique **Aplicar** na janela e depois
**Salvar alterações** na licença para persistir os valores no Supabase.

Os limites por ator e IP continuam fixos como proteção global de emergência.
Reduzir a janela ou aumentar o limite por usuário facilita testes sem remover
essa proteção. O backend devolve `retryAfterSeconds` quando bloqueia uma
operação; o Tauri exibe uma contagem regressiva em vez do alerta vermelho
genérico.

O código expira conforme a política da licença e é de uso único. Gerar um novo
código revoga qualquer código anterior ainda aberto para o mesmo usuário.
Portanto, durante testes, reutilize o código atual enquanto ele estiver válido;
não gere outro apenas para repetir a tentativa.

Se o backend aceitar o código, mas falhar antes de concluir a ativação, ele
devolve `activation_unavailable` e libera o mesmo código para nova tentativa.
O reset manual dos contadores deve ser reservado para testes controlados ou
correção de incidente e precisa filtrar o usuário/e-mail e o emissor exatos;
não apague `licensing.rate_limit_events` de forma global em produção.
O botão **Zerar tempos** aplica esse filtro individual automaticamente e exige
sessão master iniciada recentemente pelo Google.

Sem sessão master ativa, a tela local mostra apenas o botão **Entrar com
Google**.

Para criar outro master, não dependa de vínculo automático por e-mail. Use o
passo explícito documentado em `supabase/README.md`.

Projeto Supabase:

- Ref: `nizchnscqkixawqxrwzd`
- URL: `https://nizchnscqkixawqxrwzd.supabase.co`

O Tauri e o Admin cliente usam somente a chave `sb_publishable`. As Edge
Functions usam `sb_secret` para o Data API. A exceção temporária é
`app-activate`: criar a identidade Auth do usuário é uma operação do Supabase
Auth Admin e ainda exige o JWT legado `SUPABASE_SERVICE_ROLE_KEY`. A chave
permanece restrita ao backend e nunca é enviada ao Tauri, ao navegador ou
gravada no repositório.

O Client ID e o Client Secret do Google ficam configurados diretamente no
provider Google do Supabase Auth. O secret não pertence ao frontend, aos
arquivos locais de ambiente nem ao repositório. O login Google é exclusivo do
Admin web e é o único caminho aceito para o master: as Functions exigem sempre
um Google OAuth recente. Ativação, recuperação, device e licença do Tauri
seguem o seu próprio fluxo.
