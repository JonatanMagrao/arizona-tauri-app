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
   diário por TOTP do Tauri continua seguindo o horário da licença.
3. Salvar a licença com seats, validade, renovação diária e usuários.
4. Apenas o master define quem é gestor.
5. No Tauri, master e gestores podem emitir código para usuários permitidos.
6. O código de ativação/recuperação usa a validade configurada na licença, é de
   uso único e aparece em claro somente no resultado da emissão, com botão de
   copiar.
7. Gestores não podem emitir código para si, para outro gestor nem para uma
   identidade master.
8. O primeiro acesso do usuário é e-mail + código; depois ele cadastra TOTP.
   Em recuperação de device, um TOTP já verificado é preservado e reutilizado;
   um novo QR aparece somente se a conta ainda não possuir fator verificado.
9. Somente o master, neste painel web separado, pode usar **Resetar TOTP**.
   A ação remove os fatores TOTP, encerra as sessões Auth, revoga devices e
   sessões de licença e cancela códigos abertos. Depois, um novo código permite
   cadastrar outro QR. A Gestão dentro do Tauri não expõe essa opção.
10. A partir daí, o acesso diário pede somente TOTP após o horário configurado
   (04:00 por padrão).
11. Cada usuário pode ter apenas uma máquina ativa. Liberar um device não
    remove o usuário; remover o usuário revoga devices e sessões.
12. Device revogado não é reativado por uma validação comum; uma instalação
    nova precisa passar novamente pelo fluxo autorizado.
13. Somente o master, neste painel web separado, pode usar **Zerar tempos** em
    um usuário. A ação reinicia os contadores das políticas atribuíveis ao ID,
    e-mail e papel daquele membro, preservando limites globais de IP e de
    outros atores. Usuário, TOTP, licença, device e sessão não são alterados.

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
| Janela de recuperação | Prazo para confirmar o TOTP e registrar o device depois de usar o código |

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
Functions usam `sb_secret` para o Data API. As exceções temporárias são
`app-activate` e `master-reset-member-totp`: operações do Supabase Auth Admin,
como criar a identidade Auth e remover matrículas MFA, ainda exigem o JWT
legado `SUPABASE_SERVICE_ROLE_KEY`. Fatores TOTP verificados são preservados na
recuperação comum de device e só são removidos pela ação master explícita no
Admin web. A chave permanece restrita ao backend e nunca é enviada ao Tauri,
ao navegador ou gravada no repositório.

O Client ID e o Client Secret do Google ficam configurados diretamente no
provider Google do Supabase Auth. O secret não pertence ao frontend, aos
arquivos locais de ambiente nem ao repositório. O login Google é exclusivo do
Admin web; ativação, recuperação, TOTP diário, device e licença do Tauri não
mudam.
