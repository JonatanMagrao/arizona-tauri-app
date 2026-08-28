# Documentação do Arizona

Esta pasta contém somente documentação operacional vigente e propostas que
ainda representam uma decisão futura do produto. Relatórios pontuais já
concluídos e planos substituídos não permanecem como documentação ativa; o
histórico continua disponível no Git.

## Operação e segurança

- [Política comercial de licenciamento e assinatura](./POLITICA_COMERCIAL_LICENCA_TEMPORARIA.md):
  referência de períodos e preços, assinatura contínua com ou sem SLA, itens
  não incluídos e modalidades de suporte cobrado separadamente.
- [Licenciamento e chaves — não apagar](./LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md):
  contrato de licença, recibo CEP, assinatura do `.zxp`, segredos e rotações.
- [Ações manuais de segurança e release](./ACOES_MANUAIS_SEGURANCA.md): itens que
  dependem de Dashboard, certificado externo, ambiente limpo ou decisão humana.
- [Impacto de mudanças de backend e versões](./impacto-mudancas-backend-e-versoes.md):
  regra para decidir quando uma alteração exige Tauri, CEP ou somente backend.
- [Cache compartilhado de previews dos produtos](./CACHE_PREVIEWS_PRODUTOS.md):
  contrato operacional de aquecimento por Jobão entre o Tauri e o CEP.
- [Diagnósticos locais](./DIAGNOSTICOS_LOCAIS.md): contrato JSONL compartilhado,
  pasta configurável, retenção de 14 dias, migração e exportação para suporte.

## Revisões, implementações e propostas

- [Fila distribuída de render](./arquitetura-fila-render-distribuida.md):
  MVP implementado e backend implantado para disponibilização voluntária de
  máquinas, sincronização de snapshots `.aep` pelo Google Drive e coordenação
  de jobs; a prova real com duas máquinas ainda está pendente.
- [Visualizador de MP4 e limitação de MOV](./REVISAO_VISUALIZADOR_MP4_MOV.md):
  revisão do acesso a arquivos, fallback e mensagens para o usuário.
- [Privacidade, diagnóstico e feedback](./roadmap-privacidade-telemetria.md):
  decisão vigente de diagnóstico somente local e roadmap das frentes de
  privacidade e feedback que ainda dependem de aprovação.
- [Atualizações independentes do Tauri e CEP](./arquitetura-atualizacoes-independentes-tauri-cep.md):
  proposta de longo prazo para distribuição separada dos componentes.
- [Revisão e plano de limpeza das mecânicas do CEP](./REVISAO_LIMPEZA_MECANICAS_CEP.md):
  inventário das mecânicas atuais e legadas, resíduos seguros para limpeza e
  critérios para uma futura remoção de compatibilidade.

## Fontes específicas de cada projeto

- [Tauri / Arizona App](../README.md)
- [Extensão CEP](../ARIZONA-EXTENSION/README.md)
- [Admin e Supabase](../ADMIN/README.md)
- [Instalador](../INSTALLER/README.md)

## Regra de manutenção

Antes de adicionar um documento novo:

1. indicar se ele é operacional, proposta ou registro temporário;
2. informar a data da última revisão;
3. apontar a fonte da verdade quando houver código ou configuração envolvidos;
4. consolidar o conteúdo em um documento vigente quando o trabalho terminar;
5. remover checklists concluídos e descrições que contradigam o produto atual.
