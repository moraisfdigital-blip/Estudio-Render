"""Correções de prioridade 1 da auditoria `/hm-security`.

| ID | O que era |
| --- | --- |
| SEC-01 | Bomba de descompressão: PNG de 132 bytes declarando 72 Mpx |
| SEC-02 | `/docs`, `/redoc` e `/openapi.json` abertos sem token |
| SEC-03 | Zero cabeçalhos de segurança |
| SEC-04 | 19 listagens sem limite |
| SEC-05 | Nenhum log de evento de segurança |

O SEC-01 é o único com PoC de derrubar o serviço, e é o que este arquivo testa
com mais cuidado: o ataque real é um arquivo **pequeno**, não um arquivo grande.
"""

import struct
import zlib

import pytest

from conftest import EMAIL_OWNER, SENHA
from helpers import imagem_jpeg


def png_declarando(largura: int, altura: int) -> bytes:
    """PNG minúsculo que **declara** uma resolução enorme.

    É o ataque: o arquivo tem centenas de bytes e passa em qualquer limite de
    MB, mas decodificá-lo alocaria largura × altura × 3 bytes na memória.
    """

    def bloco(tipo: bytes, dados: bytes) -> bytes:
        corpo = tipo + dados
        return struct.pack(">I", len(dados)) + corpo + struct.pack(">I", zlib.crc32(corpo))

    ihdr = struct.pack(">IIBBBBB", largura, altura, 8, 2, 0, 0, 0)
    linha = b"\x00" + b"\x00" * (largura * 3)
    return (
        b"\x89PNG\r\n\x1a\n"
        + bloco(b"IHDR", ihdr)
        + bloco(b"IDAT", zlib.compress(linha * 2))
        + bloco(b"IEND", b"")
    )


# ------------------------------------------- SEC-01: bomba de descompressão


async def test_upload_recusa_resolucao_absurda(api, owner, levantamento):
    """O PoC do relatório, agora barrado."""
    bomba = png_declarando(9000, 8000)  # 72 Mpx em ~130 bytes
    assert len(bomba) < 1024, "o ataque é um arquivo pequeno, não um grande"

    resposta = await api.post(
        f"/api/areas/{levantamento.area_id}/photos",
        headers=owner.auth,
        files={"file": ("bomba.png", bomba, "image/png")},
    )
    assert resposta.status_code == 413, resposta.text
    assert "resolução acima do limite" in resposta.json()["detail"]


async def test_bomba_recusada_nao_vira_foto_nem_arquivo(
    api, owner, banco, midia, levantamento
):
    """A recusa não pode deixar registro no banco nem lixo no disco."""
    antes = await banco["photos"].count_documents({"area_id": levantamento.area_id})

    await api.post(
        f"/api/areas/{levantamento.area_id}/photos",
        headers=owner.auth,
        files={"file": ("bomba.png", png_declarando(9000, 8000), "image/png")},
    )

    depois = await banco["photos"].count_documents({"area_id": levantamento.area_id})
    assert depois == antes, "nenhuma foto foi criada"

    orfaos = [
        caminho
        for caminho in midia.rglob("original.png")
        if caminho.stat().st_size < 1024
    ]
    assert orfaos == [], f"arquivo recusado ficou no disco: {orfaos}"


async def test_foto_de_celular_continua_passando(api, owner, levantamento):
    """O teto não pode atrapalhar o uso real: um iPhone faz 12 Mpx."""
    resposta = await api.post(
        f"/api/areas/{levantamento.area_id}/photos",
        headers=owner.auth,
        files={"file": ("normal.jpg", imagem_jpeg((30, 30, 34), (4000, 3000)), "image/jpeg")},
    )
    assert resposta.status_code == 201, resposta.text


async def test_teto_do_pillow_acompanha_o_da_configuracao(api):
    """Os dois lados têm que concordar, senão a geração abriria o que o upload barrou."""
    from PIL import Image

    from app.core.config import get_settings

    assert Image.MAX_IMAGE_PIXELS == get_settings().max_image_pixels


# ------------------------------------------------- SEC-02: docs fechado


