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
backend/app/api/         routers (health, auth, tenants, clients, locations, projects, areas, photos, calibrations)
backend/app/core/media.py storage dos originais em disco (imutável)
backend/app/core/imagesize.py dimensões do original lidas do cabeçalho (só leitura)
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
| `JWT_SECRET` | Assinatura do token. **Obrigatória**, mínimo 32 caracteres — sem ela o app não sobe |
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

## Calibração de escala

Duas marcações do usuário sobre a foto **original** e a medida real entre elas.
Com isso o servidor calcula o fator que as próximas fases usam para converter
pixel em medida.

| Método | Rota | Botão |
| --- | --- | --- |
| GET | `/api/photos/{id}/calibration` | Carregar calibração |
| PUT | `/api/photos/{id}/calibration` | Salvar dois pontos + medida real + unidade |

Corpo do `PUT` — exatamente quatro campos:

```json
{
  "point_a": { "x": 520.0, "y": 560.0 },
  "point_b": { "x": 1080.0, "y": 700.0 },
  "real_length": 2.0,
  "unit": "m"
}
```

Resposta (o fator vem calculado do servidor):

```json
{
  "photo_id": "...", "tenant_id": "...", "calibrated": true,
  "point_a": { "x": 520.0, "y": 560.0 },
  "point_b": { "x": 1080.0, "y": 700.0 },
  "real_length": 2.0, "unit": "m",
  "pixel_distance": 577.041593,
  "pixels_per_unit": 288.520797,
  "pixels_per_meter": 288.520797,
  "source": "user_measured",
  "image_width": 1600, "image_height": 1200,
  "updated_at": "..."
}
```

`pixels_per_unit = distância_euclidiana_em_pixels / real_length`, calculado em
`backend/app/models/calibration.py`.

### A regra inegociável: a IA não informa medida

`real_length` só entra por digitação do usuário. Nenhuma IA, heurística, EXIF ou
"chute razoável" preenche esse campo — e isso é imposto pela API, não só pela
tela:

- o schema de entrada tem `extra="forbid"`: um cliente que tente enviar
  `pixels_per_unit`, `pixel_distance` ou `source` recebe `422`, em vez de ter o
  valor aceito calado;
- `source` é gravado sempre como `user_measured` pelo modelo; não existe caminho
  no código que escreva outro valor;
- sem calibração, as medidas da Fase 6 nascem como `estimated` e são **rotuladas
  na tela** — estimativa nunca vira fato.

Se um dia o produto pedir "sugerir medida automaticamente", isso muda a regra do
blueprint e é decisão do Owner — não se resolve dentro deste endpoint.

### Decisões desta fatia

- **`GET` sem calibração responde `200` com `calibrated: false`**, não `404`.
  Foto sem escala é o estado inicial normal de toda foto; com `404` nos dois
  casos a tela não distinguiria "ainda não calibrada" de "essa foto não é sua".
- **Unidades aceitas: `m` e `cm`.** Cobrem levantamento de fachada e de peça. A
  resposta traz `pixels_per_unit` na unidade escolhida (é o número que o usuário
  confere na tela) e `pixels_per_meter` normalizado, para as fases seguintes não
  dependerem de qual unidade foi digitada naquele dia.
- **Uma calibração por foto** (índice único `tenant_id` + `photo_id`): o `PUT` é
  upsert, recalibrar **corrige** o mesmo registro em vez de empilhar escalas
  concorrentes.
- **Pontos são validados contra as dimensões reais do original.** Ponto fora da
  foto → `422`. As dimensões vêm de `backend/app/core/imagesize.py`, um leitor de
  cabeçalho JPEG/PNG/WebP em Python puro — o arquivo é aberto **só para leitura**
  e nenhuma dependência de processamento de imagem entra na instalação.
- **Distância mínima de 8 px entre os pontos** (`422` abaixo disso): dois cliques
  colados transformariam um pixel de erro de clique em dezenas de por cento de
  erro na medida final.
