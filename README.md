# Render Artelux (Estudio Render)

Propostas visuais realistas a partir de levantamento fotográfico, preservando a
arquitetura original (**Architecture Lock**) e usando materiais reais da ARTELUX.

Plano por fatias verticais: [`docs/PLANO.md`](docs/PLANO.md).
Protocolo de execução: [`AGENTS.md`](AGENTS.md).

## Arquitetura

Single-service: o FastAPI serve a API sob `/api` **e** o build do React, com
fallback de SPA para qualquer outra rota.

```
backend/app/main.py      FastAPI: /api + estáticos + fallback SPA
backend/app/core/        config (pydantic-settings) e Mongo (Motor)
backend/app/api/         routers (health, auth, tenants, clients, locations, projects)
backend/app/models/      documentos do Mongo — todos com tenant_id
backend/app/schemas/     contratos Pydantic de entrada/saída
backend/app/adapters/    ganchos de integração (image_gen, pdf) — mock
frontend/src/pages/      telas (login, registro, dashboard, projeto)
frontend/src/components/ shell, primitivas de UI e seletores de cliente/local
frontend/src/hooks/      useResource (loading / erro / pronto)
```

Configuração 100% por env. `.env` não é versionado; use `.env.example` como base.

## Rodar em desenvolvimento

Dois processos: FastAPI em `:8000` e Vite em `:5173` (o Vite repassa `/api`).

```bash
cp .env.example .env

# backend
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Linux/macOS: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000

# frontend (outro terminal)
cd frontend
npm install
npm run dev
```

Abra `http://localhost:5173`.

## Rodar como produção (single-service, sem Docker)

```bash
cd frontend && npm run build && cd ..
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000
```

Abra `http://localhost:8000` — mesma origem para UI e API.

## Rodar com Docker

```bash
cp .env.example .env
docker compose up --build
```

- App: `http://localhost:8000`
- Mongo: serviço `mongo` na rede do compose (sem porta publicada no host)

## Variáveis de ambiente

| Variável | Para quê |
| --- | --- |
| `MONGO_URL` | Conexão do MongoDB |
| `MONGO_DB` | Nome do banco |
| `JWT_SECRET` | Assinatura do token |
| `JWT_ALGORITHM` | Algoritmo do JWT (`HS256`) |
| `JWT_EXPIRE_MINUTES` | Validade do token em minutos |
| `IMAGE_GEN_PROVIDER` | Adaptador de geração de imagem (`mock`) |
| `PDF_PROVIDER` | Adaptador de PDF (`mock`) |
| `DEFAULT_TENANT_SLUG` | Tenant fixo desta instalação (`artelux`) |
| `DEFAULT_TENANT_NAME` | Nome exibido do tenant (`ARTELUX`) |
| `SEED_OWNER_EMAIL` | E-mail do owner criado pelo seed (vazio = não cria) |
| `SEED_OWNER_PASSWORD` | Senha desse owner (vazio = não cria) |
| `SEED_OWNER_NAME` | Nome desse owner |
| `ALLOW_SELF_REGISTER` | `false` fecha o `POST /api/auth/register` |
| `FRONTEND_DIST` | Caminho do build do React servido pelo FastAPI |

## Autenticação e tenant

Um tenant fixo por instalação (`DEFAULT_TENANT_SLUG`), criado pelo seed na
subida junto com os índices. O owner de desenvolvimento só é criado se
`SEED_OWNER_EMAIL` **e** `SEED_OWNER_PASSWORD` estiverem no ambiente — não há
credencial padrão no código. Quem se registra pela tela entra como `editor`.

| Método | Rota | Para quê |
| --- | --- | --- |
| POST | `/api/auth/register` | Registro interno (cria `editor`) |
| POST | `/api/auth/login` | Entrar |
| GET | `/api/auth/me` | Hidratar a sessão |
| GET | `/api/tenants/current` | Badge do workspace |

O token vai no header `Authorization: Bearer <token>` e carrega o `tenant_id`.
Rota autenticada sem token responde `401`.

**Padrão para as próximas fases:** o handler declara `scope: CurrentScope`
(`backend/app/api/deps.py`) e monta o filtro com `scope.filter(...)` /
`scope.stamp(...)` (`backend/app/core/tenancy.py`). Nenhuma query de domínio
deve montar `{"tenant_id": ...}` na mão.

## Projetos, clientes e locais

Um **projeto** é o container do fluxo e só existe amarrado a um **cliente** e a um
**local**, ambos do mesmo tenant — o vínculo é revalidado no servidor a cada
`POST`/`PATCH`, nunca aceito só porque veio no corpo do request.

| Método | Rota | Botão |
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

Decisões desta fatia:

- **Local tem `client_id` opcional.** Um local pode ser cadastrado antes de se
  saber de quem é; o vínculo que o fluxo exige é o do projeto. Criando um local
  pelo formulário do projeto, ele já nasce ligado ao cliente escolhido.
- **Nome é único por tenant** em `clients` e `locations` (índice sobre
  `tenant_id` + nome normalizado). Evita dois cadastros iguais no mesmo select;
  colisão responde `409`.
- **Etapa do projeto** (`status`): `levantamento`, `projeto_visual`,
  `apresentacao`, `concluido`. É só o estágio declarado pelo usuário nesta fase.
- **`PATCH` é parcial de verdade**: campo não enviado não é apagado.
- Referência quebrada em `client`/`location` aparece na UI como
  "Cliente removido" em vez de derrubar a listagem.

## Verificar que subiu

```bash
curl http://localhost:8000/api/health   # {"status":"ok"}
curl http://localhost:8000/api/auth/me  # 401 sem token
```

E abra `http://localhost:8000` — a tela de login do workspace.