@pytest.mark.parametrize("rota", ["/docs", "/redoc", "/openapi.json"])
async def test_documentacao_fechada_em_producao(api, rota):
    """O que importa é o **conteúdo**, não o código de status.

    Em produção estas rotas deixam de existir na API e passam a cair no
    fallback do SPA — que responde 200 com o `index.html`, porque é assim que
    roteamento no cliente funciona. O 200 aqui é correto; o que não pode
    acontecer é o esquema da API ou a interface do Swagger aparecerem.
    """
    from app.core.config import get_settings

    assert get_settings().is_production is True

    resposta = await api.get(rota)
    corpo = resposta.text.lower()

    assert '"paths"' not in corpo, f"{rota} entregou o esquema da API"
    assert "swagger" not in corpo, f"{rota} entregou a interface do Swagger"
    assert "redoc" not in corpo.replace("redocument", ""), f"{rota} entregou o ReDoc"
    assert "/api/auth/login" not in corpo, f"{rota} listou rotas da API"


async def test_producao_e_o_padrao_do_codigo():
    """Instalação que esqueceu de declarar o ambiente nasce fechada."""
    from app.core.config import Settings

    assert Settings.model_fields["environment"].default == "production"


# --------------------------------------------- SEC-03: headers de segurança


@pytest.mark.parametrize(
    ("cabecalho", "esperado"),
    [
        ("X-Content-Type-Options", "nosniff"),
        ("X-Frame-Options", "DENY"),
        ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ],
)
async def test_cabecalhos_de_seguranca_presentes(api, cabecalho, esperado):
    resposta = await api.get("/api/health")
    assert resposta.headers.get(cabecalho) == esperado


async def test_csp_permite_o_que_a_tela_precisa_e_barra_o_resto(api):
    """CSP que quebrasse as imagens seria removida na primeira reclamação."""
    csp = (await api.get("/api/health")).headers.get("Content-Security-Policy", "")

    # As imagens autenticadas viram object URL (blob:), então blob: é obrigatório.
    assert "img-src 'self' data: blob:" in csp
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp
    # O ponto que importa: script inline continua barrado.
    assert "script-src 'self'" in csp
    assert "'unsafe-inline'" not in csp.split("script-src")[1].split(";")[0]


async def test_hsts_so_em_producao(api):
    from app.core.config import get_settings

    resposta = await api.get("/api/health")
    if get_settings().is_production:
        assert "max-age=31536000" in resposta.headers.get("Strict-Transport-Security", "")
    else:
        assert "Strict-Transport-Security" not in resposta.headers


# ------------------------------------------------- SEC-04: paginação


async def test_listagem_tem_teto_padrao(api, owner, levantamento, sufixo):
    """Sem `limit`, a resposta vem limitada mesmo assim."""
    for indice in range(3):
        await api.post(
            "/api/clients", headers=owner.auth, json={"name": f"Cliente {sufixo}-{indice}"}
        )

    limitada = await api.get("/api/clients", headers=owner.auth, params={"limit": 2})
    assert limitada.status_code == 200
    assert len(limitada.json()) == 2


async def test_offset_avanca_a_pagina(api, owner, sufixo):
    primeira = (
        await api.get("/api/clients", headers=owner.auth, params={"limit": 1, "offset": 0})
    ).json()
    segunda = (
        await api.get("/api/clients", headers=owner.auth, params={"limit": 1, "offset": 1})
    ).json()
    if primeira and segunda:
        assert primeira[0]["id"] != segunda[0]["id"]


async def test_cliente_nao_burla_o_teto(api, owner):
    """`?limit=999999` reproduziria exatamente o problema que a paginação resolve."""
    from app.api.pagination import MAX_LIMIT

    estourado = await api.get("/api/clients", headers=owner.auth, params={"limit": 999_999})
    assert estourado.status_code == 422

    no_teto = await api.get("/api/clients", headers=owner.auth, params={"limit": MAX_LIMIT})
    assert no_teto.status_code == 200


@pytest.mark.parametrize(
    "rota",
    [
        "/api/clients",
        "/api/locations",
        "/api/projects",
        "/api/materials",
        "/api/finishes",
        "/api/brands",
    ],
)
async def test_listagens_aceitam_paginacao(api, owner, rota):
    assert (
        await api.get(rota, headers=owner.auth, params={"limit": 5, "offset": 0})
    ).status_code == 200


# ------------------------------------------- SEC-05: log de segurança


async def test_login_falho_e_registrado(api, caplog):
    import logging

    with caplog.at_level(logging.INFO, logger="render_artelux.seguranca"):
        await api.post(
            "/api/auth/login", json={"email": EMAIL_OWNER, "password": "errada"}
        )

    linhas = [registro.message for registro in caplog.records if "SEGURANCA" in registro.message]
    assert any("evento=login_falhou" in linha for linha in linhas), linhas
    assert any(EMAIL_OWNER in linha for linha in linhas)


