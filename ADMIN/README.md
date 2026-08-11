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
usuarios validos. Leia `../docs/LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md` antes.
Diagnostico de paridade: `npm run license:check` (aqui ou na raiz do repo).

Durante desenvolvimento:

```powershell
cd ADMIN
npm run dev
```

Abra a URL mostrada pelo Vite. A porta inicial e `1430`.
Ela Ã© fixa porque faz parte da allowlist do Google OAuth e do Supabase. Feche o
processo que estiver usando a porta se o Vite nÃ£o conseguir iniciar.

Depois do build, a pagina fica em `ADMIN/dist/index.html`.
Para testar o build:

```powershell
cd ADMIN
npm run build
npm run preview
```

Abra a URL mostrada pelo Vite. A porta inicial do preview e `1431`.
Ela tambÃ©m Ã© fixa pela configuraÃ§Ã£o de redirect OAuth.

Fluxo atual:

1. Criar o usuÃ¡rio master no Supabase Auth e vinculÃ¡-lo explicitamente em
   `licensing.master_accounts`.
2. Entrar no painel local exclusivamente com Google OAuth. O Supabase vincula a
   identidade Google ao usuÃ¡rio Auth existente quando o e-mail verificado Ã© o
   mesmo; o backend ainda exige o vÃ­nculo explÃ­cito de `auth_user_id` em
   `licensing.master_accounts`. A sessÃ£o fica em `sessionStorage`: sobrevive a
   recarregamentos na mesma aba, mas Ã© removida ao sair ou fechar a aba. Tokens
   expirados sÃ£o renovados pelo refresh token. O painel bloqueia localmente
   depois de 30 minutos sem atividade e exige novo OAuth Google no mÃ¡ximo 8
   horas depois do login. Esses limites pertencem somente ao Admin; o ciclo
   diÃ¡rio da licenÃ§a continua sendo o horÃ¡rio de renovaÃ§Ã£o configurado, mas o
   app do usuÃ¡rio nÃ£o pede autenticador nenhum.
3. Salvar a licenÃ§a com seats, validade, renovaÃ§Ã£o diÃ¡ria e usuÃ¡rios.
4. Apenas o master define quem Ã© gestor, pelo toggle **Perfil** na lista de
   usuÃ¡rios deste painel. Salvar a licenÃ§a preserva os papÃ©is existentes: a
   linha marcada como **Gestor** continua `admin` e as demais continuam `user`.
5. A emissÃ£o de cÃ³digo acontece neste painel web e tambÃ©m na GestÃ£o dentro do
   Arizona App: com a licenÃ§a ativa, master e gestores emitem cÃ³digo para
   usuÃ¡rios permitidos. Na GestÃ£o, o gestor administra somente usuÃ¡rios comuns
   â€” listar, adicionar (sempre como usuÃ¡rio), gerar cÃ³digo, liberar device e
   remover â€” nunca a si mesmo, outro gestor ou uma identidade master; as
   Functions `admin-*` aplicam essas mesmas regras no backend. Nomear ou
   rebaixar gestores continua exclusivo do master, neste painel.
6. O cÃ³digo de ativaÃ§Ã£o/recuperaÃ§Ã£o usa a validade configurada na licenÃ§a, Ã© de
   uso Ãºnico e aparece em claro somente no resultado da emissÃ£o, com botÃ£o de
   copiar.
7. NÃ£o Ã© possÃ­vel emitir cÃ³digo para uma identidade master
   (`protected_identity`). Gestores tambÃ©m nÃ£o emitem cÃ³digo para si nem para
   outro gestor.
8. O acesso do usuÃ¡rio Ã© e-mail + cÃ³digo de 12 caracteres, sem autenticador.
   ConcluÃ­da a ativaÃ§Ã£o, ele nÃ£o se autentica de novo naquela mÃ¡quina: a
   confianÃ§a passa a ser do hardware, provado pelo `deviceFingerprintHash` que
   o app envia. DivergÃªncia de hardware devolve `device_not_active` e registra
   `device.fingerprint_mismatch` na auditoria. Uma validaÃ§Ã£o que chega **sem**
   fingerprint â€” caso da v2.1.1, que nunca envia o campo â€” Ã© recusada com
   `device_not_active` e a mensagem "Update the app to continue.",
   independentemente do que estÃ¡ gravado para aquele device.
