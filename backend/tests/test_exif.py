"""SEC-09 — cópia de exibição sem EXIF.

EXIF carrega GPS e modelo do aparelho. O blueprint proíbe alterar a foto
original, então a limpeza não acontece nela: uma **cópia** é gerada e é ela que
a tela e o PDF usam. O original continua no disco, byte a byte, para quem
precisar dele de propósito.

Estes testes existem para provar as duas metades ao mesmo tempo — se um dia
alguém "simplificar" limpando o original, o teste do byte a byte cai.
"""

import io

import pytest
from bson import ObjectId
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

from helpers import sha256

CAMERA = "ARTELUX-CAM"


def foto_com_exif(tamanho: tuple[int, int] = (1600, 1200)) -> bytes:
    """JPEG com marca, modelo e coordenada — como sai de um celular."""
    exif = Image.Exif()
    exif[0x010F] = CAMERA
    exif[0x0110] = "Modelo de levantamento"

    gps = exif.get_ifd(0x8825)
    gps[1] = "S"
    gps[2] = (IFDRational(23), IFDRational(33), IFDRational(0))
    gps[3] = "W"
    gps[4] = (IFDRational(46), IFDRational(38), IFDRational(0))

    buffer = io.BytesIO()
    Image.new("RGB", tamanho, (38, 52, 64)).save(
        buffer, format="JPEG", quality=92, exif=exif.tobytes()
    )
    return buffer.getvalue()


def tem_exif(conteudo: bytes) -> bool:
    lido = Image.open(io.BytesIO(conteudo)).getexif()
    return bool(lido.get(0x010F)) or bool(lido.get_ifd(0x8825))