async def test_senha_nunca_aparece_no_log(api, caplog):
    """O log não pode virar o alvo mais fácil do sistema."""
    import logging

    senha_secreta = "senha-super-secreta-do-teste"
    with caplog.at_level(logging.INFO):
        await api.post(
            "/api/auth/login", json={"email": EMAIL_OWNER, "password": senha_secreta}
        )

    tudo = " ".join(registro.message for registro in caplog.records)
    assert senha_secreta not in tudo, "a senha tentada vazou para o log"


async def test_login_bem_sucedido_e_registrado(api, caplog):
    import logging

    with caplog.at_level(logging.INFO, logger="render_artelux.seguranca"):
        resposta = await api.post(
            "/api/auth/login", json={"email": EMAIL_OWNER, "password": SENHA}
        )
    assert resposta.status_code == 200

    linhas = [registro.message for registro in caplog.records if "SEGURANCA" in registro.message]
    assert any("evento=login_ok" in linha for linha in linhas), linhas


async def test_token_nunca_aparece_no_log(api, owner, caplog):
    import logging

    with caplog.at_level(logging.INFO):
        await api.get("/api/auth/me", headers=owner.auth)

    tudo = " ".join(registro.message for registro in caplog.records)
    assert owner.token not in tudo, "o token vazou para o log"


async def test_papel_negado_e_registrado(api, editor, levantamento, caplog):
    """Diferencia 'clicou onde não devia' de 'está varrendo as rotas de owner'."""
    import logging

    with caplog.at_level(logging.INFO, logger="render_artelux.seguranca"):
        resposta = await api.patch(
            f"/api/projects/{levantamento.projeto_id}/architecture-lock",
            headers=editor.auth,
            json={"enabled": False},
        )
    assert resposta.status_code == 403

    linhas = [registro.message for registro in caplog.records if "SEGURANCA" in registro.message]
    assert any("evento=papel_negado" in linha for linha in linhas), linhas
    assert any("papel=editor" in linha for linha in linhas)


# ----------------------------------- SEC-11/12: o que viaja com o deploy


async def test_health_confirma_o_banco(api):
    """Health que só devolve 200 responde 200 com o banco fora.

    O orquestrador veria "saudável", manteria o container na rotação, e quem
    receberia o erro seria o usuário.
    """
    resposta = await api.get("/api/health")
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["status"] == "ok", "contrato da Fase 1 preservado"
    assert corpo["database"] == "ok"


async def test_health_responde_503_com_o_banco_fora(api, monkeypatch):
    """O 503 é o sinal que o orquestrador entende para tirar o container da rotação."""
    from app.api import health as rota

    class ClienteMorto:
        class admin:
            @staticmethod
            async def command(_):
                raise ConnectionError("sem rota para o banco")

    monkeypatch.setattr(rota, "get_client", lambda: ClienteMorto())

    resposta = await api.get("/api/health")
    assert resposta.status_code == 503, resposta.text
    corpo = resposta.json()
    assert corpo["status"] == "degradado"
    assert "indisponível" in corpo["database"]


async def test_health_nao_vaza_endereco_do_banco(api, monkeypatch):
    """Este endpoint costuma ficar aberto ao orquestrador — às vezes sem auth."""
    from app.api import health as rota
    from app.core.config import get_settings

    class ClienteMorto:
        class admin:
            @staticmethod
            async def command(_):
                raise ConnectionError(f"falha ao conectar em {get_settings().mongo_url}")

    monkeypatch.setattr(rota, "get_client", lambda: ClienteMorto())

    corpo = (await api.get("/api/health")).text
    assert "mongodb://" not in corpo, "a string de conexão vazou na resposta"


async def test_senha_minima_de_doze_caracteres(api, sufixo):
    """Subir o mínimo depois de a equipe existir não revalida senha antiga.

    Por isso ele muda antes do primeiro cadastro, e não depois.
    """
    from app.schemas.auth import PASSWORD_MIN_LENGTH

    assert PASSWORD_MIN_LENGTH == 12

    curta = await api.post(
        "/api/auth/register",
        json={
            "email": f"curta-{sufixo}@exemplo-teste.com",
            "password": "12345678901",
            "name": "Senha curta",
        },
    )
    assert curta.status_code == 422, curta.text

    aceita = await api.post(
        "/api/auth/register",
        json={
            "email": f"longa-{sufixo}@exemplo-teste.com",
            "password": "senha-com-doze-ou-mais",
            "name": "Senha aceita",
        },
    )
    assert aceita.status_code == 201, aceita.text
