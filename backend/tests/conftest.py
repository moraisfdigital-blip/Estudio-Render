"""Ambiente das suítes de verificação.

Estas suítes nasceram como scripts de sessão em `var/` (gitignored): falavam
com um servidor já rodando e com o Mongo direto. Elas provavam o que importa —
persistência real, escopo de tenant, arquivo no disco — mas sumiam junto com a
sessão. Aqui viram teste versionado, sem perder essa característica: continuam
batendo num **Mongo de verdade** e conferindo o **arquivo no disco**, porque é
exatamente aí que moram as regras do projeto (original imutável, medida com
procedência, cor vinda do catálogo).

O que muda é o transporte: em vez de `requests` contra um servidor externo, os
testes falam com a app em memória (`ASGITransport`). Não há porta, não há
processo para subir, não há servidor esquecido rodando depois da suíte.

## O que é isolado

* **Banco**: `MONGO_DB` aponta para um banco de teste e a suíte o **apaga** no
  começo e no fim. O `assert` abaixo recusa rodar se o nome não parecer de
  teste — é a trava que impede a suíte de limpar o banco de trabalho.
* **Mídia**: `MEDIA_ROOT` é uma pasta temporária por execução. Nenhum upload de
  teste encosta no `var/media` de desenvolvimento.
* **Segredo**: `JWT_SECRET` é fixo e óbvio aqui. Não é credencial de nada.

Tudo isso é definido em `os.environ` **antes** de importar `app`, porque o
`Settings` é cacheado no primeiro acesso.
"""

import os
import shutil
import stat
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

MEDIA_RAIZ = Path(tempfile.mkdtemp(prefix="render-artelux-testes-"))

# Senha usada pelo owner do seed e pelos usuários criados nos testes. Não é
# credencial: o banco inteiro é apagado no fim da execução.
SENHA = "senha-de-teste-123"
EMAIL_OWNER = "owner@exemplo-teste.com"

os.environ["MONGO_URL"] = os.environ.get(
    "TEST_MONGO_URL", os.environ.get("MONGO_URL", "mongodb://localhost:27017")
)
os.environ["MONGO_DB"] = os.environ.get("TEST_MONGO_DB", "estudio_render_testes")
os.environ["MEDIA_ROOT"] = str(MEDIA_RAIZ)
os.environ["JWT_SECRET"] = "segredo-so-de-teste-sem-valor-em-producao"
os.environ["SEED_OWNER_EMAIL"] = EMAIL_OWNER
os.environ["SEED_OWNER_PASSWORD"] = SENHA
os.environ["SEED_OWNER_NAME"] = "Owner de teste"
os.environ["ALLOW_SELF_REGISTER"] = "true"
os.environ["MAX_UPLOAD_MB"] = "25"

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.db import close_client, get_client, get_db  # noqa: E402
from app.core.seed import run_seed  # noqa: E402
from app.main import app  # noqa: E402

from helpers import imagem_jpeg, imagem_png, sha256  # noqa: E402


def _remover_somente_leitura(funcao, caminho, _erro) -> None:
    """Mídia gravada pela app é somente-leitura; devolve a escrita para apagar.

    A imutabilidade do original é justamente o que faz um `rmtree` comum falhar
    aqui, então a limpeza da pasta temporária precisa liberar a permissão antes.
    """
    os.chmod(caminho, stat.S_IWRITE)
    funcao(caminho)


@dataclass(frozen=True)
class Usuario:
    """Usuário autenticado, com o cabeçalho pronto para as chamadas."""

    id: str
    email: str
    tenant_id: str
    role: str
    token: str

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


@pytest.fixture(scope="session", autouse=True)
async def ambiente():
    """Banco limpo, índices criados e tenant fixo — uma vez por execução."""
    ajustes = get_settings()

    # Trava de segurança: a suíte apaga este banco inteiro. Se o nome não é de
    # teste, é o banco de trabalho de alguém e a suíte não roda.
    assert "test" in ajustes.mongo_db, (
        f"MONGO_DB={ajustes.mongo_db!r} não parece banco de teste. "
        "A suíte apaga o banco que usa; recusando rodar."
    )

    cliente = get_client()
    try:
        await cliente.admin.command("ping")
    except Exception as erro:  # noqa: BLE001 — qualquer falha aqui é "sem Mongo"
        pytest.skip(
            f"MongoDB não respondeu em {ajustes.mongo_url} ({type(erro).__name__}). "
            "Suba um Mongo local ou aponte TEST_MONGO_URL para um."
        )

    await cliente.drop_database(ajustes.mongo_db)
    await run_seed()

    yield

    await cliente.drop_database(ajustes.mongo_db)
    await close_client()
    shutil.rmtree(MEDIA_RAIZ, onerror=_remover_somente_leitura)


