# ENBY PRO — entrega e publicação

Atualizado em 04/10/2026. **Publicado em https://enbypro.com e em uso.** O estado atual, o procedimento de deploy e as pendências estão em [RETOMAR-ENBYPRO.md](RETOMAR-ENBYPRO.md); este arquivo guarda o histórico da entrega.

## Código e escopo

- Repositório: `moraisfdigital-blip/estudio-render`.
- Branch: `codex/enbypro-release`, criada a partir de `bf15b4d`. Implementação inicial em `4873a70`; sessão de 04/10 adicionou `f5e7610` (olho na senha), `f2b6907` (entrada direta no painel, remoção das telas de lista/formulário), `b869bab` (painel abre sem projeto), `095bb4a` (catálogo, PDF e orçamento como janelas do painel), `966e624` (senha e e-mail só por link enviado ao e-mail; Minha conta), `64e1251` (telas antigas removidas; Elementos e medidas, Foto original e Remover foto na aba 02). Release no ar: `64e1251`. PRs #18 e #19 mergeados em `main` com autorização do usuário; `main` = versão no ar.
- [PR #18](https://github.com/moraisfdigital-blip/Estudio-Render/pull/18) mergeado em `main` em 04/10/2026 (`fa0e771`), com autorização do usuário.
- Worktree: `D:\SET UP NOVO\orca\workspaces\estudio-render\enbypro-release`.
- Sem ticket Linear vinculado; o histórico está no PR e nestes arquivos.

## Implementação

- Frontend do protótipo conectado ao salvamento de estudos por projeto, com revisão atômica (conflito → 409).
- Composição, superfícies, foto ativa, iluminação e opacidade persistidos. O estudo visual não confirma medidas de fabricação nem sobrescreve o levantamento.
- OpenRouter via adapter (`IMAGE_GEN_PROVIDER=openrouter`), chave só no servidor; fotos reencodadas sem EXIF; máscara enviada junto; Architecture Lock aplicado localmente ao resultado; respostas limitadas; erros sanitizados; limite atômico de tentativas por tenant/hora (`GENERATION_LIMIT_PER_HOUR`, 20).
- Registro público fechado por padrão; PyJWT 2.15.0.
- Compose com porta só em interface interna, Mongo sem porta pública, volumes persistentes, processo não root, `read_only`, `cap_drop`, `mem_limit`.
- Interface (04/10): login abre direto o painel do protótipo; sem projeto, abre com o exemplo; janelas de catálogo, PDF e orçamento dentro do painel; botão de mostrar senha no login. Detalhes e regras em RETOMAR-ENBYPRO.md.
- Conta (04/10): "Esqueci minha senha / quero trocar" e "Minha conta" (nome, e-mail com confirmação, link de senha). Senha nunca muda pedindo a antiga; só por link de uso único enviado ao e-mail. E-mail transacional pelo Resend (`EMAIL_PROVIDER=resend`, domínio `enbypro.com` verificado).

## Verificação

Antes da publicação (ambiente Windows, Mongo local, banco exclusivo por execução):

| Verificação | Resultado |
| --- | --- |
| Suíte backend completa | 304 testes passaram (322 depois da parte de conta/e-mail) |
| `npm run build` / `npm run lint` | passaram |
| `npm audit`, `pip-audit`, `bandit` | sem achados |

Na publicação e depois dela (04/10):

- Imagem construída na VPS (Linux, Python 3.12); `/api/health` com banco OK; login real pela tela.
- Geração real OpenRouter com fachada sintética e máscara: HTTP 201 em 10,4 s, imagem 1600×1000, **0 pixels alterados fora da máscara**, original idêntico byte a byte. Banco de teste apagado depois.
- Externo: HTTPS Let's Encrypt (válido até 02/01/2027), HTTP→HTTPS 308, `www`→apex 301, HSTS/CSP/X-Frame-Options/nosniff presentes, `/api/projects` sem token → 401, `/api/auth/register` → 403, `/docs` e `/openapi.json` servem a SPA, `/.env` e `/.git/config` não expõem conteúdo, portas 8010 e 27017 inacessíveis de fora.
- Backup: `deploy/backup.sh` executado na VPS, SHA256 conferidos; agendado diariamente.
- Frontend: auditoria Playwright clicando em todos os botões das três abas (com e sem projeto) sem erro de JavaScript; testes de fluxo da entrada e das janelas novas.
- Conta/e-mail: 18 testes de backend (link de uso único, vencimento, e-mail inexistente, limite por IP, `Host` ignorado, sessões encerradas, troca de e-mail confirmada); fluxo completo clicando numa cópia local; em produção, e-mail real entregue (`delivered`) e senha trocada pelo próprio usuário pelo link.
- CRM da Artelux na mesma VPS: nenhum container reiniciado; as linhas originais do `Caddyfile` conferem com o backup byte a byte; `crm.arteluxpostos.com.br` respondendo.

Limites: não houve teste em aparelho móvel físico; `frontend/testes/calibracao-geometria.mjs` precisa ser reescrito para a tela atual.

## Destino e DNS

- VPS da Artelux `srv1951666.hstgr.cloud` (179.199.141.95), compartilhada com o DeskcommCRM. O usuário confirmou (04/10) usar esta VPS sem upgrade.
- DNS `enbypro.com`: `A @ → 179.199.141.95` (TTL 600), `www` CNAME. Alterado pelo usuário no painel Hostinger; o registro antigo (`2.57.91.91`, domínio estacionado) foi removido.
- Acesso: SSH por chave já configurada na máquina do usuário (alias `crmnovo`). O bloqueio do console no navegador da sessão anterior ficou sem uso.

## Backup e reversão

`deploy/backup.sh` roda diariamente via `/opt/enbypro/bin/backup-diario.sh` (ver RETOMAR). Para reverter a aplicação, subir o Compose a partir da release anterior em `/opt/enbypro/releases/` com o mesmo projeto `enbypro` e o mesmo `.env`; as mudanças de banco são aditivas. Não usar `docker compose down -v`.

## Referências

- [OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [PyJWT 2.15.0](https://pyjwt.readthedocs.io/en/2.15.0/changelog.html)
