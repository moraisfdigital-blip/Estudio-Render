# ENBY PRO — estado atual e como retomar

**Atualizado em 04/10/2026, ~17:10 (America/Sao_Paulo). Publicado e em uso em https://enbypro.com.** Leia este arquivo antes de qualquer mudança; o histórico técnico da entrega está em [ENBYPRO-RELEASE.md](ENBYPRO-RELEASE.md).

## Onde está cada coisa

- Código desta entrega: branch `codex/enbypro-release`, release no ar `64e1251`, worktree `D:\SET UP NOVO\orca\workspaces\estudio-render\enbypro-release`. [PR #18](https://github.com/moraisfdigital-blip/Estudio-Render/pull/18) **aprovado pelo usuário e mergeado em `main` em 04/10/2026 (merge `fa0e771`)**. A `main` passou a ser igual à versão no ar; trabalho novo parte da `main`.
- Checkout principal: `D:\SET UP NOVO\estudio-render`, na branch `main` (posto em 04/10 na versão oficial, que é igual à versão no ar). A worktree `enbypro-release` continua existindo com a mesma versão.
- Produção: VPS **da Artelux** `srv1951666.hstgr.cloud` (179.199.141.95, Ubuntu 24.04), alias SSH `crmnovo` na máquina do usuário. Decisão do usuário em 04/10: usar esta VPS, sem upgrade de plano.
  - Código em `/opt/enbypro/releases/<sha>`; `/opt/enbypro/current` aponta para a release no ar.
  - Ambiente protegido em `/opt/enbypro/shared/.env` (600). Compose project `enbypro`. App escuta só em `172.18.0.1:8010` (gateway da rede do CRM); Mongo sem porta publicada.
  - Proxy: o **Caddy do DeskcommCRM** (`/opt/deskcommcrm/Caddyfile`). O bloco do `enbypro.com` foi **anexado ao fim** desse arquivo; cópia do original em `/opt/enbypro/backups/Caddyfile.crm.*.bak` e o bloco em `/opt/enbypro/proxy/enbypro.caddy`. HTTPS Let's Encrypt emitido e renovando sozinho.
  - Backup diário do Render: `/etc/cron.d/enbypro-backup` às 06:30 UTC → `/opt/enbypro/bin/backup-diario.sh` (dump do Mongo + mídia, 14 dias, em `/opt/enbypro/backups/`). A Hostinger também faz backup diário da VPS (confirmado pelo usuário).
- DNS `enbypro.com` (conta Hostinger do usuário): `A @ → 179.199.141.95`, `www` CNAME → `enbypro.com`. Sem MX/TXT.
- IA real ligada: `IMAGE_GEN_PROVIDER=openrouter`, modelo `google/gemini-2.5-flash-image`, limite de 20 gerações/hora por tenant. **A chave do OpenRouter vence em 03/11/2026** — criar outra antes (de preferência sem validade) e trocar no `.env` do servidor. Teste real feito: geração em ~10 s, 0 pixels alterados fora da máscara, original intacto.
- Contas no workspace ENBY PRO: só `moraisfdigital@gmail.com` (owner). A conta de teste `teste@enbypro.com` foi apagada a pedido do usuário. Para entregar ao cliente: "Minha conta" → trocar o e-mail para o do cliente (ele confirma pelo link). Nenhuma senha fica em arquivo.

## Como publicar uma versão nova (procedimento usado)

```sh
# na máquina do usuário, a partir da worktree
SHA=$(git rev-parse --short HEAD)
git archive --format=tar.gz -o enbypro-$SHA.tar.gz HEAD
ssh crmnovo "mkdir -p /opt/enbypro/releases/$SHA" && scp enbypro-$SHA.tar.gz crmnovo:/opt/enbypro/releases/
ssh crmnovo "cd /opt/enbypro/releases/$SHA && tar xzf ../enbypro-$SHA.tar.gz && rm ../enbypro-$SHA.tar.gz \
  && nice -n 15 docker compose --env-file /opt/enbypro/shared/.env -p enbypro build -q \
  && docker compose --env-file /opt/enbypro/shared/.env -p enbypro up -d \
  && ln -sfn /opt/enbypro/releases/$SHA /opt/enbypro/current"
```

Depois: `curl https://enbypro.com/api/health` e login real pela tela. Ao apagar releases antigas, **nunca apagar a que `current` aponta** (aconteceu em 04/10 por ordem alfabética; foi restaurada).

Nunca mexer em containers, volumes, `.env` ou cron do DeskcommCRM. Se o CRM atualizar (`hostgator-setup-kit/update.sh` faz `git checkout <tag>` + recria o Caddy), conferir se o bloco do `enbypro.com` continua no `Caddyfile`; se sumir, reanexar `/opt/enbypro/proxy/enbypro.caddy` e `caddy reload`.

## Decisões de interface (04/10) — ler antes de tocar no frontend

- **O painel oficial é a tela do protótipo** https://render-artelux.fmorais.chatgpt.site (topo com logo + nome do projeto + "＋ Novo projeto / Baixar estudo / Apresentar projeto"; abas 01 Levantamento · 02 Projeto visual · 03 Apresentação; "Elementos da obra" à esquerda; "Propriedades" à direita). Depois do login abre **direto esse painel, inteiro**, sem lista de projetos nem formulário à parte. Sem projeto, abre com o exemplo do Posto Horizonte (nada salvo); o que precisa persistir abre a janela "Novo projeto" do próprio protótipo.
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

## Como foi testado nesta sessão

- Backend: suíte de 304 testes já passava antes (ver ENBYPRO-RELEASE.md); não houve mudança de backend nesta sessão.
- Frontend: `tsc`, `oxlint` e `vite build` limpos a cada commit; auditoria com Playwright clicando em **todos os botões** das três abas, com e sem projeto, sem erro de JavaScript; testes de fluxo (entrada, trocar projeto, Sair, rotas antigas, três janelas novas); conferência no site publicado com login real.
- Produção: HTTPS válido até 02/01/2027; HTTP→HTTPS e www→apex; sem login → 401; registro fechado → 403; `/docs` fechado; `.env`/`.git` não expostos; portas 8010 e 27017 fechadas de fora; backup gerado e checksums conferidos.
