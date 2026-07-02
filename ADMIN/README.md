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
Se a porta estiver ocupada, o Vite usa a proxima disponivel e mostra a URL no terminal.

Depois do build, a pagina fica em `ADMIN/dist/index.html`.
Para testar o build:

```powershell
cd ADMIN
npm run build
npm run preview
```

Abra a URL mostrada pelo Vite. A porta inicial do preview e `1431`.
Se a porta estiver ocupada, use a URL indicada pelo Vite.

Fluxo atual:

1. Criar o usuario master no Supabase Auth, com email e senha definidos fora do painel local.
2. Garantir que o mesmo email exista em `licensing.master_accounts` com status `active`.
3. Entrar no painel local com email e senha do usuario master.
4. Salvar a licenca do Grupo Arizona com seats, validade e usuarios.
5. A tela mostra uma linha de usuario para cada seat.
6. Cada usuario pode ser marcado como gestor por um toggle.
7. Apenas o master admin define quem e gestor.
8. Gestores podem adicionar/remover usuarios no painel futuro, mas nao podem promover outro gestor.
9. O dominio dos usuarios e fixo: `arizona.global`.
10. O master admin pode usar o app Tauri sem consumir seat.
11. Cada usuario pode ter apenas uma maquina/device ativo.
12. O device e registrado automaticamente no login/validacao do Tauri.
13. Liberar um device nao remove o usuario; apenas permite ativar outra maquina.
14. Limpar um usuario libera o seat e revoga devices e sessoes ativas desse usuario.
15. O cadastro chama a Edge Function `master-create-organization`.
16. A pagina faz reload apos salvar a licenca.

Sem sessao master ativa, a tela local mostra apenas o login.

Para o primeiro acesso, crie no Supabase Auth um usuario com o mesmo email liberado
em `licensing.master_accounts`. O painel local nao cria usuarios master.

Projeto Supabase:

- Ref: `nizchnscqkixawqxrwzd`
- URL: `https://nizchnscqkixawqxrwzd.supabase.co`

Use somente publishable keys novas. Nao use chaves legacy anon/service_role.