async def sobe_foto(api, owner, levantamento, conteudo: bytes) -> dict:
    resposta = await api.post(
        f"/api/areas/{levantamento.area_id}/photos",
        headers=owner.auth,
        files={"file": ("fachada.jpg", conteudo, "image/jpeg")},
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


# ------------------------------------------------- a imagem de teste serve


async def test_a_foto_de_teste_realmente_tem_exif():
    """Sem isto, todos os outros testes deste arquivo passariam por engano."""
    conteudo = foto_com_exif()
    assert tem_exif(conteudo)
    assert CAMERA.encode() in conteudo, "a marca precisa estar nos bytes"


# ------------------------------------------------- o original não é tocado


async def test_original_mantem_o_exif_byte_a_byte(api, owner, levantamento):
    """A regra do blueprint: a foto original nunca é alterada."""
    conteudo = foto_com_exif()
    foto = await sobe_foto(api, owner, levantamento, conteudo)

    baixado = await api.get(foto["original_url"], headers=owner.auth)
    assert baixado.status_code == 200
    assert baixado.content == conteudo, "o original tem que ser o arquivo enviado"
    assert sha256(baixado.content) == sha256(conteudo)
    assert tem_exif(baixado.content), "limpar o original quebraria a regra"


# ------------------------------------------------- a cópia é limpa


async def test_copia_de_exibicao_nao_tem_exif(api, owner, levantamento):
    conteudo = foto_com_exif()
    foto = await sobe_foto(api, owner, levantamento, conteudo)

    exibicao = await api.get(foto["display_url"], headers=owner.auth)
    assert exibicao.status_code == 200, exibicao.text

    assert not tem_exif(exibicao.content), "a cópia ainda carrega metadado"
    assert CAMERA.encode() not in exibicao.content, "a marca da câmera sobrou nos bytes"


async def test_copia_preserva_a_imagem(api, owner, levantamento):
    """Limpar metadado não pode mudar o que se vê — nem o tamanho, nem a cor."""
    conteudo = foto_com_exif()
    foto = await sobe_foto(api, owner, levantamento, conteudo)

    exibicao = (await api.get(foto["display_url"], headers=owner.auth)).content
    original = Image.open(io.BytesIO(conteudo)).convert("RGB")
    copia = Image.open(io.BytesIO(exibicao)).convert("RGB")

    assert copia.size == original.size
    # JPEG é com perda; a cor tem que continuar reconhecível, não idêntica.
    for canal_copia, canal_original in zip(copia.getpixel((800, 600)), original.getpixel((800, 600))):
        assert abs(canal_copia - canal_original) <= 8


async def test_copia_e_arquivo_novo_em_derived(api, owner, banco, midia, levantamento):
    conteudo = foto_com_exif()
    foto = await sobe_foto(api, owner, levantamento, conteudo)

    doc = await banco["photos"].find_one({"_id": ObjectId(foto["id"])})
    pasta = (midia / doc["storage_key"]).parent

    raiz = sorted(p.name for p in pasta.iterdir() if p.is_file())
    assert raiz == ["original.jpg"], "o derivado não pode ficar na raiz da pasta"
    assert (pasta / "derived" / "display.jpg").is_file()


async def test_copia_nasce_somente_leitura(api, owner, banco, midia, levantamento):
    foto = await sobe_foto(api, owner, levantamento, foto_com_exif())
    doc = await banco["photos"].find_one({"_id": ObjectId(foto["id"])})
    copia = (midia / doc["storage_key"]).parent / "derived" / "display.jpg"
    assert copia.stat().st_mode & 0o222 == 0, "mídia gravada é imutável"


# ------------------------------------------- foto antiga ganha cópia depois


async def test_foto_sem_copia_recebe_uma_no_primeiro_acesso(
    api, owner, banco, midia, levantamento
):
    """Fotos enviadas antes desta mudança não têm cópia — ela nasce no acesso."""
    foto = await sobe_foto(api, owner, levantamento, foto_com_exif())
    doc = await banco["photos"].find_one({"_id": ObjectId(foto["id"])})
    copia = (midia / doc["storage_key"]).parent / "derived" / "display.jpg"

    # Simula o estado de uma foto anterior à mudança.
    copia.chmod(0o600)
    copia.unlink()
    assert not copia.exists()

    exibicao = await api.get(foto["display_url"], headers=owner.auth)
    assert exibicao.status_code == 200
    assert copia.is_file(), "a cópia devia ter sido criada no acesso"
    assert not tem_exif(exibicao.content)


async def test_pedir_a_copia_duas_vezes_nao_duplica(api, owner, banco, midia, levantamento):
    """A chave é determinística: o segundo pedido reusa o arquivo do primeiro."""
    foto = await sobe_foto(api, owner, levantamento, foto_com_exif())
    doc = await banco["photos"].find_one({"_id": ObjectId(foto["id"])})
    derivados = (midia / doc["storage_key"]).parent / "derived"

    primeira = (await api.get(foto["display_url"], headers=owner.auth)).content
    segunda = (await api.get(foto["display_url"], headers=owner.auth)).content

    assert primeira == segunda
    assert len(list(derivados.iterdir())) == 1


# ----------------------------------------------------- acesso e cabeçalhos


async def test_copia_exige_token_e_respeita_o_tenant(api, owner, banco, levantamento, sufixo):
    from app.core.security import create_access_token

    foto = await sobe_foto(api, owner, levantamento, foto_com_exif())

    assert (await api.get(foto["display_url"])).status_code == 401

    outro_tenant = str(
        (await banco["tenants"].insert_one({"slug": f"outro-{sufixo}", "name": "Outro"})).inserted_id
    )
    outro_usuario = (
        await banco["users"].insert_one(
            {
                "tenant_id": outro_tenant,
                "email": f"outro-exif-{sufixo}@exemplo-teste.com",
                "password_hash": "x",
                "name": "Outro",
                "role": "owner",
            }
        )
    ).inserted_id
    invasor = {
        "Authorization": "Bearer "
        + create_access_token(user_id=str(outro_usuario), tenant_id=outro_tenant, role="owner")
    }
    assert (await api.get(foto["display_url"], headers=invasor)).status_code == 404


async def test_etag_distingue_copia_do_original(api, owner, levantamento):
    """Os dois recursos partem do mesmo hash; o ETag não pode confundi-los."""
    foto = await sobe_foto(api, owner, levantamento, foto_com_exif())

    original = await api.get(foto["original_url"], headers=owner.auth)
    exibicao = await api.get(foto["display_url"], headers=owner.auth)

    assert original.headers["ETag"] != exibicao.headers["ETag"]

    repetida = await api.get(
        foto["display_url"],
        headers={**owner.auth, "If-None-Match": exibicao.headers["ETag"]},
    )
    assert repetida.status_code == 304


@pytest.mark.parametrize("campo", ["original_url", "display_url"])
async def test_as_duas_urls_vem_no_grid(api, owner, levantamento, campo):
    foto = await sobe_foto(api, owner, levantamento, foto_com_exif())
    grid = (
        await api.get(f"/api/areas/{levantamento.area_id}/photos", headers=owner.auth)
    ).json()
    alvo = next(item for item in grid if item["id"] == foto["id"])
    assert alvo[campo].startswith("/api/photos/")
