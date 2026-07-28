# Arquitetura futura de atualizações independentes — Tauri e CEP

**Status:** proposta de longo prazo — não implementar agora  
**Atualizado em:** 28/07/2026  
**Escopo:** Arizona App (Tauri), extensão CEP e o contrato de licença entre eles  
**Fora do escopo:** Admin, mudanças imediatas no instalador e rotação de chaves

Este documento descreve como permitir que o Arizona App e a extensão CEP sejam
atualizados separadamente. Ele não autoriza alteração de código, instalador,
backend, chaves, pipeline ou infraestrutura de releases.

## 1. Decisão arquitetural

Tauri e CEP devem poder receber versões independentes.

Uma atualização conjunta será necessária somente quando houver uma mudança
incompatível no contrato compartilhado, como:

- formato ou localização do recibo de licença;
- protocolo de compatibilidade;
- conjunto de chaves públicas confiáveis;
- regra de segurança que exija uma versão mínima dos dois componentes;
- fluxo funcional que dependa simultaneamente de código novo nos dois lados.

O instalador unificado continuará existindo para:

- primeira instalação;
- reparo;
- recuperação de uma instalação inconsistente;
- migrações estruturais;
- remoção completa.

Distribuir os componentes juntos será uma opção de release, não uma obrigação
arquitetural.

## 2. Situação atual

### 2.1 Separação que já existe

- Tauri e CEP são projetos independentes, com `package.json`, lockfile, build e
  código próprios.
- O Tauri não importa código da extensão.
- A extensão não recebe comandos do Tauri.
- O contrato de runtime é o arquivo:

```text
%LOCALAPPDATA%\com.pc.arizona-app\cep-license-receipt.json
```

- O Tauri obtém o recibo assinado do backend e o grava localmente.
- A extensão relê o arquivo e valida assinatura, emissor, audiência, validade e
  feature autorizada.
- A extensão possui versão própria no manifesto CEP.

Essa separação já permite tecnicamente lançar mudanças isoladas, desde que o
contrato do recibo permaneça compatível.

### 2.2 Acoplamento de distribuição atual

O instalador NSIS oficial contém:

- Arizona App;
- payload compilado da extensão CEP;
- hooks de instalação, upgrade e desinstalação.

O hook copia e valida a extensão no perfil do usuário. Portanto, executar hoje
o instalador unificado pode substituir os dois componentes, mesmo quando apenas
um deles mudou.

Esse acoplamento pertence ao empacotamento atual. Ele não é uma dependência do
runtime.

### 2.3 Atualização automática ainda inexistente

- O projeto Tauri não possui atualmente o plugin oficial de updater configurado.
- Não existe manifesto remoto de atualização independente do CEP.
- O CEP não possui um mecanismo de atualização própria.
- Não existe ainda uma matriz publicada de compatibilidade entre versões.

## 3. Objetivos

- Atualizar Tauri sem substituir o CEP quando o contrato não mudou.
- Atualizar CEP sem reinstalar o Tauri.
- Impedir instalação de artefato adulterado ou incompatível.
- Preservar sessão, preferências e dados locais durante updates.
- Permitir rollback seguro do CEP.
- Manter o instalador completo como caminho de recuperação.
- Informar claramente ao usuário qual componente será atualizado.
- Suportar implantação gradual e bloqueio de uma versão defeituosa.

## 4. Não objetivos

- Fazer o CEP modificar os próprios arquivos enquanto está carregado.
- Entregar chave privada ou segredo para Tauri, CEP ou Git.
- Permitir que o frontend escolha qualquer URL de atualização.
- Tornar update obrigatório para toda correção pequena.
- Instalar silenciosamente artefato não assinado.
- Manter duas cópias concorrentes da mesma extensão CEP.
- Remover o instalador unificado.

## 5. Arquitetura-alvo

### 5.1 Componentes

#### Instalador unificado

