# ENBY PRO — estado atual e como retomar

**Atualizado em 04/10/2026, ~17:10 (America/Sao_Paulo). Publicado e em uso em https://enbypro.com.** Leia este arquivo antes de qualquer mudança; o histórico técnico da entrega está em [ENBYPRO-RELEASE.md](ENBYPRO-RELEASE.md).

## Onde está cada coisa

- Código desta entrega: branch `codex/enbypro-release`, release no ar `966e624`, worktree `D:\SET UP NOVO\orca\workspaces\estudio-render\enbypro-release`. [PR #18](https://github.com/moraisfdigital-blip/Estudio-Render/pull/18) aberto em rascunho, **sem merge** — o usuário ainda não autorizou aprovar.
- Checkout do orquestrador: `D:\SET UP NOVO\estudio-render` (branch `moraisfdigital-blip/ui-fase1-shell`, sincronizada com o remoto).
- Produção: VPS **da Artelux** `srv1951666.hstgr.cloud` (179.199.141.95, Ubuntu 24.04), alias SSH `crmnovo` na máquina do usuário. Decisão do usuário em 04/10: usar esta VPS, sem upgrade de plano.
  - Código em `/opt/enbypro/releases/<sha>`; `/opt/enbypro/current` aponta para a release no ar.
  - Ambiente protegido em `/opt/enbypro/shared/.env` (600). Compose project `enbypro`. App escuta só em `172.18.0.1:8010` (gateway da rede do CRM); Mongo sem porta publicada.
  - Proxy: o **Caddy do DeskcommCRM** (`/opt/deskcommcrm/Caddyfile`). O bloco do `enbypro.com` foi **anexado ao fim** desse arquivo; cópia do original em `/opt/enbypro/backups/Caddyfile.crm.*.bak` e o bloco em `/opt/enbypro/proxy/enbypro.caddy`. HTTPS Let's Encrypt emitido e renovando sozinho.
  - Backup diário do Render: `/etc/cron.d/enbypro-backup` às 06:30 UTC → `/opt/enbypro/bin/backup-diario.sh` (dump do Mongo + mídia, 14 dias, em `/opt/enbypro/backups/`). A Hostinger também faz backup diário da VPS (confirmado pelo usuário).
- DNS `enbypro.com` (conta Hostinger do usuário): `A @ → 179.199.141.95`, `www` CNAME → `enbypro.com`. Sem MX/TXT.
- IA real ligada: `IMAGE_GEN_PROVIDER=openrouter`, modelo `google/gemini-2.5-flash-image`, limite de 20 gerações/hora por tenant. **A chave do OpenRouter vence em 03/11/2026** — criar outra antes (de preferência sem validade) e trocar no `.env` do servidor. Teste real feito: geração em ~10 s, 0 pixels alterados fora da máscara, original intacto.
- Contas no workspace ENBY PRO: `moraisfdigital@gmail.com` (owner, usuário) e `teste@enbypro.com` (owner, criada para o cliente testar — o usuário ainda vai decidir se mantém). Senhas em `Documents\ENBYPRO-acesso-admin.txt` e `Documents\ENBYPRO-acesso-cliente-teste.txt` na máquina do usuário; nunca no repositório ou no chat.

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
- **Opção B escolhida pelo usuário:** o link "Ferramentas do projeto" (telas antigas em modal: `LevantamentoPersistido`, `PresentationPanel`, `TakeoffPanel`) **continua** até ele mandar apagar. Não apagar sem ordem.
- Não propor nem criar tela que não exista no protótipo sem mostrar a referência e perguntar. O usuário se irritou com painéis inventados.

## Conta, senha e e-mail (04/10, noite)

- **Regra do usuário: senha só se troca por link enviado ao e-mail.** Nunca pedir a senha antiga, nunca outro caminho. "Esqueci minha senha / quero trocar" na entrada → e-mail → `/redefinir-senha?token=` → senha nova. Em "Minha conta" (botão na barra do painel) o botão de senha manda o mesmo link.
- Trocar o e-mail de login (para passar a conta ao cliente): "Minha conta" → e-mail novo → link vai **para o e-mail novo** → `/confirmar-email?token=` → só então o login muda. Nome muda na hora.
- Links: uso único, 60 min, só o SHA-256 no banco (`password_resets`), pedido novo anula o anterior, URL sempre de `PUBLIC_BASE_URL`. Trocar senha/e-mail encerra as sessões abertas.
- **Envio de e-mail ainda desligado em produção (`EMAIL_PROVIDER=none`)**: a tela avisa "o envio de e-mail ainda não está ligado". Para ligar: conta no Resend, verificar `enbypro.com` (registros DNS que o Resend mostra), pôr `EMAIL_PROVIDER=resend` e `RESEND_API_KEY` no `.env` do servidor e recriar o container.

## Pendências (em ordem)

1. **Ligar o envio de e-mail** (Resend) — sem isso, "esqueci minha senha" e "trocar e-mail" só avisam que não há envio.
2. Decisão do usuário sobre a conta `teste@enbypro.com` (manter ou apagar).
3. Apagar as telas antigas ("Ferramentas do projeto") quando autorizado.
4. Aprovar/mergear o PR #18 quando o usuário disser "pode aprovar".
5. Confirmar que o limite de gasto da chave OpenRouter foi salvo (US$ 10/semana estava sendo configurado); trocar a chave antes de 03/11/2026.
6. `frontend/testes/calibracao-geometria.mjs` está quebrado desde a troca de tela da sessão anterior (procura botões que não existem mais); precisa ser reescrito para o painel do protótipo.
7. Cópia de backup fora da VPS além da da Hostinger (ex.: Drive) — opcional.

## Como foi testado nesta sessão

- Backend: suíte de 304 testes já passava antes (ver ENBYPRO-RELEASE.md); não houve mudança de backend nesta sessão.
- Frontend: `tsc`, `oxlint` e `vite build` limpos a cada commit; auditoria com Playwright clicando em **todos os botões** das três abas, com e sem projeto, sem erro de JavaScript; testes de fluxo (entrada, trocar projeto, Sair, rotas antigas, três janelas novas); conferência no site publicado com login real.
- Produção: HTTPS válido até 02/01/2027; HTTP→HTTPS e www→apex; sem login → 401; registro fechado → 403; `/docs` fechado; `.env`/`.git` não expostos; portas 8010 e 27017 fechadas de fora; backup gerado e checksums conferidos.