- **Overlay em SVG puro**, sem biblioteca de canvas. O `viewBox` é o tamanho
  natural da foto, então cada ponto já nasce em coordenada de pixel do original;
  os marcadores são escalados pelo fator tela→original para ficarem do mesmo
  tamanho visual numa foto de 640 px e numa de 4032 px. Dá para arrastar o
  marcador e ajustar com as setas do teclado (Shift = 10 px).
- **`GET /api/photos/{id}` e `GET /api/areas/{id}/photos` passam a devolver
  `calibrated`**, para o grid mostrar "Não calibrada" sem abrir foto por foto.
- **422 do Pydantic com valor não finito** (`inf`, `NaN`) agora é serializado
  como texto no corpo de erro (`app/main.py`). Antes, a validação recusava certo
  mas o encoder JSON estourava e o cliente recebia `500` no lugar do `422`.

### O original continua intocado

A calibração é um documento novo no Mongo (`calibrations`). O arquivo da foto é
aberto apenas para leitura, e só para descobrir largura e altura. Nenhum byte do
original é reescrito — conferido com SHA-256 antes e depois.

## Máscaras e Architecture Lock

A máscara diz **onde a geração pode mexer** e **onde ela não pode nunca**. São
duas camadas com significados opostos, desenhadas como polígonos sobre a foto
original:

| Camada | Significado |
| --- | --- |
| `intervention` | Aqui pode. O recorte da peça que muda na proposta |
| `protect` | Aqui não. Janela, telhado, poste, o prédio do vizinho |

Na Fase 9 o adapter de geração só terá permissão de escrever pixel que esteja
dentro de `intervention` e fora de `protect`. A proteção vence o empate: se um
polígono de proteção cruza um de intervenção, a interseção é proteção — a regra
é conservadora de propósito.

### O Architecture Lock

Vive no **projeto** (`projects.architecture_lock`), não na foto: é decisão do
trabalho inteiro. Nasce **ligado**, e desligar é do owner — com o lock off a
geração recusa, então não é preferência de tela, é abrir mão da garantia de
preservar a arquitetura original.

### O veredito sai do servidor

`GET /api/photos/{id}/masks` já devolve `generation_ready` e, quando bloqueado,
o `blocked_reason` com o **mesmo texto** que a Fase 9 usará no 422. A tela
exibe o que recebeu; não existe regra de bloqueio duplicada no frontend.

Os dois bloqueios:

- foto sem camada de intervenção → não há onde gerar;
- Architecture Lock desligado → gerar contrariaria a promessa do produto.

### O original continua intocado

A máscara é documento novo no Mongo (`masks`, uma por foto, `PUT` que substitui
o conjunto de camadas). O arquivo da foto é aberto só para leitura, e só para
saber largura e altura — o que permite recusar vértice fora da imagem.

## Geração da proposta (Fase 9)

`POST /api/photos/{id}/proposals` monta o pedido, chama o provedor e grava o
resultado. **A rota não tem corpo**: não existe campo para mandar prompt,
escolher área ou pedir "ignore a máscara" — tudo vem do que está persistido. É
o que impede contornar o Architecture Lock por parâmetro.

O caminho completo:

1. carrega foto, projeto, máscaras, calibração e elementos;
2. `mask_model.generation_block()` decide — sem intervenção ou com o lock
   desligado, **422** e para aqui, antes de custar chamada de provedor;
3. `prompt_engine.build()` monta o pedido a partir desses dados;
4. o adapter gera (em `mock`, sem tocar a rede);
5. **`imaging.compose_locked()` aplica o retorno só sob a máscara**;
6. o resultado vira arquivo novo em `derived/`, ao lado do original.

### O passo 5 é o Architecture Lock

Um provedor de IA devolve uma imagem inteira, e nada impede que ele mexa fora
da máscara — por bug, por atualização de modelo, ou porque o prompt vazou. Se o
retorno fosse salvo direto, o lock seria uma promessa escrita neste arquivo.

Compondo, ele vira estrutura: o provedor pode devolver o que quiser, porque só
os pixels sob a máscara de intervenção sobrevivem. O teste
`test_provedor_desobediente_nao_altera_a_arquitetura` prova isso trocando o
adapter por um que devolve a imagem **inteiramente vermelha** e conferindo,
pixel a pixel, que só a área permitida mudou.