Responsável por primeira instalação, reparo e migrações estruturais. Ele instala
uma combinação conhecida e testada de Tauri e CEP.

#### Atualizador do Tauri

Usará o mecanismo oficial do Tauri para:

- consultar um endpoint ou manifesto estático;
- comparar a versão atual com a publicada;
- baixar o instalador correspondente;
- verificar obrigatoriamente sua assinatura;
- instalar e reiniciar o aplicativo de maneira controlada.

A documentação oficial do Tauri informa que a verificação de assinatura do
updater é obrigatória e não pode ser desativada.

#### Atualizador do CEP

Será executado pelo backend Rust do Tauri, nunca pelo JavaScript da extensão.

Responsabilidades:

1. consultar o manifesto confiável do CEP;
2. avaliar compatibilidade com o Tauri e o protocolo do recibo;
3. baixar o artefato em diretório temporário;
4. validar tamanho, hash e assinatura;
5. validar identidade, versão e estrutura interna;
6. preparar a nova pasta em staging;
7. preservar uma cópia recuperável da versão anterior;
8. trocar a pasta instalada de forma controlada;
9. validar o fingerprint final;
10. restaurar a versão anterior se a validação falhar.

O CEP apenas exibe sua versão e, quando necessário, orienta o usuário a abrir o
Tauri. Ele não baixa nem instala a si próprio.

#### Serviço de releases

Hospedará artefatos imutáveis e manifestos separados:

```text
tauri-latest.json
cep-latest.json
```

O manifesto do Tauri seguirá o contrato exigido pelo updater oficial. O
manifesto do CEP será específico do produto.

### 5.2 Fluxo resumido

```text
Serviço de releases
    ├── manifesto + artefato assinado do Tauri
    └── manifesto + artefato assinado do CEP
              |
              v
       Arizona App (Rust)
         ├── atualiza o próprio aplicativo
         └── instala/recupera a extensão CEP
                       |
                       v
       %APPDATA%\Adobe\CEP\extensions\
         com.arizona-carrefour.cep
```

O instalador unificado permanece como rota independente para bootstrap e
reparo.

## 6. Manifesto futuro do CEP

