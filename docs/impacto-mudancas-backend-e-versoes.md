# Impacto de mudanças de backend e necessidade de nova versão

**Status:** regra operacional para mudanças futuras  
**Atualizado em:** 28 de julho de 2026  
**Escopo:** Tauri, extensão CEP, Admin, Supabase Auth, banco e Edge Functions

Este documento define quando uma alteração central pode afetar todos os usuários
do Arizona App e quando é necessário distribuir uma nova versão do Tauri ou da
extensão CEP.

Ele complementa a
[arquitetura futura de atualizações independentes](./arquitetura-atualizacoes-independentes-tauri-cep.md).

## 1. Situação atual

As proteções administrativas implementadas em julho de 2026 são isoladas do
aplicativo distribuído:

- sessão do Admin limitada a 8 horas;
- bloqueio local do Admin depois de 30 minutos sem atividade;
- logout do Admin com revogação apenas da sessão administrativa atual;
- cabeçalhos de segurança do painel;
- validação de 8 horas nas Edge Functions quando o token apresenta autenticação
  Google OAuth;
- manutenção do fluxo diário por TOTP quando o token pertence ao Tauri.

Essas mudanças **não exigem uma nova versão do Tauri nem da extensão CEP**.
Também não encerram as sessões atuais dos usuários do aplicativo.

O futuro controle de uma única sessão ativa do Admin também poderá ser
implementado sem nova versão do Tauri/CEP, desde que:

- use uma tabela aditiva exclusiva para sessões administrativas;
- seja validado somente nos fluxos Google OAuth do Admin;
- não utilize revogação global das outras sessões do usuário;
- não altere o contrato de autenticação TOTP do Tauri.

## 2. Regra principal

Uma mudança no backend não exige automaticamente uma nova versão do aplicativo.
A decisão depende do contrato consumido pelo cliente.

- Se o backend continuar aceitando as requisições e tokens produzidos pelas
  versões instaladas, a mudança pode ser somente de backend.
- Se o cliente precisar enviar, ler, validar ou exibir algo novo para continuar
  funcionando, é necessária uma nova versão do componente consumidor.
- Mesmo sem exigir um novo instalador, uma mudança de backend pode ter efeito
  imediato sobre todos os usuários. Esse impacto precisa de plano de rollout e
  rollback.

## 3. Matriz de impacto

| Mudança | Pode afetar usuários já logados? | Nova versão Tauri? | Nova versão CEP? | Observação |
|---|---:|---:|---:|---|
| Interface, sessão ou cabeçalhos somente do Admin | Não | Não | Não | Publicar apenas Admin/Functions relacionadas |
| Sessão única somente do Admin, isolada por migration aditiva | Não | Não | Não | Um painel Admin anterior pode ser desconectado |
| Correção interna de Edge Function sem mudar contrato | Normalmente não | Não | Não | Testar com a versão distribuída atual |
| Alinhar a data limite da licença ao horário de renovação diária | Não deve interromper sessões antes do limite | Não | Não | A data escolhida será o último dia válido |
| Nova regra de licença aplicada pelo backend | Sim, imediatamente | Talvez | Talvez | Não exige release se os clientes atuais já entendem a resposta |
| Alterar timebox, inatividade ou sessão única global do Supabase Auth | Sim | Normalmente não | Indiretamente | Pode forçar novo login ou revogar sessões sem trocar o binário |
| Desativar um método de login usado pelo Tauri | Sim | Provavelmente | Não diretamente | Preparar versão compatível antes da mudança |
| Alterar campos obrigatórios de request/response das Functions | Sim | Sim | Somente se consumir o contrato | Manter compatibilidade durante a transição |
| Migration aditiva, sem mudar respostas existentes | Não | Não | Não | Colunas/tabelas novas devem aceitar clientes antigos |
| Migration destrutiva ou mudança de semântica | Sim | Sim | Talvez | Exige rollout compatível e rollback |
| Ativar exigência de SSL no acesso direto ao banco | Não para o app, se ele usar apenas APIs | Não | Não | Validar integrações operacionais e Edge Functions |
| Restringir IPs de acesso direto ao banco | Não para o app, se ele usar apenas APIs | Não | Não | Pode bloquear ferramentas administrativas ou serviços externos |
| Rotacionar segredo usado apenas pelas Edge Functions | Pode haver falha durante o rollout | Não | Não | Publicar de forma coordenada e manter rollback |
| Rotacionar chave que o CEP valida localmente | Sim | Talvez | Sim, primeiro | O CEP precisa confiar na nova chave antes de ela assinar recibos |
| Alterar protocolo ou assinatura do recibo CEP | Sim | Sim | Sim | Release coordenada e período de compatibilidade |
| Corrigir apenas a interface ou comportamento interno do CEP | Não no Tauri | Não | Sim | Pode ser uma atualização independente do CEP |
| Corrigir apenas comportamento local do Tauri | Não no CEP, se o contrato não mudar | Sim | Não | Pode ser uma atualização independente do Tauri |

## 4. Casos que podem atingir todos sem nova versão

Algumas mudanças são distribuídas pelo servidor e, portanto, entram em vigor sem
que o usuário instale outro binário:

### 4.1 Configurações globais do Supabase Auth

Timebox, inatividade, sessão única global, expiração ou revogação de refresh
tokens podem desconectar usuários atuais. Tecnicamente, uma nova versão não é
obrigatória se o Tauri já tratar a sessão inválida e oferecer novo login.