Cada imagem gerada grava `changed_pixels` — o alcance real da geração naquela
foto, que nunca pode ser maior que a área da máscara.

### O prompt fica salvo

O texto exato enviado ao provedor é gravado na proposta. Se daqui a seis meses
alguém perguntar "por que a proposta ficou assim?", a resposta é o pedido real,
não uma reconstrução.

Duas regras vivem no Prompt Engine: **medida nunca é inventada** (estimativa
entra escrita como estimativa, e elemento sem medida vira "medida não
informada") e **cor e material saem do catálogo** da Fase 7.

### Trocar o mock pelo provedor real

`IMAGE_GEN_PROVIDER=mock` não abre conexão nenhuma. Para produção, a variável
passa a nomear o provedor e as credenciais dele entram **só por env** — a rota,
o Prompt Engine e a composição não mudam. O adapter recebe a máscara já
rasterizada em PNG, que é o formato que serviços de inpainting esperam.

### A foto original continua intocada

A imagem gerada é arquivo novo em `derived/`, dentro da pasta da própria foto.
Gerar duas vezes cria dois arquivos; nenhum sobrescreve nada. O documento da
foto não é alterado — a proposta aponta para a foto, nunca o contrário.

## Versões e aprovação (Fase 10)

A Fase 9 gera quantas propostas alguém quiser — cada clique é uma tentativa
registrada. A Fase 10 é o passo de **decisão**: promover uma geração a versão
significa "esta é candidata a ir para o cliente", e aprovar é escolher a que vai.

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/photos/{id}/versions` | Lista + estado do limite |
| POST | `/api/photos/{id}/versions` | Promove uma proposta a versão |
| GET | `/api/photos/{id}/versions/compare?ids=a,b` | Compara |
| POST | `/api/versions/{id}/approve` | Aprova (owner) |
| DELETE | `/api/versions/{id}` | Descarta e devolve a vaga |

### O limite de três é estrutural

Três opções é o que um cliente compara sem travar na escolha; a quarta
transforma escolha em indecisão. O limite **não** é um `count` antes do insert —
isso perderia a corrida entre dois cliques simultâneos e gravaria uma quarta.

Cada versão ocupa uma `position` de 1 a 3, e existe índice único **parcial**
(só entre as versões ativas) em `tenant_id + photo_id + position`. Duas
promoções concorrentes disputam a mesma vaga e o Mongo recusa a segunda.

O índice ser parcial é o que faz o descarte devolver a vaga: versão descartada
mantém a posição no documento, mas sai do índice.

> `test_limite_aguenta_cliques_simultaneos` dispara quatro promoções ao mesmo
> tempo. Sem o `unique=True` no índice, ele cria quatro versões e o teste falha.

### Uma aprovada por foto

A escolha mora em `photos.approved_version_id` — fonte única. Aprovar outra
versão é um `$set` só, e `approved` em cada versão é **derivado** disso. Não
existe o estado impossível de duas versões marcadas como aprovadas.

A versão aprovada não pode ser descartada: a apresentação da Fase 11 depende de
haver uma escolha registrada.

### A versão não copia a imagem

Ela aponta para a geração que já existe. Promover não cria um segundo arquivo
no disco, e descartar não apaga imagem nenhuma — o descarte é soft-delete, e
fica registrado que aquela opção existiu e foi considerada.

## Apresentação e PDF (Fase 11)

Uma apresentação por projeto. Ela reúne as **versões aprovadas** das fotos e é
o que vai para o cliente.

| Método | Rota | O quê |
| --- | --- | --- |
| GET | `/api/projects/{id}/presentation` | Preview (rascunho, se nada salvo) |
| PUT | `/api/projects/{id}/presentation` | Salva título, ordem e legendas |
| POST | `/api/projects/{id}/presentation/export` | Exporta o PDF |
| GET | `/api/presentations/{id}/pdf` | Baixa |
| POST | `/api/projects/{id}/presentation/share-link` | Cria/renova o link interno |
| GET | `/api/p/{token}` | Abre pelo link |

### Só versão aprovada entra

Salvar um slide apontando para outra versão é 422. Sem isso, a apresentação
poderia levar ao cliente uma proposta que ninguém escolheu — e o trabalho de
aprovar (Fase 10) perderia o sentido.

Como a aprovação mora na foto, trocar a versão aprovada **depois** de montar a
apresentação desatualiza o slide. A leitura devolve esse slide com
`outdated: true`, e a tela avisa, em vez de exibir em silêncio uma imagem que
não é mais a escolha registrada.

### Começa montada

Sem nada salvo, o GET devolve um rascunho: as versões aprovadas na ordem em que
as fotos foram enviadas. Quem só quer exportar não precisa montar nada.

### O PDF do mock é um PDF de verdade

`PDF_PROVIDER=mock` monta o arquivo localmente, sem rede e sem credencial: capa
com projeto/cliente/local e uma página por slide, com a imagem real da versão
aprovada. Abre, lê e imprime. O que ele **não** faz é diagramação de marca —
tipografia, grid e cores da ARTELUX são trabalho do provedor real, que entra
pela mesma fábrica trocando a variável de ambiente.

Reexportar grava um arquivo novo; o anterior continua no disco, somente-leitura.

### O link é interno, não portal de cliente

`POST /presentation/share-link` cria um token e `GET /api/p/{token}` abre —
**exigindo login do tenant**. O token deixa a URL curta e estável; ele não
autentica. Um link vazado não serve para ninguém de fora da ARTELUX, e renovar
o link invalida o anterior (é assim que se revoga um que circulou demais).

## Testes

A suíte bate num **MongoDB de verdade** e confere o **arquivo no disco** — é
onde moram as regras do projeto (original imutável, medida com procedência,
cor vinda do catálogo). Não sobe servidor: fala com a app em memória.

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

Precisa de um Mongo acessível. Por padrão a suíte procura em
`mongodb://localhost:27017`; para apontar para outro, use `TEST_MONGO_URL`.
Sem Mongo, os testes **pulam** com a mensagem dizendo o que falta — não falham
em silêncio nem passam por engano.

O que a suíte isola sozinha:

| Recurso | Como |
| --- | --- |
| Banco | Usa `estudio_render_testes` e o apaga no começo e no fim. Um `assert` recusa rodar se o nome do banco não parecer de teste |
| Mídia | `MEDIA_ROOT` vai para uma pasta temporária por execução; nada encosta no `var/media` |
| Segredo | `JWT_SECRET` fixo, só de teste |

Nenhuma variável do seu `.env` é usada: a suíte define o ambiente dela antes
de carregar a app.

### O que está coberto

| Arquivo | Fase | O que protege |
| --- | --- | --- |
| `tests/test_elements.py` | 6 | Medida sempre com procedência declarada; estimativa pela escala é calculada na leitura e **nunca** gravada como medida; soft-delete; isolamento por tenant |
| `tests/test_catalog.py` | 7 | Cor vem do catálogo e não do frontend; catálogo é do owner e o editor só aplica; logo novo nunca sobrescreve o anterior |
| `tests/test_presentations.py` | 11 | Só versão aprovada vira slide; troca de aprovação marca o slide como desatualizado; PDF do mock é arquivo válido; link interno exige login |
| `tests/test_versions.py` | 10 | Limite de 3 aguenta cliques simultâneos; uma aprovada por foto; descartar devolve a vaga; aprovada não pode ser descartada |
| `tests/test_proposals.py` | 9 | Geração só altera pixel sob intervenção (provado com provedor desobediente); prompt não inventa medida; falha do provedor vira registro e 502 |
| `tests/test_masks.py` | 8 | Geração só libera com recorte de intervenção **e** lock ligado; `PUT` substitui em vez de acumular; vértice fora da foto é recusado; o lock é do owner |

## Verificar que subiu

```bash
curl http://localhost:8000/api/health   # {"status":"ok"}
curl http://localhost:8000/api/auth/me  # 401 sem token
```

E abra `http://localhost:8000` — a tela de login do workspace.