Exemplo conceitual:

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "version": "1.2.0",
  "publishedAt": "2026-07-28T12:00:00Z",
  "url": "https://releases.example.com/cep/1.2.0/arizona-cep.zip",
  "sha256": "HASH_DO_ARTEFATO",
  "signature": "ASSINATURA_DESTACADA",
  "minimumTauriVersion": "2.1.1",
  "minimumReceiptProtocol": 1,
  "maximumReceiptProtocol": 1,
  "requiresAfterEffectsRestart": true,
  "notes": "Correções e melhorias."
}
```

O formato final poderá mudar durante o projeto. Os campos mínimos deverão
permitir:

- identificar o schema do próprio manifesto;
- identificar versão e canal;
- validar integridade e autenticidade;
- decidir compatibilidade antes do download;
- informar reinício necessário;
- apresentar notas de versão.

URLs serão definidas pelo build/configuração confiável. O frontend não poderá
fornecer ou substituir o endereço do artefato.

## 7. Versionamento

Devem existir quatro versões independentes:

| Item | Exemplo | Finalidade |
|---|---|---|
| Tauri | `2.2.0` | Versão do aplicativo desktop |
| CEP | `1.2.0` | Versão da extensão |
| Protocolo do recibo | `1` | Contrato entre backend, Tauri e CEP |
| Bundle do instalador | `2026.08.0` | Combinação testada para bootstrap/reparo |

Regras:

- Tauri e CEP usam SemVer.
- O protocolo usa inteiro monotônico.
- Mudança interna sem impacto no contrato não altera o protocolo.
- Claim opcional e ignorável pode ser adicionada sem quebrar o protocolo.
- Remover, renomear ou mudar o significado de claim exige nova versão de
  protocolo.
- A versão do CEP em `package.json` e `CSXS/manifest.xml` deve corresponder ao
  artefato publicado.
- O número `0.0.1` atual do CEP não deve ser mantido em releases independentes;
  o versionamento precisa começar a representar releases reais.

## 8. Contrato de compatibilidade

### 8.1 Compatibilidade por leitura

O consumidor deve ser atualizado antes do produtor quando o contrato mudar.

Exemplo:

1. publicar CEP capaz de ler protocolo 1 e 2;
2. confirmar adoção suficiente;
3. atualizar backend/Tauri para produzir protocolo 2;
4. manter protocolo 1 durante a janela de transição;
5. remover compatibilidade antiga somente em release posterior e planejada.

### 8.2 Matriz de decisão

| Mudança | Tauri | CEP | Release |
|---|---:|---:|---|
| Tela/utilitário apenas no Tauri | Atualiza | Mantém | Tauri |
| Correção visual ou funcional só no painel | Mantém | Atualiza | CEP |
| Alteração interna do Tauri sem mudar recibo | Atualiza | Mantém | Tauri |
| Alteração interna do CEP mantendo o recibo | Mantém | Atualiza | CEP |
| Novo claim opcional ignorável | Pode atualizar | Pode manter | Preferencialmente independente |
| Mudança incompatível no recibo | Atualiza | Atualiza | Coordenada e gradual |
| Nova chave de assinatura do recibo | Backend depois | CEP primeiro | Coordenada |
| Falha crítica isolada no CEP | Mantém | Rollback/correção | CEP |

### 8.3 Versão mínima

Versão mínima deve ser usada somente por:

- vulnerabilidade relevante;
- incompatibilidade comprovada;
- migração de protocolo;
- requisito operacional impossível de manter na versão anterior.

Correções comuns devem gerar recomendação de atualização, não bloqueio
automático.

## 9. Cenários de release

### 9.1 Somente Tauri

1. Confirmar que o formato e o caminho do recibo não mudaram.
2. Testar com a versão CEP mais antiga ainda suportada.
3. Publicar artefato e assinatura do Tauri.
4. Atualizar somente o manifesto do Tauri.
5. Monitorar instalação e oferecer reparo pelo instalador completo.

### 9.2 Somente CEP

1. Confirmar versão mínima do Tauri e protocolo suportado.
2. Gerar o bundle de produção e validar as chaves públicas embutidas.
3. Assinar o artefato e publicar hash.
4. Atualizar somente o manifesto do CEP.
5. O Tauri baixa, valida, faz staging e substitui a pasta.
6. Informar que o After Effects precisa ser reaberto quando aplicável.
7. Restaurar automaticamente o backup se a instalação não validar.

### 9.3 Mudança coordenada de protocolo

1. Publicar leitores compatíveis com protocolo antigo e novo.
2. Esperar a cobertura mínima definida para o rollout.
3. Atualizar o produtor do recibo.
4. Observar erros de compatibilidade.
5. Tornar a versão nova obrigatória somente se necessário.
6. Aposentar o protocolo antigo em outro ciclo.

### 9.4 Rotação de chave do recibo

Esse cenário continua seguindo
`LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md`:

1. adicionar a chave pública nova ao conjunto confiável;
2. publicar primeiro o CEP que aceita as duas chaves;
3. confirmar distribuição;
4. trocar o backend para assinar com a chave nova;
5. manter a chave antiga durante a janela de compatibilidade;
6. removê-la somente depois que os clientes antigos forem aposentados.

O updater terá par próprio de assinatura. A chave de atualização não deve ser
reutilizada como chave do recibo de licença.

### 9.5 Rollback

#### CEP

- preservar uma versão anterior por período curto;
- restaurar somente artefato cuja assinatura já tenha sido validada;
- impedir downgrade abaixo da versão mínima de segurança;
- registrar resultado técnico sem guardar conteúdo de projeto.

#### Tauri

- preferir nova versão corretiva;
- usar rollback remoto apenas com suporte explícito do servidor de update;
- manter o instalador unificado anterior disponível para recuperação controlada;
- nunca fazer downgrade automático de dados locais ou migrations.

## 10. Instalação segura do CEP

O atualizador deverá:

- resolver e validar o destino exato antes de escrever;
- detectar junction/symlink de desenvolvimento e não substituí-la
  silenciosamente;
- rejeitar caminhos fora do diretório esperado;
- extrair somente em diretório temporário;
- bloquear `..`, caminhos absolutos e traversal em arquivos compactados;
- impor limites de tamanho, quantidade de arquivos e profundidade;
- rejeitar arquivo executável inesperado;
- validar `CSXS/manifest.xml`, bundle ID e versão;
- impedir duas instalações concorrentes;
- preservar arquivo alheio fora da pasta gerenciada;
- fazer troca e rollback com operações recuperáveis;
- não apagar a instalação atual antes de validar completamente a nova.

A distribuição futura deverá decidir entre:

1. manter o modelo atual de pasta gerenciada e assinar o artefato com a
   infraestrutura própria; ou
2. adotar pacote ZXP assinado e ferramenta de instalação compatível.

Essa escolha deverá ser validada nas versões reais do After Effects usadas pelo
cliente. A Adobe documenta empacotamento/assinatura ZXP e pastas de extensão,
mas a estratégia atual do projeto é uma pasta instalada pelo NSIS.

## 11. Assinaturas e segredos

Devem existir identidades criptográficas distintas:

- assinatura do executável e instalador Windows;
- assinatura exigida pelo updater do Tauri;
- assinatura do artefato CEP ou certificado ZXP;
- assinatura ES256 do recibo de licença.

Regras:

- chaves privadas nunca entram no repositório;
- chaves privadas ficam em cofre de CI ou ambiente de release controlado;
- somente chaves públicas e identificadores podem ser versionados;
- perda de chave precisa de procedimento documentado de recuperação/rotação;
- HTTPS é obrigatório, mas não substitui assinatura do artefato;
- hash detecta corrupção; assinatura estabelece a origem confiável;
- artefato publicado é imutável;
- cada release registra hash, assinatura, data e responsável.

Antes de implementar, criar documento específico para as novas chaves. Não
executar geração ou rotação como parte de build comum.

## 12. Experiência do usuário

O Tauri deve apresentar os componentes separadamente:

```text
Arizona App
Versão instalada: 2.2.0
Estado: atualizado

