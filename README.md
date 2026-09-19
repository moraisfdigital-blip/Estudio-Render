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
backend/app/api/         routers (health, auth, tenants, clients, locations, projects, areas, photos)
backend/app/core/media.py storage dos originais em disco (imutável)
backend/app/models/      documentos do Mongo — todos com tenant_id
backend/app/schemas/     contratos Pydantic de entrada/saída
backend/app/adapters/    ganchos de integração (image_gen, pdf) — mock
frontend/src/pages/      telas (login, registro, dashboard, projeto, levantamento)
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
| `MEDIA_ROOT` | Raiz onde os originais das fotos são gravados |
| `MAX_UPLOAD_MB` | Tamanho máximo por foto enviada |

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

## Levantamento: áreas e fotos

Um **projeto** se divide em **áreas** (fachada, totem, interior) e cada área
recebe as fotos do levantamento.

| Método | Rota | Botão |
| --- | --- | --- |
| GET | `/api/projects/{id}/areas` | Lista áreas |
| POST | `/api/projects/{id}/areas` | Nova área |
| GET | `/api/areas/{id}/photos` | Grid de fotos da área |
| POST | `/api/areas/{id}/photos` | Upload |
| GET | `/api/photos/{id}` | Metadados |
| GET | `/api/photos/{id}/original` | Ver/baixar o original |
| DELETE | `/api/photos/{id}` | Remover do levantamento |
| GET | `/api/media/limits` | Tipo e tamanho aceitos (a UI não chuta limite) |

### A foto original é imutável

Essa é a regra dura do blueprint, e aqui ela é estrutural — não uma promessa:

- o arquivo é escrito **uma vez**, com `O_EXCL`: se o caminho já existir, a
  gravação falha em vez de sobrescrever;
- depois de fechado ele fica **somente-leitura** (`0444`), então um `open(...,
  "wb")` distraído numa fase futura estoura `PermissionError`;
- `backend/app/core/media.py` não expõe nenhuma função que apague ou reescreva
  um original — só criar e ler;
- o `SHA-256` é calculado no upload, guardado no documento e devolvido como
  `ETag` no download: dá para provar que os bytes são os mesmos.

**Derivados** de fases futuras (calibração, máscara, imagem gerada) leem o
original por `media.resolve(storage_key)` e gravam **arquivos novos** em
`<uid>/derived/`, ao lado do original — nunca no lugar dele.

### Layout no disco

```
$MEDIA_ROOT/<tenant_id>/photos/<uid>/original.<ext>
$MEDIA_ROOT/<tenant_id>/photos/<uid>/derived/...     (fases seguintes)
```

O tenant no topo mantém o isolamento visível também no disco. O banco guarda a
**chave relativa**, nunca um caminho absoluto: trocar o `MEDIA_ROOT` (ou migrar
para S3) não invalida os documentos.

Decisões desta fatia:

- **`DELETE` é soft-delete.** Marca `deleted_at` e some da UI e das leituras; o
  binário original continua no disco, intocado. Apagar o arquivo seria a forma
  mais definitiva de perder o original que o blueprint manda preservar, então a
  API não faz isso. Expurgo, se um dia existir, é rotina administrativa
  explícita e fora do fluxo do usuário.
- **O tipo vem dos bytes, não do nome.** Um `.txt` renomeado para `.jpg` é
  recusado com `415`; aceitamos JPEG, PNG e WebP.
- **Tamanho é cortado em streaming** (`413`), sem carregar o upload inteiro em
  memória nem gastar o disco antes de recusar.
- **Nome de área é único dentro do projeto** (não do tenant): dois projetos
  podem ter uma "Fachada" cada um. Colisão responde `409`.
- **O nome original do arquivo é só rótulo.** O caminho no disco vem de um UUID
  do servidor, então nome de arquivo malicioso não vira path traversal.
- **Nada de medida estimada aqui.** Esta fase grava foto e metadados de arquivo;
  medida só existe a partir da Fase 6, sempre com `source` explícito.

## Verificar que subiu

```bash
curl http://localhost:8000/api/health   # {"status":"ok"}
curl http://localhost:8000/api/auth/me  # 401 sem token
```

E abra `http://localhost:8000` — a tela de login do workspace.
