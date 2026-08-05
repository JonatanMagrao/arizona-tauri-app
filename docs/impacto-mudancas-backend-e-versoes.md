# Impacto de mudanças de backend e necessidade de nova versão

**Status:** regra operacional vigente
**Última revisão:** 04/08/2026
**Escopo:** Tauri, extensão CEP, Admin, Supabase Auth, banco e Edge Functions

Este documento serve para uma decisão: uma mudança pode ser publicada apenas no
backend ou exige uma nova versão de algum cliente?

## Regra principal

Uma alteração de backend não exige automaticamente uma nova versão. A resposta
depende do contrato consumido pelos componentes já instalados:

- se requests, responses, códigos de erro e recibos continuam compatíveis, a
  mudança pode ser somente de backend;
- se o cliente precisa enviar, ler, validar ou apresentar algo novo para
  continuar funcionando, o componente consumidor precisa de nova versão;
- se Tauri e CEP consomem o contrato alterado, a transição precisa aceitar o
  formato antigo e o novo até a atualização da frota;
- uma mudança de backend compatível ainda pode atingir todos imediatamente e,
  portanto, precisa de rollout, observação e rollback.

## Matriz de decisão

| Alteração | Tauri novo? | CEP novo? | Observação |
|---|---:|---:|---|
| Correção interna de Function sem mudar contrato | Não | Não | Testar com a versão atualmente distribuída. |
| Regra de licença usando respostas já conhecidas | Normalmente não | Normalmente não | Pode bloquear usuários imediatamente. |
| Campo novo opcional em request ou response | Não | Não | Manter valores padrão para clientes antigos. |
| Campo novo obrigatório enviado pelo Tauri | Sim | Só se também consumir | Publicar primeiro um backend compatível com os dois formatos. |
| Código de erro novo que muda o fluxo do app | Sim | Depende | Cliente antigo não pode ficar preso ou interpretar incorretamente. |
| Mudança incompatível no recibo CEP | Sim | Sim | Exige janela de compatibilidade e release coordenado. |
| Nova chave pública do recibo | Depende | Sim | Fazer rotação aditiva; nunca substituir primeiro. |
| Correção apenas na interface do Tauri | Sim | Não | O contrato do recibo deve permanecer intacto. |
| Correção apenas no painel CEP | Não | Sim | Pode usar versão independente da extensão. |
| Alteração apenas no Admin web | Não | Não | Avaliar somente APIs compartilhadas. |
| Migration aditiva não consumida imediatamente | Não | Não | Aplicar antes do código que passa a usá-la. |
| Migration destrutiva ou mudança de semântica | Provavelmente | Talvez | Exige compatibilidade temporária e rollback planejado. |
| Rotação de secret usado só pelo backend | Não | Não | Coordenar Functions e manter rota de recuperação. |
| Novo `.zxp` ou mudança no instalador | Talvez | Sim | Não altera o backend por si só. |

## Mudanças que atingem todos sem instalar nada

Os casos mais sensíveis são:

- políticas globais do Supabase Auth;
- validação de licença nas Edge Functions;
- expiração, revogação e regras de dispositivo;
- secrets usados para assinar recibos;
- migrations das quais uma Function passa a depender;
- limites, bloqueios e configurações aplicados no servidor.

Antes de publicar, testar a versão exata que está em produção. “Não precisa de
novo instalador” não significa “não oferece risco à frota”.

## Ordem segura para banco e Functions

Quando o código novo depende de schema novo:

1. criar uma migration aditiva e compatível com o código antigo;
2. aplicar a migration;
3. aguardar e confirmar a visibilidade do schema pelo PostgREST;
4. publicar Functions que aceitem clientes antigos e novos;
5. testar ativação, validação, recuperação e revogação;
6. distribuir clientes novos, quando necessários;
7. remover a compatibilidade antiga somente após atualizar a frota.

No rollback, volte primeiro a Function para uma versão compatível. Não remova
colunas ou chaves enquanto algum cliente ou backend publicado ainda depender
delas.

## Quando uma nova versão é obrigatória

Distribua uma nova versão quando ocorrer qualquer uma destas situações:

- o Tauri precisa produzir outro formato de autenticação ou request;
- a sessão local precisa ser armazenada, renovada ou invalidada de outra forma;
- o cliente precisa distinguir um erro novo para seguir um fluxo seguro;
- o formato, local, assinatura ou claims obrigatórios do recibo CEP mudam;
- uma chave pública ou certificado confiável precisa entrar no binário;
- o CEP precisa entender um contrato que a versão instalada desconhece;
- a correção depende de código, permissões ou arquivos locais.

Atualize primeiro o consumidor para aceitar os formatos antigo e novo. Só
depois deixe o backend emitir exclusivamente o formato novo.

## Versões independentes

- A versão do Tauri deve permanecer alinhada entre `package.json`,
  `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`.
- A versão da extensão vem de `ARIZONA-EXTENSION/package.json` e do manifesto
  CEP gerado. Ela não deve usar a versão do Tauri como fallback.
- O nome do `.zxp` oficial deriva da versão da extensão.
- Backend, migrations e Admin podem ser publicados sem alterar as versões dos
  clientes somente quando seus contratos continuam compatíveis.

## Registro mínimo antes de uma mudança global

```text
Mudança:
Componentes alterados:
Versões Tauri e CEP atualmente distribuídas:
Impacto sobre sessões e recibos existentes:
Compatibilidade com clientes atuais:
Nova versão necessária:
Ordem de rollout:
Validação:
Rollback:
Comunicação aos usuários ou suporte:
Responsável e data:
```

## Referências

- [Licenciamento e rotações](./LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md)
- [Atualizações independentes do Tauri e CEP](./arquitetura-atualizacoes-independentes-tauri-cep.md)
- [Ações manuais de segurança e release](./ACOES_MANUAIS_SEGURANCA.md)
