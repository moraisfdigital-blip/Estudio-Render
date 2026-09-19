# CLAUDE.md — Render Artelux / Estudio Render

Este arquivo é lido pelo Claude Code em cada worktree Orca deste repo. As regras aqui são as mesmas de `AGENTS.md`; leia os dois antes de codar.

## Antes de qualquer código

1. Leia `docs/PLANO.md` — é a fonte da verdade das fases (FRA-6..FRA-18 no Linear).
2. Leia `AGENTS.md` — Protocolo de Orquestração (como comentar no ticket, `.orchestrator-question`, PR).
3. Identifique **qual fase** este worktree resolve (olhe `--linear-issue` recebido no prompt).
4. Não pule fase. Não misture fases. Uma fatia vertical completa por worktree.

## Regras de execução (inegociáveis)

- **Fatia vertical completa**: nunca "todo o backend" ou "todas as telas" isolados. Botão → endpoint → persistência → banco.
- **`tenant_id`** em toda entidade e toda query desde a Fase 2. Tenant fixo `artelux` via seed/env `DEFAULT_TENANT_SLUG`.
- **RBAC simples**: campo `role` (`owner`/`editor`) no User; sem tela de gestão de permissões.
- **Foto original nunca é sobrescrita.** Qualquer derivado (calibração, máscara, imagem gerada) é um registro/arquivo novo.
- **IA nunca inventa medida.** Toda medida tem `source`: `user_measured` | `estimated`; estimativa é sempre rotulada na UI e nos dados — nunca tratada como fato.
- **Geração de imagem só altera pixels sob máscara de intervenção** (Architecture Lock). Sem máscara válida → recusa (422), não gera "por fora".
- **Integrações externas sempre via adapter + modo mock**: `IMAGE_GEN_PROVIDER=mock`, `PDF_PROVIDER=mock`. Nunca chamar rede real em modo mock. Documentar no PR qual env muda para produção.
- **Config 100% por env.** Nenhum segredo, cor de marca, URL de API ou credencial chumbada no código, commit, PR ou comentário do ticket. `.env` fica no `.gitignore`; `.env.example` é atualizado a cada fatia que introduz uma variável nova.
- **Toda tela tem loading / vazio / erro tratados.** Não existe tela que só funciona no caminho feliz.
- **Todo endpoint valida com Pydantic** e, a partir da Fase 2, checa o tenant do usuário autenticado antes de tocar no banco.

## Definição de pronto (por fatia, Fase 2 em diante)

- [ ] Modelo no banco com `tenant_id`
- [ ] Endpoints com validação Pydantic + checagem de tenant
- [ ] Query escopada por `tenant_id`
- [ ] Tela com loading, vazio e erro
- [ ] Botão realmente chama o endpoint e persiste
- [ ] Testado de verdade (request real / clique / print) — não "deveria funcionar"
- [ ] Sem segredo/cor/URL chumbados

Não marque a fatia como concluída sem testar de verdade. "Testei" significa rodar o comando/request real e mostrar a saída, não descrever o que o código deveria fazer.

## Stack

- Backend: FastAPI (Python) + MongoDB via Motor, async.
- Frontend: React + Tailwind + shadcn/ui; axios com `baseURL: "/api"`.
- Deploy alvo (não fazer deploy agora): single-service — FastAPI serve o build do React + `/api` + fallback SPA.

## Protocolo de comunicação (ver AGENTS.md para o detalhe completo)

- Início, progresso, dúvida e conclusão são sempre comentados no ticket Linear ligado a este worktree.
- Dúvida de produto/decisão de negócio → comente no ticket, crie `.orchestrator-question` na raiz do worktree, e pare até resposta.
- Ao concluir: abra PR contra `main` em `moraisfdigital-blip/estudio-render`. **Não faça merge. Não faça deploy.**
- Nunca finalize com erro, warning ou teste falhando em aberto.
