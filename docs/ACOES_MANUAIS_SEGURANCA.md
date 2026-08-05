# Ações manuais de segurança e release

**Status:** checklist operacional vigente
**Última revisão:** 04/08/2026

Este documento contém apenas verificações que não podem ser concluídas pelo
código do repositório: configuração externa, certificado de distribuição,
validação em máquina limpa e decisões operacionais.

Para arquitetura de licença, chaves e rotação, consulte
[LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md](./LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md).

## 1. Assinatura para distribuição pública

A extensão CEP já possui fluxo de geração e validação de `.zxp` assinado. Isso
não assina o executável do Tauri nem o instalador NSIS.

Antes de uma distribuição pública:

- obter uma identidade Authenticode adequada para a Arizona;
- assinar `arizona-app.exe` e o setup NSIS com timestamp;
- executar `npm run release:verify-public`;
- confirmar `Get-AuthenticodeSignature.Status = Valid` nos dois artefatos;
- manter certificados privados, senhas e credenciais de assinatura fora do Git.

O gate de release apenas verifica as assinaturas. Ele não assina os arquivos e
não substitui a obtenção do certificado ou serviço de assinatura.

O certificado atual do `.zxp` usa um perfil legado. Uma troca futura deve ser
tratada como rotação aditiva planejada. Não execute `npm run cep:cert` novamente
para tentar “atualizá-lo”.

## 2. Smoke test do instalador Full

Ainda é necessária uma validação completa em Windows limpo ou VM descartável:

1. manter `PlayerDebugMode` ausente ou desligado;
2. instalar o Full com o After Effects fechado;
3. confirmar a extensão em
   `%CommonProgramW6432%\Adobe\CEP\extensions\com.arizona-carrefour.cep`;
4. abrir uma versão suportada do After Effects;
5. confirmar que o painel aparece sem modo de depuração;
6. ativar a licença e verificar que o painel é liberado;
7. executar pelo menos uma ação real da extensão;
8. validar os atalhos do Tauri que chamam o After Effects;
9. testar upgrade sobre uma versão anterior e sobre uma junction de dev;
10. desinstalar e confirmar a remoção da extensão, sem apagar arquivos alheios;
11. testar uma máquina que ainda possua o AEX legado exato;
12. confirmar que nenhuma pasta `Plug-ins\Arizona` nova foi criada.

Registrar versão do Windows, versão do After Effects, versão do Tauri, versão
do CEP e resultado de cada etapa. Um teste parcial não deve ser anotado como
aprovação completa do Full.

Matriz mínima adicional:

- máquina sem After Effects instalado;
- After Effects 2025, 2026 e as duas versões na mesma máquina;
- conta sem privilégio administrativo, incluindo cancelamento da elevação;
- reinstalação da mesma versão e upgrade de uma versão anterior;
- desinstalação preservando dados locais;
- desinstalação removendo dados locais e tentando liberar o dispositivo;
- desinstalação sem rede, que não pode impedir a remoção local.

## 3. Supabase e autenticação

No Dashboard do projeto de produção:

- confirmar a política de cadastro público do Supabase Auth;
- revisar provedores e URLs de redirecionamento, sem protocolo `arizona://`;
- manter o acesso do master coerente com o fluxo atual do Admin;
- confirmar que migrations locais e remotas estão em paridade;
- confirmar que somente as Edge Functions previstas para o release estão
  publicadas e ativas;
- verificar RLS, grants e o Security Advisor;
- conferir os secrets necessários sem copiá-los para tickets ou para o Git.

Quando uma Function passar a depender de coluna ou tabela nova, siga a ordem:

1. aplicar a migration;
2. confirmar que o novo schema já está visível pelo PostgREST;
3. publicar as Functions;
4. testar com a versão de cliente que está distribuída.

## 4. Vínculo explícito do master

Todo master precisa estar associado ao usuário correto do Supabase Auth. Faça a
conferência diretamente no banco ou no fluxo administrativo adotado para o
ambiente. Nunca associe uma conta automaticamente apenas pela coincidência de
e-mail.

## 5. Retenção e operação

Se `pg_cron` estiver habilitado, confirmar que
`licensing.purge_operational_data()` está agendada e sendo executada. Também é
necessário:

- testar restauração de backup;
- decidir se PITR é necessário para o RPO/RTO do produto;
- exigir SSL nas conexões diretas ao banco;
- revisar restrições de rede e acessos administrativos;
- configurar alertas de custo, Auth, Edge Functions e erros relevantes;
- revisar periodicamente auditoria, rate limits e dispositivos revogados.

## 6. Comandos de verificação

Na raiz do repositório:

```powershell
npm run license:check
npm run release:check
npm run installer:test
npm run release:verify-public
```

Os testes automatizados reduzem o risco, mas não substituem Authenticode válido
nem o smoke test em uma instalação limpa.