@pytest.fixture(scope="session")
async def api():
    """Cliente HTTP falando com a app em memória — sem porta, sem processo."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testes"
    ) as cliente:
        yield cliente


@pytest.fixture
def banco():
    """Acesso direto ao Mongo, para conferir o que **ficou gravado**.

    Uma resposta 200 só prova que a API respondeu. As asserções de persistência
    leem o documento e olham o `tenant_id`, a origem da medida e o que NÃO foi
    copiado para dentro do elemento.
    """
    return get_db()


@pytest.fixture
def midia() -> Path:
    """Raiz da mídia desta execução, para conferir o arquivo no disco."""
    return MEDIA_RAIZ


@pytest.fixture
def sufixo() -> str:
    """Sufixo único por teste: nome de material e e-mail são únicos por tenant."""
    return uuid.uuid4().hex[:8]


@pytest.fixture(scope="session")
async def owner(api) -> Usuario:
    """Owner criado pelo seed. Quem administra o catálogo."""
    resposta = await api.post(
        "/api/auth/login", json={"email": EMAIL_OWNER, "password": SENHA}
    )
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()
    assert corpo["user"]["role"] == "owner"
    return Usuario(
        id=corpo["user"]["id"],
        email=EMAIL_OWNER,
        tenant_id=corpo["user"]["tenant_id"],
        role="owner",
        token=corpo["access_token"],
    )


@pytest.fixture(scope="session")
async def editor(api) -> Usuario:
    """Usuário registrado pela API. Nasce `editor` — é o papel padrão."""
    email = f"editor-{uuid.uuid4().hex[:8]}@exemplo-teste.com"
    resposta = await api.post(
        "/api/auth/register",
        json={"email": email, "password": SENHA, "name": "Editor de teste"},
    )
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()
    assert corpo["user"]["role"] == "editor", "registro não deveria nascer owner"
    return Usuario(
        id=corpo["user"]["id"],
        email=email,
        tenant_id=corpo["user"]["tenant_id"],
        role="editor",
        token=corpo["access_token"],
    )


@dataclass(frozen=True)
class Levantamento:
    """Cenário mínimo de uma fatia: cliente, local, projeto, área e foto."""

    cliente_id: str
    local_id: str
    projeto_id: str
    area_id: str
    foto_id: str
    foto_bytes: bytes
    foto_sha: str
    largura: int
    altura: int


@pytest.fixture
async def levantamento(api, owner, sufixo) -> Levantamento:
    """Projeto real com uma foto real subida pela API.

    Cada teste ganha o seu, com nomes únicos, então um teste não enxerga o
    cenário do outro e a ordem de execução não importa.
    """
    cliente = await api.post(
        "/api/clients", headers=owner.auth, json={"name": f"Cliente {sufixo}"}
    )
    local = await api.post(
        "/api/locations", headers=owner.auth, json={"name": f"Local {sufixo}"}
    )
    projeto = await api.post(
        "/api/projects",
        headers=owner.auth,
        json={
            "name": f"Projeto {sufixo}",
            "client_id": cliente.json()["id"],
            "location_id": local.json()["id"],
        },
    )
    area = await api.post(
        f"/api/projects/{projeto.json()['id']}/areas",
        headers=owner.auth,
        json={"name": "Fachada"},
    )

    largura, altura = 1600, 1200
    conteudo = imagem_jpeg((28, 28, 30), (largura, altura))
    upload = await api.post(
        f"/api/areas/{area.json()['id']}/photos",
        headers=owner.auth,
        files={"file": ("fachada.jpg", conteudo, "image/jpeg")},
    )
    assert upload.status_code == 201, upload.text

    return Levantamento(
        cliente_id=cliente.json()["id"],
        local_id=local.json()["id"],
        projeto_id=projeto.json()["id"],
        area_id=area.json()["id"],
        foto_id=upload.json()["id"],
        foto_bytes=conteudo,
        foto_sha=sha256(conteudo),
        largura=largura,
        altura=altura,
    )


@pytest.fixture
async def elemento(api, owner, levantamento) -> dict:
    """Um elemento marcado na foto do levantamento, sem medida e sem spec."""
    resposta = await api.post(
        f"/api/photos/{levantamento.foto_id}/elements",
        headers=owner.auth,
        json={
            "name": "Letreiro principal",
            "kind": "letra_caixa",
            "box": {"x": 200.0, "y": 300.0, "width": 600.0, "height": 240.0},
        },
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


__all__ = ["imagem_png", "imagem_jpeg", "sha256", "Usuario", "Levantamento", "SENHA"]
