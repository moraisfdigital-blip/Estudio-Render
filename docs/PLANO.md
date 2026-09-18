# Render Artelux — Plano por fatias verticais

> **Status:** contrato aprovado para planejamento. **Não executar código** até o frontend visual ser definido fora deste repo e o Owner autorizar a Fase 1.
>
> Tickets Linear: projeto [Estudio Render](https://linear.app/francisco-morais/project/estudio-render-ca20ba9bbf4d), títulos com prefixo `[REN]`. Time Linear: Francisco Morais (`FRA`). O prefixo `[REN]` vive no título porque a key do time não é `REN`.

---

## FASE 0 — BLUEPRINT (contrato)

### NOME + CORE

- **NOME:** Render Artelux
- **CORE:** gerar propostas visuais realistas a partir de levantamento fotográfico, preservando a arquitetura original (**Architecture Lock**) e usando materiais/acabamentos reais da ARTELUX.
- **Fluxo principal:** Levantamento → Projeto Visual → Apresentação.
- **Uso:** interno ARTELUX. Sem billing, sem planos, sem área pública para cliente externo.

### TENANT

- Toda entidade e toda query nascem com `tenant_id`.
- Hoje existe **1 tenant fixo: ARTELUX**, criado via seed.
- Sem UI de criar/gerenciar tenants.
- Objetivo: vender a ferramenta para outras empresas no futuro sem reescrever o banco.

### ENTIDADES DO DOMÍNIO (todas com `tenant_id`)

| Entidade | Papel no fluxo |
| --- | --- |
| Tenant | Workspace. Seed ARTELUX. |
| User | Login interno; `role` owner/editor. |
| Cliente | Cadastro comercial do projeto. |
| Local | Posto, loja, fachada — o sítio do levantamento. |
| Projeto | Container do fluxo. |
| Área | Recorte do local (ex.: fachada, totem, interior). |
| Foto | Original imutável + metadados. |
| Calibração de escala | Dois pontos na foto + medida real. |
| Elemento | Peça a intervir (placa, faixa, letra caixa…). |
| Medida | Valor medido ou **estimativa explícita** (IA nunca inventa medida como fato). |
| Material | Catálogo real. |
| Acabamento | Variante do material. |
| Marca/Logo | Identidade aplicada na proposta. |
| Máscara | Intervenção vs proteção; base do Architecture Lock. |
| Proposta Visual | Pedido de geração controlada. |
| Versão | Até 3 propostas comparáveis. |
| Imagem Gerada | Output; **nunca substitui** a foto original. |
| Quantitativo | Lista derivada dos elementos/medidas/materiais. |
| Item de Orçamento | Linha de preço ligada ao quantitativo. |
| Apresentação | Preview + export PDF + link interno. |

### PAPÉIS (RBAC simples)

- `owner`: tudo do tenant, inclusive aprovar versão e gerenciar catálogo.
- `editor`: criar/editar levantamento e projeto visual; não gerencia usuários/tenant.
- Campo `role` no User desde a Fase 2. Sem tela complexa de permissões agora.

### TELAS (contrato de produto; UI visual ainda fora deste repo)

Cada tela abaixo é uma fatia com botões → endpoints. UI final entra quando o design for fechado; a fatia não fecha sem loading / vazio / erro e persistência real.

1. **Auth** — entrar / registrar (interno).
2. **Dashboard** — lista de projetos do tenant.
3. **Levantamento** — cliente, local, áreas, upload, calibração, elementos.
4. **Projeto Visual** — materiais, máscaras, geração, versões, comparação.
5. **Apresentação** — preview, export PDF, link interno.
6. **Quantitativo/orçamento** (fatia 12) — derivado da versão aprovada.

### BLOCOS UNIVERSAIS

| Bloco | Nesta entrega |
| --- | --- |
| Auth | Sim — JWT + bcrypt |
| Multi-tenant | Sim — adormecido, 1 tenant seed |
| RBAC | Sim — owner/editor |
| CRUD | Sim — por fatia, nunca “CRUD genérico” solto |
| Dashboard | Sim — lista de projetos (entra na Fase 3) |
| Arquivos/mídia | Sim — originais preservados |
| Billing | Não |
| Notificações | Não |
| Jobs/worker | Não — geração mock síncrona (ou status em documento, sem worker) |
| Busca | Não |

### INTEGRAÇÕES (sempre adaptador + MOCK)

| Integração | Para quê | Mock | Virar real |
| --- | --- | --- | --- |
| Geração de imagem IA | Proposta visual com máscaras / Architecture Lock | `IMAGE_GEN_PROVIDER=mock` | `IMAGE_GEN_PROVIDER=<provedor>` + chaves só em env |
| Geração de PDF | Export da apresentação | `PDF_PROVIDER=mock` | `PDF_PROVIDER=<provedor>` + env |

Nenhum segredo, cor de marca ou URL de API chumbado no código.

### ARQUITETURA ALVO

- Backend: FastAPI (Python) + MongoDB (Motor), async.
- Frontend: React + Tailwind + shadcn/ui; axios `baseURL: "/api"`.
- Deploy: **single-service** — FastAPI serve o build React + `/api` + SPA fallback.
- Config 100% por env; `.env` no `.gitignore`; `.env.example` versionado.
- Foto original **nunca** é sobrescrita.
- Geração **só** altera pixels cobertos por máscara de intervenção.

### MAPA DE ARQUIVOS (esqueleto — Fase 1)

```
estudio-render/
  Dockerfile
  docker-compose.yml          # app + mongo
  .env.example
  .gitignore
  README.md
  backend/
    app/main.py               # FastAPI, monta /api e SPA
    app/core/config.py        # pydantic-settings
    app/core/db.py            # Motor
    app/api/health.py
    app/adapters/image_gen.py # mock + interface
    app/adapters/pdf.py
  frontend/
    src/main.tsx
    src/App.tsx
    src/api/client.ts         # axios baseURL /api
  docs/PLANO.md
```

Fatias seguintes adicionam `models/`, `schemas/`, `api/routers/`, telas em `frontend/src/pages/` **junto**, nunca backend-semana / frontend-semana.

### DEFINIÇÃO DE PRONTO (toda fatia 2..N)

- [ ] Modelo no banco com `tenant_id`
- [ ] Endpoints com validação Pydantic + checagem de tenant
- [ ] Query escopada por `tenant_id`
- [ ] Tela com loading, vazio e erro
- [ ] Botão chama o endpoint e persiste
- [ ] Testado de verdade (request real e clique)
- [ ] Sem segredo/cor/URL chumbados

---

## Ordem das fases (não pular)

```
0 Blueprint → 1 Esqueleto que SOBE → 2 Auth+Tenant
→ 3 Projeto/Cliente/Local
→ 4 Upload fotos
→ 5 Calibração
→ 6 Elementos + medidas
→ 7 Material/acabamento/cor + marca
→ 8 Máscaras + Architecture Lock
→ 9 Prompt Engine + geração MOCK
→ 10 Versões (máx. 3)
→ 11 Apresentação + PDF MOCK
→ 12 Quantitativo + orçamento
```

Dependência: cada fase `n` bloqueia `n+1`.

---

## FASE 1 — Esqueleto que sobe

**Objetivo:** app sobe localmente antes de qualquer feature.

**Entrega:**

- FastAPI com `GET /api/health` → `{ "status": "ok" }`.
- React mínimo que renderiza (placeholder; visual final depois).
- Dockerfile + compose (app + Mongo).
- `.env.example` (`MONGO_URL`, `JWT_SECRET` placeholder, `IMAGE_GEN_PROVIDER=mock`, `PDF_PROVIDER=mock`, `DEFAULT_TENANT_SLUG=artelux`).
- FastAPI serve frontend em produção; SPA fallback.

**Fora:** auth, models de domínio, telas de produto.

**Teste de pronto:** `docker compose up` (ou equivalente) → health 200 e UI abre. Sem isso, **não** começa Fase 2.

**Linear:** `[REN] FASE 1 — Esqueleto que sobe`

---

## FASE 2 — Auth + tenant adormecido

**Objetivo:** identidade e isolamento. Tudo depois já nasce com `tenant_id`.

**Modelo:** `tenants`, `users` (`tenant_id`, `email`, `password_hash`, `role`).

**Seed:** tenant ARTELUX + owner de desenvolvimento (credenciais só em env).

**Endpoints:**

| Método | Path | Botão / ação |
| --- | --- | --- |
| POST | `/api/auth/register` | Registrar (interno) |
| POST | `/api/auth/login` | Entrar |
| GET | `/api/auth/me` | Hidratar sessão |
| GET | `/api/tenants/current` | Badge do workspace (ARTELUX) |

JWT em header; bcrypt; queries de user sempre com `tenant_id`.

**Telas:** login, registro, shell autenticado (nome + tenant). Loading/erro de login.

**Fora:** gestão de tenants, convites, RBAC UI avançada.

**Teste:** registrar → login → `/me` → documento no Mongo com `tenant_id` da ARTELUX; request sem token = 401.

**Linear:** `[REN] FASE 2 — Auth + tenant adormecido`

---

## FASE 3 — Projeto + cliente + local (+ dashboard)

**Fatia vertical:** criar um projeto completo com cliente e local e vê-lo na lista.

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| GET | `/api/clients` | Lista / select |
| POST | `/api/clients` | Novo cliente |
| PATCH | `/api/clients/{id}` | Salvar cliente |
| GET | `/api/locations` | Lista / select |
| POST | `/api/locations` | Novo local |
| PATCH | `/api/locations/{id}` | Salvar local |
| GET | `/api/projects` | Dashboard |
| POST | `/api/projects` | Criar projeto |
| GET | `/api/projects/{id}` | Abrir projeto |
| PATCH | `/api/projects/{id}` | Editar projeto |

**Telas:** dashboard (vazio / lista / erro); formulário projeto (cliente + local).

**Teste:** criar cliente, local, projeto; recarregar; outro tenant (quando houver) não vê. Hoje: garantir filtro `tenant_id` mesmo com um tenant.

**Linear:** `[REN] FASE 3 — Projeto, cliente e local`

---

## FASE 4 — Upload de fotos por área (original preservado)

**Fatia:** área no projeto + upload; original gravado de forma imutável.

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| GET | `/api/projects/{id}/areas` | Lista áreas |
| POST | `/api/projects/{id}/areas` | Nova área |
| POST | `/api/areas/{id}/photos` | Upload |
| GET | `/api/photos/{id}` | Metadados |
| GET | `/api/photos/{id}/original` | Baixar/ver original |
| DELETE | `/api/photos/{id}` | Remover (não reescreve arquivo; soft-delete ou delete do registro; binário original nunca “editado”) |

Storage via env (`MEDIA_ROOT` ou S3-compat futuro). Path/URL nunca hardcoded de produção.

**Telas:** Levantamento — áreas, grid de fotos, estado vazio, progresso de upload, erro de tipo/tamanho.

**Regra:** qualquer pipeline posterior lê original; writes só em derivados.

**Teste:** upload → GET original igual ao arquivo; “editar” futuro não muda o bytes do original.

**Linear:** `[REN] FASE 4 — Upload de fotos por área`

---

## FASE 5 — Calibração de escala

**Fatia:** dois pontos na foto + medida real informada pelo usuário → fator px/unidade.

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| GET | `/api/photos/{id}/calibration` | Carregar calibração |
| PUT | `/api/photos/{id}/calibration` | Salvar dois pontos + medida real + unidade |

Campos: `point_a`, `point_b`, `real_length`, `unit`, `pixels_per_unit` calculado no servidor. Sem calibração: medidas só como estimativa (Fase 6).

**Telas:** overlay na foto original; salvar; vazio = “não calibrado”.

**Teste:** pontos + 2,00 m → `pixels_per_unit` persistido; GET devolve o mesmo; IA não preenche `real_length`.

**Linear:** `[REN] FASE 5 — Calibração de escala`

---

## FASE 6 — Elementos, medidas e conferência

**Fatia:** elemento com posição, medidas e status de conferência.

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| GET | `/api/photos/{id}/elements` | Lista |
| POST | `/api/photos/{id}/elements` | Novo elemento |
| PATCH | `/api/elements/{id}` | Editar |
| DELETE | `/api/elements/{id}` | Remover |
| PUT | `/api/elements/{id}/measurements` | Salvar medidas |
| POST | `/api/elements/{id}/conference` | Marcar conferido / pendente |

`measurement.source`: `user_measured` | `estimated`. UI **obrigada** a rotular estimativa. Proibido persistir medida “inventada” pela IA como `user_measured`.

**Telas:** lista de elementos, form, badge de conferência, empty state.

**Teste:** criar elemento, medida conferida, reload; estimativa visível como estimativa.

**Linear:** `[REN] FASE 6 — Elementos e medidas`

---

## FASE 7 — Material, acabamento, cor real + marca/logo

**Fatia:** catálogo do tenant + vínculo ao elemento.

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| GET/POST/PATCH | `/api/materials` | Catálogo material |
| GET/POST/PATCH | `/api/finishes` | Acabamentos |
| GET/POST/PATCH | `/api/brands` | Marcas/logos (arquivo via mídia) |
| PATCH | `/api/elements/{id}/spec` | Aplicar material + acabamento + cor + marca |

Cor vem do catálogo/ paleta persistida, não de hex chumbado no frontend.

**Telas:** seletor no elemento; empty = “cadastre material”.

**Teste:** criar material/acabamento, aplicar, reload do elemento.

**Linear:** `[REN] FASE 7 — Materiais, acabamentos e marca`

---

## FASE 8 — Máscaras + Architecture Lock

**Fatia:** máscara de intervenção e de proteção; lock da arquitetura.

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| GET | `/api/photos/{id}/masks` | Carregar |
| PUT | `/api/photos/{id}/masks` | Salvar polígonos/camadas (`intervention` \| `protect`) |
| PATCH | `/api/projects/{id}/architecture-lock` | Ativar/confirmar lock |

Regra de domínio: geração recusa se não houver máscara de intervenção **ou** se Architecture Lock estiver off (produto: lock **on** por padrão ao gerar).

**Telas:** desenho de máscara sobre **original**; toggle lock visível.

**Teste:** salvar máscaras; GET igual; original intacto.

**Linear:** `[REN] FASE 8 — Máscaras e Architecture Lock`

---

## FASE 9 — Prompt Engine + geração MOCK

**Fatia:** montar prompt a partir de máscaras + specs reais + lock; gerar imagem **só nas áreas de intervenção**.

**Adapter:** `ImageGenAdapter.generate(...)`.

- `IMAGE_GEN_PROVIDER=mock` → devolve imagem derivada (ex.: overlay da máscara) **sem** chamar rede, persiste `GeneratedImage`.
- Real: mesmo contrato; credenciais só em env.

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| POST | `/api/photos/{id}/proposals` | Gerar proposta |
| GET | `/api/proposals/{id}` | Status + resultado |
| GET | `/api/generated-images/{id}` | Arquivo gerado |
| GET | `/api/photos/{id}/compare` | Original vs gerado |

Regras: usa materiais/medidas persistidos; não inventa medida; recusa se máscara/lock inválidos.

**Telas:** gerar, loading, erro do adapter, comparação lado a lado.

**Teste:** mock gera e persiste; original inalterado; sem máscara → 422.

**Linear:** `[REN] FASE 9 — Prompt Engine e geração (mock)`

---

## FASE 10 — Versões (até 3), comparar, aprovar

**Fatia:** no máximo 3 versões por foto/projeto (definir: **por foto**); comparar; aprovar uma.

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| GET | `/api/photos/{id}/versions` | Lista |
| POST | `/api/photos/{id}/versions` | Promover geração a versão (bloqueia a 4ª) |
| GET | `/api/photos/{id}/versions/compare?ids=` | Comparar |
| POST | `/api/versions/{id}/approve` | Aprovar (owner; editor se produto permitir — default **owner**) |

**Telas:** até 3 cards, comparar, estado “limite atingido”.

**Teste:** 3 versões ok; 4ª = 422; aprovar persiste `approved_version_id`.

**Linear:** `[REN] FASE 10 — Versões e aprovação`

---

## FASE 11 — Apresentação + PDF mock + link interno

**Fatia:** montar apresentação da versão aprovada; preview; PDF; link **interno** (não portal de cliente).

**Adapter:** `PdfAdapter.render(presentation)`.

- `PDF_PROVIDER=mock` → PDF simples persistido.
- Real: mesmo contrato + env.

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| GET | `/api/projects/{id}/presentation` | Preview data |
| PUT | `/api/projects/{id}/presentation` | Salvar slides/ordem |
| POST | `/api/projects/{id}/presentation/export` | Export PDF |
| GET | `/api/presentations/{id}/pdf` | Download |
| POST | `/api/projects/{id}/presentation/share-link` | Link interno autenticado |
| GET | `/api/p/{token}` | Abrir (JWT ARTELUX, não público anônimo) |

**Telas:** preview, export, erro, vazio se não há versão aprovada.

**Teste:** export mock grava arquivo; GET baixa; link exige login do tenant.

**Linear:** `[REN] FASE 11 — Apresentação e PDF (mock)`

---

## FASE 12 — Quantitativo + item de orçamento

**Por quê existe:** entidades do blueprint ainda não cobertas nas fases 3–11; o CORE promete levar os mesmos dados até quantitativo e orçamento.

**Fatia:** gerar quantitativo a partir de elementos conferidos + materiais da versão aprovada; linhas de orçamento editáveis (preço **informado**, não inventado).

**Endpoints:**

| Método | Path | Botão |
| --- | --- | --- |
| POST | `/api/projects/{id}/quantity-takeoff` | Gerar/atualizar quantitativo |
| GET | `/api/projects/{id}/quantity-takeoff` | Ver |
| POST | `/api/quantity-takeoff/{id}/items` | Item manual |
| PATCH | `/api/budget-items/{id}` | Preço / quantidade (fonte explícita) |

**Regra:** quantidade estimada herda flag de estimativa da medida. Sem preço no catálogo → item sem preço, não chute.

**Teste:** conferir elemento + material → takeoff lista a linha; reload; estimativa rotulada.

**Linear:** `[REN] FASE 12 — Quantitativo e orçamento`

---

## Fora de escopo (agora)

- Billing, planos, Stripe, trial.
- App público para o cliente final.
- UI de multi-tenant / convites.
- Worker/fila (Replicate, Celery, etc.).
- Busca global, notificações.
- Implementação visual final (em definição fora deste repo).
- Provedor real de IA/PDF (só o gancho + mock).

---

## Como executar depois (quando autorizado)

1. Só Fase 1 até **subir**.
2. Só então Fase 2.
3. Uma fatia por vez; fechar o checklist de pronto **com teste real**.
4. Ao fim de cada fatia reportar: o que foi feito, como testou, o que falta.
5. UI: ligar os endpoints deste plano nos componentes quando o visual estiver definido — **não** entregar casca.

---

## Índice Linear

Projeto: [Estudio Render](https://linear.app/francisco-morais/project/estudio-render-ca20ba9bbf4d)

| Fase | Ticket | Título |
| --- | --- | --- |
| Epic | [FRA-5](https://linear.app/francisco-morais/issue/FRA-5) | [REN] Epic — Render Artelux por fatias verticais |
| 0 | [FRA-6](https://linear.app/francisco-morais/issue/FRA-6) | [REN] FASE 0 — Blueprint (contrato) |
| 1 | [FRA-7](https://linear.app/francisco-morais/issue/FRA-7) | [REN] FASE 1 — Esqueleto que sobe |
| 2 | [FRA-8](https://linear.app/francisco-morais/issue/FRA-8) | [REN] FASE 2 — Auth + tenant adormecido |
| 3 | [FRA-9](https://linear.app/francisco-morais/issue/FRA-9) | [REN] FASE 3 — Projeto, cliente e local |
| 4 | [FRA-10](https://linear.app/francisco-morais/issue/FRA-10) | [REN] FASE 4 — Upload de fotos por área |
| 5 | [FRA-11](https://linear.app/francisco-morais/issue/FRA-11) | [REN] FASE 5 — Calibração de escala |
| 6 | [FRA-12](https://linear.app/francisco-morais/issue/FRA-12) | [REN] FASE 6 — Elementos e medidas |
| 7 | [FRA-13](https://linear.app/francisco-morais/issue/FRA-13) | [REN] FASE 7 — Materiais, acabamentos e marca |
| 8 | [FRA-15](https://linear.app/francisco-morais/issue/FRA-15) | [REN] FASE 8 — Máscaras e Architecture Lock |
| 9 | [FRA-14](https://linear.app/francisco-morais/issue/FRA-14) | [REN] FASE 9 — Prompt Engine e geração (mock) |
| 10 | [FRA-16](https://linear.app/francisco-morais/issue/FRA-16) | [REN] FASE 10 — Versões e aprovação |
| 11 | [FRA-18](https://linear.app/francisco-morais/issue/FRA-18) | [REN] FASE 11 — Apresentação e PDF (mock) |
| 12 | [FRA-17](https://linear.app/francisco-morais/issue/FRA-17) | [REN] FASE 12 — Quantitativo e orçamento |

Cadeia de bloqueio: FRA-6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 15 → 14 → 16 → 18 → 17.

A key do time Linear é FRA (não REN). O prefixo de produto [REN] está no título de cada issue.

Nota: FRA-14/15/17/18 não seguem a ordem da fase; a ordem de execução é a coluna Fase.
