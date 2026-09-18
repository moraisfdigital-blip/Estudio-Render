# AGENTS.md — Render Artelux / Estudio Render

Workspace do orquestrador: este repositório. Executores só trabalham em worktrees Orca.

## Escopo (inviolável)

- Repo GitHub: `moraisfdigital-blip/estudio-render` (remote pode aparecer como `Estudio-Render`).
- Worktrees Orca: apenas `D:\SET UP NOVO\orca\workspaces\estudio-render\*`.
- Linear: só o Project **Estudio Render**, Team **FRA**. Títulos com prefixo `[REN]`.
- Sem deploy (Railway / produção) até ordem explícita do orquestrador.
- Pedido de outro projeto: parar.

## Protocolo de Orquestração

Você é executor. O tech lead orquestra por Linear + GitHub + disco. Espelhe **tudo** no ticket Linear ligado (`--linear-issue`).

### Início

Comente no ticket: o que vai fazer, branch, worktree, critérios de aceite que entendeu.

### Progresso

Comente checkpoints (modelo, endpoint, tela, teste). Sem segredos, tokens ou `.env` real.

### Dúvida (bloqueio)

1. Comente no ticket a pergunta objetiva (opções se houver).
2. Crie `.orchestrator-question` na raiz do worktree com a mesma pergunta.
3. **Cheque a resposta a cada 2 minutos** (comentários do ticket). Não invente produto.
4. Se a sessão já fechou, o orquestrador re-dispara com `--linear-issue <ID>`; o histórico do ticket é o contexto.

### Conclusão

Comente no ticket: o que foi feito, como testou (comando/request/clique), o que falta, link do PR.

- Abra PR contra `main` em `moraisfdigital-blip/estudio-render`.
- **Não faça merge. Não faça deploy.**
- Não finalize com erro, warning ou teste falhando em aberto.

### Qualidade

- Fatia vertical: botão → endpoint → persistência; tela com loading / vazio / erro.
- `tenant_id` em entidade e query (após auth).
- Foto original nunca sobrescrita. Medida inventada pela IA é proibida (estimativa rotulada).
- Integrações via adapter + mock (`IMAGE_GEN_PROVIDER`, `PDF_PROVIDER`).
- Config só por env.

### Monitor

O orquestrador vigia commits no worktree, `.orchestrator-question`, comentários Linear e `gh pr`.