Extensão After Effects
Versão instalada: 1.2.0
Estado: atualização disponível
Requer reabrir o After Effects
```

Comportamento recomendado:

- checagem discreta em background;
- download somente quando houver release compatível;
- notas específicas por componente;
- progresso e resultado compreensíveis;
- nenhum update no meio de render ou operação crítica;
- CEP nunca é substituído enquanto sua pasta estiver em uso de maneira
  insegura;
- falha mantém a versão atual funcional;
- update obrigatório apenas por segurança ou incompatibilidade;
- ação **Reparar instalação** direciona para o instalador unificado.

## 13. Canais e rollout

Manifestos independentes por canal:

```text
stable
beta
```

O canal beta deve ser explícito e reversível. Não selecionar usuários pelo nome
ou por telemetria comportamental.

Rollout gradual poderá usar lotes determinísticos de instalação ou organização,
com finalidade estritamente operacional. Uma versão pode ser pausada sem
remover o artefato necessário para rollback.

## 14. Pipeline de release

Pipelines separados:

### Tauri

1. testes;
2. verificação de licenciamento;
3. build;
4. assinatura de código;
5. geração e assinatura do artefato do updater;
6. publicação imutável;
7. atualização do manifesto.

### CEP

1. geração das chaves públicas confiáveis;
2. testes e build;
3. validação do manifesto CEP;
4. empacotamento;
5. assinatura;
6. cálculo do hash;
7. teste de instalação e rollback;
8. publicação imutável;
9. atualização do manifesto.

### Instalador unificado

1. selecionar versões Tauri/CEP já aprovadas;
2. coletar artefatos por hash;
3. executar testes de ciclo de vida;
4. assinar o instalador;
5. publicar a combinação como release de bootstrap.

Tags sugeridas:

```text
tauri-v2.2.0
cep-v1.2.0
bundle-v2026.08.0
```

## 15. Fases futuras

### Fase 0 — contrato e disciplina de release

- corrigir o versionamento real do CEP;
- documentar versões suportadas;
- definir protocolo do recibo;
- definir canais e política de versão mínima;
- manter o instalador atual.

### Fase 1 — updater independente do Tauri

- adicionar o updater oficial;
- definir endpoint/manifesto;
- criar e proteger a chave de assinatura;
- testar upgrade `perMachine` e elevação no Windows;
- manter CEP no payload do instalador completo.

### Fase 2 — updater gerenciado do CEP

- definir formato e assinatura do pacote;
- implementar download, staging, validação e rollback no Rust;
- detectar versão instalada;
- testar After Effects aberto e fechado;
- manter reparo pelo instalador.

### Fase 3 — compatibilidade coordenada

- introduzir versão de protocolo;
- publicar matriz de compatibilidade;
- suportar rollout gradual;
- criar bloqueio de versão defeituosa;
- ensaiar rotação de chave sem trocar chaves reais.

### Fase 4 — distribuição corporativa

- avaliar ZXP/Adobe Exchange, ferramenta corporativa ou distribuição interna;
- considerar ambientes sem internet;
- oferecer pacote completo administrável por TI;
- preservar os mesmos controles de assinatura e compatibilidade.

## 16. Critérios de aceite

- Atualização só do Tauri mantém o CEP funcional.
- Atualização só do CEP mantém o Tauri funcional.
- Artefato adulterado é recusado antes de alterar a instalação.
- Versão incompatível não é baixada nem instalada.
- Falha no CEP restaura a versão anterior.
- Instalação de desenvolvimento por junction não é sobrescrita.
- O usuário vê versões e reinícios necessários.
- After Effects aberto é tratado sem corrupção ou perda silenciosa.
- Instalador unificado repara qualquer combinação suportada.
- Rotação de chave segue rollout leitor-primeiro.
- Nenhuma chave privada existe no Git ou no cliente.
- Testes cobrem upgrade, downgrade permitido, rollback, offline e interrupção
  durante instalação.

## 17. Riscos a validar no início do projeto

- comportamento do updater Tauri com instalação `perMachine`;
- necessidade de elevação para atualizar o aplicativo;
- atualização da extensão no perfil correto quando o instalador foi elevado;
- arquivos mantidos abertos pelo After Effects;
- compatibilidade das ferramentas CEP/ZXP com After Effects 2025 e 2026;
- proxy, firewall e ambientes corporativos sem acesso ao endpoint;
- recuperação quando a máquina desliga durante staging ou troca;
- política de expiração e recuperação das chaves do updater;
- coexistência temporária de clientes com protocolos diferentes.

## 18. Referências

- [Tauri v2 — Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri v2 — assinatura no Windows](https://v2.tauri.app/distribute/sign/windows/)
- [Adobe CEP Resources](https://github.com/Adobe-CEP/CEP-Resources)
- [Adobe CEP 11.1 HTML Extension Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/Documentation/CEP%2011.1%20HTML%20Extension%20Cookbook.md)
- [Arquitetura de licenciamento](../LICENCIAMENTO_E_CHAVES_NAO_APAGAR.md)
- [Instalador atual](../INSTALLER/README.md)
- [Plano do instalador unificado](../PLANO_INSTALADOR_UNIFICADO.md)

