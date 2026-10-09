# ENBY PRO — estado atual e como retomar

**Atualizado em 09/10/2026. Release no ar: `0fb12ce` (branch `codex/levantamento-layout`, PR #20 ainda sem merge — a `main` NÃO tem este layout).** Mudanças de 09/10, pedidas e aprovadas pelo usuário: nas abas **02 Projeto visual** e **03 Apresentação** sai só a parte visual da coluna "Estrutura do projeto" e das Propriedades (na 02 até o Catálogo; na 03 o Catálogo fica). É só CSS (`DESIGN_LAYOUT_CSS`, `PRESENTATION_LAYOUT_CSS`); as funções continuam na aba 01. Backup pré-publicação: `/opt/enbypro/backups/enbypro-20261009T044358Z`; imagem de retorno `enbypro-app:before-0fb12ce`; release anterior `eb12598` preservada.

**Atualizado em 06/10/2026 (America/Sao_Paulo). Release `eb12598` publicada às 22:39 em https://enbypro.com e aprovada visualmente pelo usuário após a publicação.** Leia este arquivo antes de qualquer mudança; o histórico técnico da entrega está em [ENBYPRO-RELEASE.md](ENBYPRO-RELEASE.md).

## Onde está cada coisa

- Código publicado: commit `eb1259842f2473bb3c77244e1d330d3f89c127e0`, branch `codex/levantamento-layout`, worktree `D:\SET UP NOVO\orca\workspaces\estudio-render\levantamento-layout`. [PR #20](https://github.com/moraisfdigital-blip/Estudio-Render/pull/20) aberto em rascunho, **sem merge**. Commits posteriores apenas de documentação não alteram o commit publicado.
- Checkout principal: `D:\SET UP NOVO\estudio-render`, branch `main`, base `d862fdd`. **A main ainda não contém o layout publicado.** Continuar esta entrega na worktree acima; não sobrescrever a produção com a main antiga. O `debug.log` preexistente foi preservado.
- Entrega anterior: `64e1251`, worktree `enbypro-release`. PRs #18/#19 são históricos e já estavam integrados. O usuário autorizou continuar sem Orca nesta sessão.
- Produção: VPS **da Artelux** `srv1951666.hstgr.cloud` (179.199.141.95, Ubuntu 24.04), alias SSH `crmnovo` na máquina do usuário. Decisão do usuário em 04/10: usar esta VPS, sem upgrade de plano.
  - Código em `/opt/enbypro/releases/<sha>`; `/opt/enbypro/current` aponta para `/opt/enbypro/releases/0fb12ce` (antes: `eb12598`). A release anterior `64e1251` e a imagem `enbypro-app:before-eb12598` foram preservadas.
  - Ambiente protegido em `/opt/enbypro/shared/.env` (600). Compose project `enbypro`. App escuta só em `172.18.0.1:8010` (gateway da rede do CRM); Mongo sem porta publicada.
  - Proxy: o **Caddy do DeskcommCRM** (`/opt/deskcommcrm/Caddyfile`). O bloco do `enbypro.com` foi **anexado ao fim** desse arquivo; cópia do original em `/opt/enbypro/backups/Caddyfile.crm.*.bak` e o bloco em `/opt/enbypro/proxy/enbypro.caddy`. HTTPS Let's Encrypt emitido e renovando sozinho.
  - Backup diário do Render: `/etc/cron.d/enbypro-backup` às 06:30 UTC → `/opt/enbypro/bin/backup-diario.sh` (dump do Mongo + mídia, 14 dias, em `/opt/enbypro/backups/`). A Hostinger também faz backup diário da VPS (confirmado pelo usuário).
- DNS `enbypro.com` (conta Hostinger do usuário): `A @ → 179.199.141.95`, `www` CNAME → `enbypro.com`. Registros de e-mail adicionados em 04/10 estão descritos abaixo; nenhum DNS foi alterado nesta publicação.
- IA real ligada: `IMAGE_GEN_PROVIDER=openrouter`, modelo `google/gemini-2.5-flash-image`, limite de 20 gerações/hora por tenant. **A chave do OpenRouter vence em 03/11/2026** — criar outra antes (de preferência sem validade) e trocar no `.env` do servidor. Teste real feito: geração em ~10 s, 0 pixels alterados fora da máscara, original intacto.
- Contas no workspace ENBY PRO: só `moraisfdigital@gmail.com` (owner). A conta de teste `teste@enbypro.com` foi apagada a pedido do usuário. Para entregar ao cliente: "Minha conta" → trocar o e-mail para o do cliente (ele confirma pelo link). Nenhuma senha fica em arquivo.

## Publicação de 06/10 e retomada segura

- Apenas `frontend/src/pages/Levantamento.tsx` mudou no código executado. Backend, dependências declaradas, Dockerfile e Compose foram comparados na VPS e permaneceram iguais. CRLF/LF foi normalizado na comparação.
- Backup de banco e mídia: `/opt/enbypro/backups/deploy-eb12598/enbypro-20261007T013712Z/`, com `SHA256SUMS` verificado.
- Script e log usados: `/opt/enbypro/backups/deploy-eb12598/publish.sh` e `publish.log`. São evidências desta execução; não reexecutar como script genérico.
- Foi usado `docker compose --env-file /opt/enbypro/shared/.env -p enbypro build app` e depois `up -d --no-deps --no-build --wait --wait-timeout 90 app`. Só o container app foi recriado. Mongo e serviços do CRM mantiveram IDs e horários de início.
- Na próxima publicação autorizada: confirmar commit/release, criar backup e preservar a imagem anterior, gerar `git archive`, verificar hash, extrair em uma nova pasta e comparar o escopo. Só atualizar `current` após saúde OK; conferir HTTPS e sessão autenticada.
- Nunca apagar a release apontada por `current` nem usar `docker compose down -v`.

### Retorno à versão anterior

Somente se solicitado ou necessário em uma publicação autorizada, confirmar a existência destes caminhos e da imagem preservada e executar:

```sh
docker tag enbypro-app:before-eb12598 enbypro-app:latest
cd /opt/enbypro/releases/64e1251
docker compose --env-file /opt/enbypro/shared/.env -p enbypro up -d --no-deps --no-build --wait --wait-timeout 90 app
ln -sfn /opt/enbypro/releases/64e1251 /opt/enbypro/current
curl -fsS https://enbypro.com/api/health
```

Isso reverte a aplicação sem restaurar/apagar banco ou fotos. Não foi necessário nesta publicação.

Nunca mexer em containers, volumes, `.env` ou cron do DeskcommCRM. Se o CRM atualizar (`hostgator-setup-kit/update.sh` faz `git checkout <tag>` + recria o Caddy), conferir se o bloco do `enbypro.com` continua no `Caddyfile`; se sumir, reanexar `/opt/enbypro/proxy/enbypro.caddy` e `caddy reload`.

## Decisões de interface — aprovação vigente de 06/10

- **O painel oficial é a tela do protótipo** https://render-artelux.fmorais.chatgpt.site (topo com logo + nome do projeto + "＋ Novo projeto / Baixar estudo / Apresentar projeto"; abas 01 Levantamento · 02 Projeto visual · 03 Apresentação; nas abas preservadas, "Elementos da obra" à esquerda e "Propriedades" à direita). **Exceção aprovada: Levantamento usa o layout horizontal abaixo.** Depois do login abre **direto esse painel, inteiro**, sem lista de projetos nem formulário à parte. Sem projeto, abre com o exemplo do Posto Horizonte (nada salvo); o que precisa persistir abre a janela "Novo projeto" do próprio protótipo.
- **Levantamento aprovado em 06/10:** conteúdo em largura total abaixo da barra de abas, sem as colunas laterais apenas nesta aba. Propriedades entre a biblioteca e as fotos por área, em quatro grupos: Dimensões e posição, Material e acabamento, Cor de referência/Catálogo e Identidade visual.
- O seletor **Elemento da obra** substitui a lista lateral, com **Novo elemento** ao lado. Aplicar ao projeto, Duplicar e Excluir continuam disponíveis. Upload, agrupamento por área e calibração seguem conectados.
- Cabeçalho, logo, nome do projeto, ações superiores, abas, tema, Minha conta e Sair preservados. Projeto visual e Apresentação mantêm o layout anterior. Em telas menores, propriedades em duas ou uma coluna.
- Foram movidos os mesmos controles, preservando handlers e contratos de API. Aprovação do usuário após o deploy: **“certinho”**. [Captura publicada](evidencias/levantamento-2026-10-06/enbypro-publicado.jpg).
- Rotas: `/` decide (último projeto usado → `/projeto/:id/levantamento`; nenhum → `/estudio/levantamento`). Rotas antigas (`/projetos`, `/projeto/novo`, `/projeto/:id/editar`) caem na entrada. Telas `DashboardPage`, `ProjectFormPage`, `ProjectDetailPage`, `SurveyPanel`, `AppShell`, `StepNav`, `TrilhaEtapas`, `pickers` foram removidas.
- Funções sem lugar no protótipo viraram **janelas por cima do painel** (`JanelaPainel`): Catálogo de materiais (botão no painel Propriedades), Apresentação aprovada e PDF, Quantitativo e orçamento (aba 03) — além das já existentes Máscaras, Gerar proposta com IA, Versões.
- **Telas antigas apagadas (04/10, PR #19, autorizado pelo usuário):** não existe mais "Ferramentas do projeto", a página `/materiais` nem o cabeçalho antigo. O que só existia nelas foi para a barra da aba 02: **Elementos e medidas** (cadastro com medida conferida, que alimenta o orçamento), **Foto original** e **Remover foto**.
- Não propor nem criar tela que não exista no protótipo sem mostrar a referência e perguntar. O usuário se irritou com painéis inventados.

## Conta, senha e e-mail (04/10, noite)

- **Regra do usuário: senha só se troca por link enviado ao e-mail.** Nunca pedir a senha antiga, nunca outro caminho. "Esqueci minha senha / quero trocar" na entrada → e-mail → `/redefinir-senha?token=` → senha nova. Em "Minha conta" (botão na barra do painel) o botão de senha manda o mesmo link.
- Trocar o e-mail de login (para passar a conta ao cliente): "Minha conta" → e-mail novo → link vai **para o e-mail novo** → `/confirmar-email?token=` → só então o login muda. Nome muda na hora.
- Links: uso único, 60 min, só o SHA-256 no banco (`password_resets`), pedido novo anula o anterior, URL sempre de `PUBLIC_BASE_URL`. Trocar senha/e-mail encerra as sessões abertas.
- **Envio de e-mail ligado (04/10, 22h30):** `EMAIL_PROVIDER=resend`, remetente `ENBY PRO <nao-responda@enbypro.com>`, domínio verificado no Resend (região sa-east-1). DNS: TXT `resend._domainkey` (DKIM), CNAME `rsend` → `rsend-sae1.forge.rmta.net`, CNAME `send` → `send.forge.rmta.net`, TXT `_dmarc` = `v=DMARC1; p=none;`. Chave do Resend só no `.env` do servidor (cópia local do usuário em `Downloads/N8N/CLAUDE/projetos/apy resend enby pro.txt`). Teste real: link de senha entregue no Gmail do usuário (status `delivered`). Sem envio configurado (`EMAIL_PROVIDER=none`), a tela avisa em vez de fingir que enviou.

## Pendências (em ordem)

1. Confirmar que o limite de gasto da chave OpenRouter foi salvo (US$ 10/semana estava sendo configurado); **trocar a chave antes de 03/11/2026**.
2. **Reescrever o teste automático da calibração** — ver a seção "Tarefa: reescrever o teste da calibração" logo abaixo. Não é urgente (a calibração funciona), mas hoje nada protege contra o defeito voltar.
3. Cópia de backup fora da VPS além da da Hostinger (ex.: Drive) — opcional.

## Tarefa: reescrever o teste da calibração

**Situação (04/10/2026):** `frontend/testes/calibracao-geometria.mjs` não roda mais. Ele foi escrito para o antigo diálogo de calibração (`CalibrationDialog`), apagado quando o painel do protótipo virou a tela oficial. A calibração continua funcionando no painel; o que falta é a proteção automática.

**Por que importa:** é a calibração que dá a escala da foto, e dela saem as medidas do projeto e do orçamento. Já houve um defeito real: em janela baixa, o clique era gravado no pixel errado (até 353 px de desvio numa foto de 1600 px, ~22%), porque a conta ignorava as tarjas do encaixe da foto. O teste existia para esse defeito não voltar sem ninguém perceber.

**Onde a calibração mora hoje:** `frontend/src/pages/Levantamento.tsx`, aba 01, dentro do shadow DOM do painel (`[data-artelux-visual]`, modo `open`). Elementos: `#calibrationStage` (área clicável), `#surveyPhoto` (a foto), `#pointA`/`#pointB`, `#referenceDistance`, `#calibrate`, `#saveMeasurement`. A conversão clique → pixel da foto é a função `imagePoint` (encaixe tipo `object-fit: contain`, com tarjas). O que fica gravado é lido em `GET /api/photos/{id}/calibration` (`point_a`, `point_b`, em pixels da foto original).

**Como fazer (Playwright; os seletores CSS atravessam o shadow DOM aberto):**
1. Montar o próprio cenário, sem depender de id fixo: entrar, criar projeto pela janela "＋ Novo projeto" e subir uma foto de tamanho conhecido (ex.: 1600×1200) por `#photoInput`.
2. Para cada janela — 1500×1000, 1500×760 e 1500×560 (a mais baixa força as tarjas):
   - selecionar a foto, ler o retângulo de `#calibrationStage` e calcular onde dois pontos conhecidos da foto (ex.: (200, 300) e (1400, 900)) aparecem na tela, com a mesma regra de encaixe;
   - clicar nesses dois lugares, informar uma distância, clicar em `#calibrate` e `#saveMeasurement`;
   - buscar `GET /api/photos/{id}/calibration` e comparar `point_a`/`point_b` com os pontos mirados.
3. Rodar contra o app local (backend + build do front, banco de teste descartável) e apagar o banco no fim.

**Pronto quando:** nas três alturas de janela, os dois pontos gravados ficam a **no máximo 6 px** dos pontos mirados; sem erro de JavaScript; o teste sai com código ≠ 0 se falhar; o arquivo antigo é substituído (ou apagado) e o README, na seção "Testes", explica como rodar.

## Verificação desta entrega — 06/10/2026

- `npm.cmd run build`, `npm.cmd run lint` e `git diff --check` passaram.
- Playwright local com API simulada: seleção, aplicar dimensões/texto, criar, duplicar, excluir, catálogo, seletor de arquivos e salvar/recarregar com foto ativa; payload do salvamento conferido.
- Cabeçalho/navegação e abas Projeto visual/Apresentação com capturas idênticas à base em 1600px. Claro/escuro e larguras 1600, 1024, 768 e 390px conferidos, sem transbordamento do conteúdo do Levantamento.
- Produção: HTTPS 200; saúde app/banco OK; `/api/projects` sem login → 401; container saudável. Chrome autenticado recarregado, layout e seletor conferidos, sem erro no console. Nenhuma edição foi salva nos projetos durante a conferência.
- Backend, IA real e teste completo de calibração não foram reexecutados nesta entrega visual; as pendências anteriores continuam registradas.
- [Validação local](evidencias/levantamento-2026-10-06/validation.json) · [Publicação](evidencias/levantamento-2026-10-06/deployment-eb12598.json).
- Pacote local: `D:\SET UP NOVO\estudio-render\var\salvamentos\enbypro-levantamento-2026-10-06.zip`. Contém código publicado, documentação, capturas e registros, sem `.env`, chaves, banco ou mídia de produção.

## Verificação histórica — 04/10/2026

- Backend: suíte de 304 testes já passava antes (ver ENBYPRO-RELEASE.md); não houve mudança de backend nesta sessão.
- Frontend: `tsc`, `oxlint` e `vite build` limpos a cada commit; auditoria com Playwright clicando em **todos os botões** das três abas, com e sem projeto, sem erro de JavaScript; testes de fluxo (entrada, trocar projeto, Sair, rotas antigas, três janelas novas); conferência no site publicado com login real.
- Produção: HTTPS válido até 02/01/2027; HTTP→HTTPS e www→apex; sem login → 401; registro fechado → 403; `/docs` fechado; `.env`/`.git` não expostos; portas 8010 e 27017 fechadas de fora; backup gerado e checksums conferidos.