9. Cadastrar mÃ¡quina exige a concessÃ£o que o consumo do cÃ³digo emite. SÃ³ uma
   ativaÃ§Ã£o respaldada por cÃ³digo pode gravar o fingerprint; a validaÃ§Ã£o comum
   nunca grava. A concessÃ£o vale 30 minutos, Ã© de uso Ãºnico e Ã© gasta antes de
   o device ser gravado, entÃ£o um mesmo cÃ³digo cadastra no mÃ¡ximo uma mÃ¡quina.
   Sem ela, a resposta Ã© sempre `device_activation_expired` â€” o caminho Ã© pedir
   um cÃ³digo novo. Uma mÃ¡quina que nÃ£o consegue se identificar (fingerprint
   vazio) Ã© recusada com `device_identity_required` **antes** de gastar a
   concessÃ£o, entÃ£o a mesma concessÃ£o continua vÃ¡lida para nova tentativa.
10. O vÃ­nculo de mÃ¡quina vale para a frota inteira desde o primeiro dia: uma
    validaÃ§Ã£o cujo device **nÃ£o tem** fingerprint gravado Ã© recusada com
    `device_not_active` e a mensagem "Reactivate this machine.", registrando
    `device.fingerprint_mismatch` com `outcome: "unbound"` na auditoria. Todo
    device que estava em campo precisa passar por uma ativaÃ§Ã£o com cÃ³digo na
    2.2.0 â€” Ã© essa ativaÃ§Ã£o que grava o fingerprint. Na prÃ¡tica, cada usuÃ¡rio
    recebe um cÃ³digo novo junto com o instalador 2.2.0.
11. Somente o master pode suspender a licenÃ§a inteira com **Suspender licenÃ§a
    agora**, na seÃ§Ã£o da licenÃ§a. A suspensÃ£o marca a organizaÃ§Ã£o como
    `paused`: toda validaÃ§Ã£o passa a devolver `organization_not_active`, o app
    se esconde e mostra o motivo na janela de acesso em atÃ© ~30 segundos (o
    app valida a cada 30 s); tokens jÃ¡ emitidos para a extensÃ£o/plugin podem
    sobreviver por atÃ© 15 minutos â€” esse Ã© o teto de atraso do bloqueio. Nada
    Ã© apagado: a credencial guardada na mÃ¡quina Ã© mantida e o app tenta
    retomar sozinho a cada 60 segundos, entÃ£o **Reativar licenÃ§a** devolve o
    acesso de todos automaticamente, sem novo cÃ³digo. `license_expired` se
    comporta do mesmo jeito reversÃ­vel. A suspensÃ£o bloqueia os usuÃ¡rios, nÃ£o a
    gestÃ£o do master: com a licenÃ§a pausada o master continua salvando a
    licenÃ§a, liberando devices, removendo membros, lendo a auditoria e zerando
    tempos â€” apenas **Gerar cÃ³digo** exige licenÃ§a ativa. JÃ¡ a GestÃ£o dentro do
    Arizona App exige licenÃ§a ativa: durante a suspensÃ£o os gestores nÃ£o
    gerenciam; somente o master, por este painel.