Mesmo assim, essas configurações não devem ser alteradas diretamente em
produção. Antes é necessário:

1. confirmar que o Tauri atual recupera corretamente `401`, token expirado e
   refresh token revogado;
2. testar com master, gestor e usuário comum;
3. verificar a consequência sobre o recibo CEP;
4. definir horário, aviso aos usuários e rollback;
5. aplicar primeiro em um ambiente ou conta de teste.

### 4.2 Regras de licença e Edge Functions

Uma nova validação publicada no backend pode bloquear imediatamente todas as
versões instaladas. Não exige nova versão quando o request e a resposta
continuam compatíveis, mas exige teste explícito com a versão que está em
produção.

### 4.3 Banco, SSL e restrição de rede

O Tauri e o CEP não acessam o PostgreSQL diretamente; eles usam Supabase Auth,
Edge Functions e o contrato de licença. Por isso, ativar SSL obrigatório ou
restringir os IPs do banco normalmente não pede uma nova versão do aplicativo.

O risco está nas conexões operacionais: CLI, scripts, integrações ou serviços que
acessem o banco diretamente. A mudança deve ser feita separadamente, depois de
inventariar e testar essas conexões.

### 4.4 Data limite da licença no horário da renovação diária

**Mudança planejada — ainda não implementada.**

A data limite escolhida no Admin deve representar o **último dia completo de
validade**. A licença expirará no início do ciclo seguinte, usando
`daily_auth_reset_hour` em `America/Sao_Paulo`.

Exemplo:

```text
Data limite: 29/07/2026
Renovação diária: 04:00
Expiração efetiva: 30/07/2026 às 04:00 em America/Sao_Paulo
```

Essa regra deve ser única e compartilhada por todos os caminhos do backend que
consultam `license_expires_on`, incluindo:

- validação e renovação da licença;
- emissão da sessão e do recibo CEP;
- primeiro acesso e ativação;
- recuperação ou ativação de dispositivo;
- inclusão e administração de membros.

A sessão de licença e o recibo CEP continuarão vencendo no primeiro limite
aplicável: TTL próprio, próxima renovação diária ou expiração efetiva da
licença.

O ajuste é compatível com o contrato atual de erro `license_expired` e, por
isso, **não exige nova versão do Tauri nem da extensão CEP**. Ele deve ser
publicado como alteração de backend, acompanhado por:

1. helper central para calcular a expiração no fuso e horário da licença;
2. substituição dos cálculos UTC duplicados nas Edge Functions;
3. testes para horários diferentes de `04:00`, virada de mês e de ano;
4. teste da versão distribuída do Tauri e do recibo lido pelo CEP;
5. registro do horário de publicação e validação das licenças vigentes.

Como o comportamento atual encerra a validade em `23:59:59.999 UTC`, a mudança
poderá estender a validade de uma licença existente. Considerando o fuso atual
de São Paulo, a extensão será de aproximadamente 3 a 26 horas, conforme o
horário de renovação configurado. A mudança não deverá antecipar o vencimento,
mas esse comportamento ainda deve ser confirmado nos testes de rollout.

Alterar `daily_auth_reset_hour` também mudará o instante efetivo de expiração de
uma licença com data limite definida. O Admin deve deixar essa relação clara
antes de salvar a alteração.

## 5. Casos que exigem nova versão

Uma nova versão é obrigatória quando:

- o Tauri precisa produzir outro formato de autenticação ou request;
- o Tauri precisa interpretar um novo erro para não ficar preso em um fluxo;
- a forma de armazenar, renovar ou invalidar a sessão local muda;
- o protocolo do recibo muda de forma incompatível;
- a chave pública embutida no CEP precisa ser atualizada;
- o CEP precisa aceitar novos claims obrigatórios;
- uma função deixa de aceitar o contrato usado pela versão instalada;
- a correção depende de código local, e não apenas do backend.

Quando o contrato envolver Tauri e CEP, seguir a ordem compatível documentada:
atualizar primeiro o consumidor para aceitar os formatos antigo e novo e só
depois alterar o produtor.

## 6. Registro obrigatório antes de mudanças globais

Toda mudança capaz de atingir os usuários do aplicativo deve registrar:

- data e responsável;
- componentes alterados;
- versões Tauri e CEP atualmente distribuídas;
- usuários e sessões potencialmente afetados;
- compatibilidade com a versão em produção;
- necessidade ou não de novo instalador;
- comportamento esperado para quem já está logado;
- testes executados;
- plano de rollout;
- plano de rollback;
- necessidade de comunicação ao cliente.

Modelo:

```text
Mudança:
Componentes:
Impacto sobre sessões existentes:
Compatível com Tauri:
Compatível com CEP:
Nova versão necessária:
Testes:
Rollout:
Rollback:
Comunicação:
```

## 7. Decisão para os próximos ajustes

- Não ativar limites globais de sessão do Supabase para resolver uma necessidade
  exclusiva do Admin.
- Implementar sessão única do Admin somente com estado e validação isolados.
- Alinhar `license_expires_on` ao início do ciclo posterior ao último dia válido,
  usando o horário de renovação diária da licença.
- Tratar SSL obrigatório e restrição de rede como uma mudança operacional
  separada.
- Antes de qualquer regra nova nas Functions compartilhadas, testar a versão
  atual do Tauri e validar o recibo consumido pelo CEP.
- Se o teste revelar que o aplicativo atual não se recupera corretamente de uma
  sessão revogada, corrigir e distribuir o Tauri antes da alteração global.