12. A v2.1.1 foi aposentada e estÃ¡ bloqueada no backend: ela nÃ£o envia o
    fingerprint e toda validaÃ§Ã£o dela falha com `device_not_active` ("Update
    the app to continue."). O usuÃ¡rio precisa instalar a 2.2.0. Ativar na
    2.1.1 consome o cÃ³digo e falha do mesmo jeito â€” o suporte sÃ³ deve entregar
    cÃ³digo **depois** que a versÃ£o nova estiver instalada. O TOTP saiu do
    produto: nenhum cliente cadastra autenticador e o backend nÃ£o exige nem
    reseta fatores.
13. Cada usuÃ¡rio pode ter apenas uma mÃ¡quina ativa. Liberar um device nÃ£o
    remove o usuÃ¡rio; remover o usuÃ¡rio revoga devices e sessÃµes.
14. Device liberado nÃ£o volta sozinho: nenhuma validaÃ§Ã£o comum o reativa, e a
    mesma instalaÃ§Ã£o sÃ³ retorna com um cÃ³digo novo **consumido depois da
    liberaÃ§Ã£o**. Revogar o device anula a concessÃ£o de vÃ­nculo que ainda nÃ£o
    tenha sido gasta â€” isso vale para **Liberar** no painel, para a liberaÃ§Ã£o
    feita pelo prÃ³prio app e para a remoÃ§Ã£o do membro. Sem isso, uma concessÃ£o
    emitida antes devolveria o lugar Ã  mÃ¡quina liberada, em silÃªncio, por atÃ©
    30 minutos depois da aÃ§Ã£o do administrador.
15. A liberaÃ§Ã£o feita pelo prÃ³prio app (**Liberar e sair**) envia o `installId`
    da instalaÃ§Ã£o, e o backend recusa a liberaÃ§Ã£o pedida por uma instalaÃ§Ã£o que
    nÃ£o Ã© a dona do lugar ativo. Com a v2.1.1 bloqueada na validaÃ§Ã£o, toda a
    frota que valida envia o campo.
16. Somente o master, neste painel web separado, pode usar **Zerar tempos** em
    um usuÃ¡rio. A aÃ§Ã£o reinicia os contadores das polÃ­ticas atribuÃ­veis ao ID,
    e-mail e papel daquele membro, preservando limites globais de IP e de
    outros atores. UsuÃ¡rio, licenÃ§a, device e sessÃ£o nÃ£o sÃ£o alterados.
17. A data escolhida em **Validade** Ã© o Ãºltimo dia completo vÃ¡lido: o acesso
    bloqueia na hora da renovaÃ§Ã£o diÃ¡ria do dia seguinte, em
    `America/Sao_Paulo`. A expiraÃ§Ã£o Ã© um bloqueio reversÃ­vel: prorrogar a
    validade devolve o acesso automaticamente, sem novo cÃ³digo.

### Quando o usuÃ¡rio diz que o app pediu "um novo cÃ³digo de ativaÃ§Ã£o"

Ã‰ a mesma frase para trÃªs situaÃ§Ãµes, todas resolvidas pelo master neste painel
(ou por um gestor na GestÃ£o do Arizona App, com a licenÃ§a ativa, para usuÃ¡rios
comuns):

| Mensagem no app (2.2.0) | CÃ³digo | O que aconteceu |
|---|---|---|
| "O acesso desta mÃ¡quina foi liberado pelo administrador." | `device_revoked` | O device foi liberado |
| "Esta mÃ¡quina nÃ£o corresponde ao cadastro." | `device_not_active` | O fingerprint gravado nÃ£o confere com o que a mÃ¡quina envia â€” ou a validaÃ§Ã£o chegou sem fingerprint (v2.1.1 ou mÃ¡quina nÃ£o identificada; mensagem "Update the app to continue.") â€” ou o device ainda nÃ£o tem fingerprint gravado (mensagem "Reactivate this machine."; precisa de uma ativaÃ§Ã£o com cÃ³digo na 2.2.0) |
| "Esta sessÃ£o Ã© antiga demais para cadastrar a mÃ¡quina." | `device_activation_expired` | A concessÃ£o de vÃ­nculo expirou, jÃ¡ foi usada ou foi anulada por uma liberaÃ§Ã£o |

Nos trÃªs casos o app apaga a credencial guardada e volta para a janela de
ativaÃ§Ã£o. O usuÃ¡rio nÃ£o tem como resolver sozinho: sem um cÃ³digo novo, nÃ£o
existe concessÃ£o de vÃ­nculo e nenhuma mÃ¡quina Ã© cadastrada. Antes de entregar
um cÃ³digo, confirme que a mÃ¡quina estÃ¡ na 2.2.0 â€” na 2.1.1 o cÃ³digo Ã© consumido
e a ativaÃ§Ã£o falha do mesmo jeito.

Dois cÃ³digos NÃƒO entram nessa lista porque sÃ£o bloqueios reversÃ­veis:
`license_expired` e `organization_not_active`. Neles o app se esconde e mostra
o motivo, mas mantÃ©m a credencial e tenta retomar sozinho a cada 60 segundos.
NÃ£o emita cÃ³digo novo nesses casos â€” prorrogue a validade ou reative a licenÃ§a
e o acesso de todos volta automaticamente.

O que o master faz: na linha do usuÃ¡rio, coluna **AtivaÃ§Ã£o**, clicar em **Gerar
cÃ³digo** (o botÃ£o vira **Ver cÃ³digo** enquanto houver um cÃ³digo vÃ¡lido em
aberto). Gerar um cÃ³digo novo cancela o anterior ainda aberto do mesmo usuÃ¡rio.
Para um usuÃ¡rio que jÃ¡ estÃ¡ ativo, o cÃ³digo emitido Ã© de recuperaÃ§Ã£o: ao ser
consumido, ele revoga o device atual e as sessÃµes de licenÃ§a daquele usuÃ¡rio.

Se o usuÃ¡rio ainda aparece com mÃ¡quina ativa e a intenÃ§Ã£o Ã© liberar aquele
lugar antes, use **Liberar** na coluna **Dispositivo** â€” essa aÃ§Ã£o respeita o
**Intervalo entre trocas** configurado na licenÃ§a e anula qualquer concessÃ£o de
vÃ­nculo em aberto, de modo que a mÃ¡quina liberada nÃ£o consiga voltar sozinha.

Cancelar um cÃ³digo jÃ¡ consumido cuja mÃ¡quina ainda nÃ£o foi cadastrada Ã© o Ãºnico
caso sem botÃ£o no painel: **Liberar** fica indisponÃ­vel porque nÃ£o hÃ¡ mÃ¡quina
ativa. As saÃ­das sÃ£o remover o membro, que anula a concessÃ£o, ou esperar os 30
minutos de validade. A concessÃ£o Ã© de uso Ãºnico e sÃ³ serve para a sessÃ£o criada
por aquele cÃ³digo, entÃ£o a espera nÃ£o deixa a licenÃ§a exposta a terceiros.

Uma auditoria em `licensing.audit_log` distingue o que de fato ocorreu:
`device.released`, `device.self_released`, `device.self_release_rejected`,
`device.fingerprint_mismatch`, `member.activation_code_consumed` e
`member.recovery_code_consumed`.

### Limites dos cÃ³digos de ativaÃ§Ã£o

Os valores abaixo sÃ£o os padrÃµes. O master pode alterÃ¡-los em **PolÃ­ticas de
acesso e teste** no painel da licenÃ§a:

| OperaÃ§Ã£o | Escopo | PadrÃ£o |
|---|---|---:|
| Gerar cÃ³digo | usuÃ¡rio destinatÃ¡rio | 3 por hora |
| Gerar cÃ³digo | master/gestor emissor | 10 por hora |
| Gerar cÃ³digo | endereÃ§o IP | 20 por hora |
| Tentar ativaÃ§Ã£o | e-mail destinatÃ¡rio | 8 por hora |
| Tentar ativaÃ§Ã£o | endereÃ§o IP | 30 por hora |

SÃ£o configurÃ¡veis por licenÃ§a:

- validade do cÃ³digo: 5 a 60 minutos;
- geraÃ§Ãµes por usuÃ¡rio: 1 a 50;
- janela de geraÃ§Ã£o: 1 a 1440 minutos;
- tentativas por e-mail: 1 a 100;
- janela de tentativas: 1 a 1440 minutos;
- liberaÃ§Ãµes por usuÃ¡rio: 1 a 100;
- janela de liberaÃ§Ãµes: 1 a 1440 minutos;
- intervalo mÃ­nimo entre trocas: 0 a 365 dias;
- janela de recuperaÃ§Ã£o: 5 a 60 minutos.

| Campo no Admin | O que controla |
|---|---|
| Validade do cÃ³digo | Por quanto tempo o cÃ³digo exibido pode ser usado |
| GeraÃ§Ãµes por usuÃ¡rio | Quantos cÃ³digos podem ser emitidos para o mesmo usuÃ¡rio |
| Janela de geraÃ§Ã£o | PerÃ­odo mÃ³vel usado para contar essas emissÃµes |
| Tentativas por e-mail | Quantas tentativas de ativaÃ§Ã£o, certas ou erradas, o mesmo e-mail pode fazer |
| Janela de tentativas | PerÃ­odo mÃ³vel usado para contar essas tentativas |
| LiberaÃ§Ãµes por usuÃ¡rio | Quantas vezes devices do mesmo usuÃ¡rio podem ser liberados |
| Janela de liberaÃ§Ãµes | PerÃ­odo mÃ³vel usado para contar essas liberaÃ§Ãµes |
| Intervalo entre trocas | Dias completos que a mÃ¡quina atual precisa permanecer ativa antes de poder ser liberada; `0` permite liberar imediatamente |
| Janela de recuperaÃ§Ã£o | Prazo para registrar a mÃ¡quina depois de usar o cÃ³digo de recuperaÃ§Ã£o |

O botÃ£o **PolÃ­ticas de acesso** abre uma janela com a explicaÃ§Ã£o de cada campo.
Ela tambÃ©m oferece dois preenchimentos rÃ¡pidos:

- **Perfil de teste:** cÃ³digo por 30 min; 10 geraÃ§Ãµes em 5 min; 30 tentativas
  em 5 min; 20 liberaÃ§Ãµes em 5 min; troca imediata; recuperaÃ§Ã£o por 30 min.
- **PadrÃ£o de produÃ§Ã£o:** cÃ³digo por 15 min; 3 geraÃ§Ãµes em 60 min; 8 tentativas
  em 60 min; 10 liberaÃ§Ãµes em 60 min; intervalo mÃ­nimo de 7 dias entre trocas;
  recuperaÃ§Ã£o por 15 min.

O intervalo Ã© contado a partir da ativaÃ§Ã£o da mÃ¡quina atual. Ao completar esse
perÃ­odo, a mÃ¡quina pode ser liberada e a prÃ³xima ativaÃ§Ã£o Ã© imediata: nÃ£o existe
uma segunda espera apÃ³s a liberaÃ§Ã£o.

O perfil apenas preenche o formulÃ¡rio. Clique **Aplicar** na janela e depois
**Salvar alteraÃ§Ãµes** na licenÃ§a para persistir os valores no Supabase.

Os limites por ator e IP continuam fixos como proteÃ§Ã£o global de emergÃªncia.
Reduzir a janela ou aumentar o limite por usuÃ¡rio facilita testes sem remover
essa proteÃ§Ã£o. O backend devolve `retryAfterSeconds` quando bloqueia uma
operaÃ§Ã£o; o Tauri exibe uma contagem regressiva em vez do alerta vermelho
genÃ©rico.

O cÃ³digo expira conforme a polÃ­tica da licenÃ§a e Ã© de uso Ãºnico. Gerar um novo
cÃ³digo revoga qualquer cÃ³digo anterior ainda aberto para o mesmo usuÃ¡rio.
Portanto, durante testes, reutilize o cÃ³digo atual enquanto ele estiver vÃ¡lido;
nÃ£o gere outro apenas para repetir a tentativa.

Se o backend aceitar o cÃ³digo, mas falhar antes de concluir a ativaÃ§Ã£o, ele
devolve `activation_unavailable` e libera o mesmo cÃ³digo para nova tentativa.
O reset manual dos contadores deve ser reservado para testes controlados ou
correÃ§Ã£o de incidente e precisa filtrar o usuÃ¡rio/e-mail e o emissor exatos;
nÃ£o apague `licensing.rate_limit_events` de forma global em produÃ§Ã£o.
O botÃ£o **Zerar tempos** aplica esse filtro individual automaticamente e exige
sessÃ£o master iniciada recentemente pelo Google.

Sem sessÃ£o master ativa, a tela local mostra apenas o botÃ£o **Entrar com
Google**.

Para criar outro master, nÃ£o dependa de vÃ­nculo automÃ¡tico por e-mail. Use o
passo explÃ­cito documentado em `supabase/README.md`.

Projeto Supabase:

- Ref: `nizchnscqkixawqxrwzd`
- URL: `https://nizchnscqkixawqxrwzd.supabase.co`

O Tauri e o Admin cliente usam somente a chave `sb_publishable`. As Edge
Functions usam `sb_secret` para o Data API. A exceÃ§Ã£o temporÃ¡ria Ã©
`app-activate`: criar a identidade Auth do usuÃ¡rio Ã© uma operaÃ§Ã£o do Supabase
Auth Admin e ainda exige o JWT legado `SUPABASE_SERVICE_ROLE_KEY`. A chave
permanece restrita ao backend e nunca Ã© enviada ao Tauri, ao navegador ou
gravada no repositÃ³rio.

O Client ID e o Client Secret do Google ficam configurados diretamente no
provider Google do Supabase Auth. O secret nÃ£o pertence ao frontend, aos
arquivos locais de ambiente nem ao repositÃ³rio. O login Google Ã© exclusivo do
Admin web e Ã© o Ãºnico caminho aceito para o master: as Functions exigem sempre
um Google OAuth recente. AtivaÃ§Ã£o, recuperaÃ§Ã£o, device e licenÃ§a do Tauri
seguem o seu prÃ³prio fluxo.
