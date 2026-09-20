"""Fase 11 — apresentação, PDF (mock) e link interno.

As regras que esta suíte protege:

**Só versão aprovada vai para o cliente.** Salvar um slide apontando para outra
versão é 422. E se a aprovação mudar depois de a apresentação ser montada, o
slide volta marcado como `outdated` — em vez de exibir em silêncio uma imagem
que não é mais a escolha registrada.

**O link é interno.** `/api/p/{token}` exige login do tenant. O token encurta a
URL; ele não autentica, e um link vazado não serve para ninguém de fora.
"""

import pytest
from bson import ObjectId

from helpers import sha256

PLACA = [{"x": 200, "y": 300}, {"x": 800, "y": 300}, {"x": 800, "y": 540}, {"x": 200, "y": 540}]


async def versao_aprovada(api, owner, levantamento) -> dict:
    """Leva a foto do cenário até ter uma versão aprovada."""
    mascara = await api.put(
        f"/api/photos/{levantamento.foto_id}/masks",
        headers=owner.auth,
        json={"layers": [{"kind": "intervention", "label": "Placa", "points": PLACA}]},
    )
    assert mascara.status_code == 200, mascara.text

    proposta = await api.post(
        f"/api/photos/{levantamento.foto_id}/proposals", headers=owner.auth
    )
    assert proposta.status_code == 201, proposta.text

    versao = await api.post(
        f"/api/photos/{levantamento.foto_id}/versions",
        headers=owner.auth,
        json={"proposal_id": proposta.json()["id"], "label": "Opção A"},
    )
    assert versao.status_code == 201, versao.text

    aprovacao = await api.post(
        f"/api/versions/{versao.json()['id']}/approve", headers=owner.auth
    )
    assert aprovacao.status_code == 200, aprovacao.text
    return versao.json()


async def apresentacao(api, usuario, projeto_id) -> dict:
    resposta = await api.get(
        f"/api/projects/{projeto_id}/presentation", headers=usuario.auth
    )
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


async def exporta(api, usuario, projeto_id):
    return await api.post(
        f"/api/projects/{projeto_id}/presentation/export", headers=usuario.auth
    )


# ------------------------------------------------------------- estado vazio


async def test_projeto_sem_versao_aprovada_explica_o_bloqueio(api, owner, levantamento):
    """Vazio é estado normal, e o motivo vem pronto do servidor."""
    corpo = await apresentacao(api, owner, levantamento.projeto_id)

    assert corpo["slides"] == []
    assert corpo["approved_count"] == 0
    assert corpo["can_export"] is False
    assert "nenhuma versão aprovada" in corpo["blocked_reason"]
    assert corpo["pdf"] is None
    assert corpo["share"] is None


async def test_exportar_sem_aprovacao_e_recusado(api, owner, levantamento):
    resposta = await exporta(api, owner, levantamento.projeto_id)
    assert resposta.status_code == 422, resposta.text
    assert "aprove uma versão" in resposta.json()["detail"].lower()


# ------------------------------------------------------------ começa montada


async def test_apresentacao_comeca_montada_das_aprovadas(api, owner, levantamento):
    """Quem só quer exportar não precisa arrastar nada."""
    versao = await versao_aprovada(api, owner, levantamento)
    corpo = await apresentacao(api, owner, levantamento.projeto_id)

    assert corpo["saved"] is False, "é rascunho: ninguém salvou ainda"
    assert corpo["approved_count"] == 1
    assert corpo["can_export"] is True
    assert corpo["blocked_reason"] is None

    slide = corpo["slides"][0]
    assert slide["position"] == 1
    assert slide["version_id"] == versao["id"]
    assert slide["label"] == "Opção A"
    assert slide["outdated"] is False
    assert slide["image_url"].startswith("/api/generated-images/")
    assert slide["original_url"] == f"/api/photos/{levantamento.foto_id}/original"


async def test_titulo_padrao_usa_o_nome_do_projeto(api, owner, levantamento, sufixo):
    await versao_aprovada(api, owner, levantamento)
    corpo = await apresentacao(api, owner, levantamento.projeto_id)
    assert corpo["title"] == f"Proposta visual — Projeto {sufixo}"


# ----------------------------------------------------------------- salvar


async def test_salva_titulo_ordem_e_legenda(api, owner, banco, levantamento):
    versao = await versao_aprovada(api, owner, levantamento)

    resposta = await api.put(
        f"/api/projects/{levantamento.projeto_id}/presentation",
        headers=owner.auth,
        json={
            "title": "Proposta ARTELUX — fachada",
            "notes": "Versão escolhida na reunião de terça.",
            "slides": [
                {
                    "photo_id": levantamento.foto_id,
                    "version_id": versao["id"],
                    "caption": "Fachada com ACM branco brilho",
                }
            ],
        },
    )
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()

    assert corpo["saved"] is True
    assert corpo["title"] == "Proposta ARTELUX — fachada"
    assert corpo["notes"] == "Versão escolhida na reunião de terça."
    assert corpo["slides"][0]["caption"] == "Fachada com ACM branco brilho"

    doc = await banco["presentations"].find_one({"project_id": levantamento.projeto_id})
    assert doc["tenant_id"] == owner.tenant_id
    assert doc["updated_by"]
    assert len(doc["slides"]) == 1


async def test_slide_com_versao_nao_aprovada_e_recusado(api, owner, levantamento):
    """A REGRA: a apresentação só leva ao cliente o que foi aprovado."""
    aprovada = await versao_aprovada(api, owner, levantamento)

    # Uma segunda versão, promovida mas NÃO aprovada.
    outra_proposta = await api.post(
        f"/api/photos/{levantamento.foto_id}/proposals", headers=owner.auth
    )
    outra = await api.post(
        f"/api/photos/{levantamento.foto_id}/versions",
        headers=owner.auth,
        json={"proposal_id": outra_proposta.json()["id"]},
    )
    assert outra.json()["id"] != aprovada["id"]

    resposta = await api.put(
        f"/api/projects/{levantamento.projeto_id}/presentation",
        headers=owner.auth,
        json={
            "slides": [
                {"photo_id": levantamento.foto_id, "version_id": outra.json()["id"]}
            ]
        },
    )
    assert resposta.status_code == 422, resposta.text
    assert "não é a aprovada" in resposta.json()["detail"]


async def test_slide_de_foto_de_outro_projeto_e_recusado(api, owner, levantamento, sufixo):
    versao = await versao_aprovada(api, owner, levantamento)

    cliente = await api.post(
        "/api/clients", headers=owner.auth, json={"name": f"Outro cliente {sufixo}"}
    )
    local = await api.post(
        "/api/locations", headers=owner.auth, json={"name": f"Outro local {sufixo}"}
    )
    outro = await api.post(
        "/api/projects",
        headers=owner.auth,
        json={
            "name": f"Outro projeto {sufixo}",
            "client_id": cliente.json()["id"],
            "location_id": local.json()["id"],
        },
    )

    resposta = await api.put(
        f"/api/projects/{outro.json()['id']}/presentation",
        headers=owner.auth,
        json={"slides": [{"photo_id": levantamento.foto_id, "version_id": versao["id"]}]},
    )
    assert resposta.status_code == 422, resposta.text
    assert "não é deste projeto" in resposta.json()["detail"]


async def test_trocar_a_aprovada_marca_o_slide_como_desatualizado(
    api, owner, levantamento
):
    """Mudar a escolha depois de montar não pode passar em silêncio."""
    aprovada = await versao_aprovada(api, owner, levantamento)
    await api.put(
        f"/api/projects/{levantamento.projeto_id}/presentation",
        headers=owner.auth,
        json={
            "slides": [{"photo_id": levantamento.foto_id, "version_id": aprovada["id"]}]
        },
    )

    nova_proposta = await api.post(
        f"/api/photos/{levantamento.foto_id}/proposals", headers=owner.auth
    )
    nova = await api.post(
        f"/api/photos/{levantamento.foto_id}/versions",
        headers=owner.auth,
        json={"proposal_id": nova_proposta.json()["id"]},
    )
    await api.post(f"/api/versions/{nova.json()['id']}/approve", headers=owner.auth)

    corpo = await apresentacao(api, owner, levantamento.projeto_id)
    assert corpo["slides"][0]["outdated"] is True
    assert corpo["slides"][0]["version_id"] == aprovada["id"]


async def test_cliente_nao_forja_pdf_nem_token(api, owner, levantamento):
    await versao_aprovada(api, owner, levantamento)
    for campo, valor in (
        ("pdf", {"url": "x"}),
        ("share_token", "forjado"),
        ("saved", True),
    ):
        resposta = await api.put(
            f"/api/projects/{levantamento.projeto_id}/presentation",
            headers=owner.auth,
            json={"slides": [], campo: valor},
        )
        assert resposta.status_code == 422, f"{campo} devia ser recusado"


# -------------------------------------------------------------------- PDF


async def test_exporta_pdf_de_verdade(api, owner, banco, midia, levantamento):
    await versao_aprovada(api, owner, levantamento)

    resposta = await exporta(api, owner, levantamento.projeto_id)
    assert resposta.status_code == 200, resposta.text
    pdf = resposta.json()["pdf"]

    assert pdf["provider"] == "mock"
    assert pdf["page_count"] == 2, "capa + um slide"
    assert pdf["size_bytes"] > 0
    assert pdf["url"] == f"/api/presentations/{levantamento.projeto_id}/pdf"

    doc = await banco["presentations"].find_one({"project_id": levantamento.projeto_id})
    caminho = midia / doc["pdf"]["storage_key"]
    assert caminho.is_file()
    assert caminho.read_bytes()[:5] == b"%PDF-", "arquivo PDF válido, não um placeholder"
    assert caminho.stat().st_mode & 0o222 == 0, "mídia gravada é imutável"


async def test_baixa_o_pdf_e_confere(api, owner, levantamento):
    await versao_aprovada(api, owner, levantamento)
    pdf = (await exporta(api, owner, levantamento.projeto_id)).json()["pdf"]

    baixado = await api.get(pdf["url"], headers=owner.auth)
    assert baixado.status_code == 200
    assert baixado.content[:5] == b"%PDF-"
    assert sha256(baixado.content) == pdf["checksum_sha256"]
    assert baixado.headers["content-type"] == "application/pdf"

    repetido = await api.get(
        pdf["url"], headers={**owner.auth, "If-None-Match": f'"{pdf["checksum_sha256"]}"'}
    )
    assert repetido.status_code == 304


async def test_pdf_antes_de_exportar_responde_404(api, owner, levantamento):
    await versao_aprovada(api, owner, levantamento)
    resposta = await api.get(
        f"/api/presentations/{levantamento.projeto_id}/pdf", headers=owner.auth
    )
    assert resposta.status_code == 404
    assert "ainda não foi exportada" in resposta.json()["detail"]


async def test_reexportar_grava_arquivo_novo(api, owner, banco, midia, levantamento):
    """Exportar de novo não sobrescreve o PDF anterior."""
    await versao_aprovada(api, owner, levantamento)
    primeiro = (await exporta(api, owner, levantamento.projeto_id)).json()["pdf"]
    doc = await banco["presentations"].find_one({"project_id": levantamento.projeto_id})
    chave_antiga = doc["pdf"]["storage_key"]

    await exporta(api, owner, levantamento.projeto_id)
    doc = await banco["presentations"].find_one({"project_id": levantamento.projeto_id})
    chave_nova = doc["pdf"]["storage_key"]

    assert chave_antiga != chave_nova
    assert (midia / chave_antiga).is_file(), "o PDF anterior continua no disco"
    assert primeiro["checksum_sha256"]


async def test_pdf_tem_uma_pagina_por_slide(api, owner, levantamento):
    """Duas fotos aprovadas viram capa + duas páginas."""
    await versao_aprovada(api, owner, levantamento)

    segunda = await api.post(
        f"/api/areas/{levantamento.area_id}/photos",
        headers=owner.auth,
        files={"file": ("segunda.jpg", levantamento.foto_bytes, "image/jpeg")},
    )
    foto_id = segunda.json()["id"]
    await api.put(
        f"/api/photos/{foto_id}/masks",
        headers=owner.auth,
        json={"layers": [{"kind": "intervention", "label": "Placa", "points": PLACA}]},
    )
    proposta = await api.post(f"/api/photos/{foto_id}/proposals", headers=owner.auth)
    versao = await api.post(
        f"/api/photos/{foto_id}/versions",
        headers=owner.auth,
        json={"proposal_id": proposta.json()["id"]},
    )
    await api.post(f"/api/versions/{versao.json()['id']}/approve", headers=owner.auth)

    corpo = (await exporta(api, owner, levantamento.projeto_id)).json()
    assert corpo["approved_count"] == 2
    assert len(corpo["slides"]) == 2
    assert corpo["pdf"]["page_count"] == 3


async def test_falha_do_provedor_de_pdf_vira_502(api, owner, levantamento, monkeypatch):
    from app.adapters.pdf import PdfError
    from app.api.routers import presentations as rota

    class Quebrado:
        name = "quebrado"

        async def render(self, request):
            raise PdfError("servico indisponivel")

    await versao_aprovada(api, owner, levantamento)
    monkeypatch.setattr(rota, "get_pdf_adapter", lambda: Quebrado())

    resposta = await exporta(api, owner, levantamento.projeto_id)
    assert resposta.status_code == 502, resposta.text
    assert "servico indisponivel" in resposta.json()["detail"]


# --------------------------------------------------------- link interno


async def test_cria_link_interno_e_abre(api, owner, levantamento):
    await versao_aprovada(api, owner, levantamento)

    criado = await api.post(
        f"/api/projects/{levantamento.projeto_id}/presentation/share-link",
        headers=owner.auth,
    )
    assert criado.status_code == 200, criado.text
    share = criado.json()["share"]
    assert share["url"] == f"/api/p/{share['token']}"
    assert len(share["token"]) >= 32, "token precisa de entropia de verdade"

    aberta = await api.get(share["url"], headers=owner.auth)
    assert aberta.status_code == 200
    assert aberta.json()["project_id"] == levantamento.projeto_id
    assert len(aberta.json()["slides"]) == 1


async def test_link_interno_exige_login(api, owner, levantamento):
    """O token encurta a URL; ele não autentica."""
    await versao_aprovada(api, owner, levantamento)
    share = (
        await api.post(
            f"/api/projects/{levantamento.projeto_id}/presentation/share-link",
            headers=owner.auth,
        )
    ).json()["share"]

    anonimo = await api.get(share["url"])
    assert anonimo.status_code == 401, "link não é portal público de cliente"


async def test_editor_do_tenant_abre_o_link(api, owner, editor, levantamento):
    """Interno quer dizer: qualquer pessoa logada no workspace."""
    await versao_aprovada(api, owner, levantamento)
    share = (
        await api.post(
            f"/api/projects/{levantamento.projeto_id}/presentation/share-link",
            headers=owner.auth,
        )
    ).json()["share"]

    assert (await api.get(share["url"], headers=editor.auth)).status_code == 200


async def test_renovar_o_link_invalida_o_anterior(api, owner, levantamento):
    """É assim que se revoga um link que circulou demais."""
    await versao_aprovada(api, owner, levantamento)
    primeiro = (
        await api.post(
            f"/api/projects/{levantamento.projeto_id}/presentation/share-link",
            headers=owner.auth,
        )
    ).json()["share"]
    segundo = (
        await api.post(
            f"/api/projects/{levantamento.projeto_id}/presentation/share-link",
            headers=owner.auth,
        )
    ).json()["share"]

    assert primeiro["token"] != segundo["token"]
    assert (await api.get(primeiro["url"], headers=owner.auth)).status_code == 404
    assert (await api.get(segundo["url"], headers=owner.auth)).status_code == 200


async def test_token_inexistente_responde_404(api, owner):
    assert (await api.get("/api/p/token-que-nao-existe", headers=owner.auth)).status_code == 404


# ----------------------------------------------------------- auth e tenant


async def test_apresentacao_exige_token(api, levantamento):
    assert (
        await api.get(f"/api/projects/{levantamento.projeto_id}/presentation")
    ).status_code == 401
    assert (
        await api.put(
            f"/api/projects/{levantamento.projeto_id}/presentation", json={"slides": []}
        )
    ).status_code == 401
    assert (
        await api.post(f"/api/projects/{levantamento.projeto_id}/presentation/export")
    ).status_code == 401
    assert (
        await api.get(f"/api/presentations/{levantamento.projeto_id}/pdf")
    ).status_code == 401


async def test_outro_tenant_nao_alcanca_a_apresentacao(
    api, owner, banco, levantamento, sufixo
):
    from app.core.security import create_access_token

    await versao_aprovada(api, owner, levantamento)
    share = (
        await api.post(
            f"/api/projects/{levantamento.projeto_id}/presentation/share-link",
            headers=owner.auth,
        )
    ).json()["share"]
    await exporta(api, owner, levantamento.projeto_id)

    outro_tenant = str(
        (await banco["tenants"].insert_one({"slug": f"outro-{sufixo}", "name": "Outro"})).inserted_id
    )
    outro_usuario = (
        await banco["users"].insert_one(
            {
                "tenant_id": outro_tenant,
                "email": f"outro-apresentacao-{sufixo}@exemplo-teste.com",
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

    assert (
        await api.get(f"/api/projects/{levantamento.projeto_id}/presentation", headers=invasor)
    ).status_code == 404
    assert (
        await api.get(f"/api/presentations/{levantamento.projeto_id}/pdf", headers=invasor)
    ).status_code == 404
    # O link de um workspace não abre em outro. A proteção aqui é em duas
    # camadas: a busca pelo token é escopada por tenant E o projeto é carregado
    # com escopo depois. Removendo só uma delas o acesso continua negado — por
    # isso este assert sozinho não prova qual camada agiu, e as duas ficam.
    assert (await api.get(share["url"], headers=invasor)).status_code == 404


# ---------------------------------------------- o original continua intocado


async def test_original_intacto_depois_de_exportar(api, owner, banco, midia, levantamento):
    await versao_aprovada(api, owner, levantamento)
    await exporta(api, owner, levantamento.projeto_id)

    baixado = await api.get(
        f"/api/photos/{levantamento.foto_id}/original", headers=owner.auth
    )
    assert baixado.content == levantamento.foto_bytes
    assert sha256(baixado.content) == levantamento.foto_sha

    doc = await banco["photos"].find_one({"_id": ObjectId(levantamento.foto_id)})
    pasta = (midia / doc["storage_key"]).parent
    assert sorted(p.name for p in pasta.iterdir()) == ["derived", "original.jpg"], (
        "o PDF não pode ter sido escrito na pasta da foto"
    )


@pytest.mark.parametrize(
    "indice", ["uniq_tenant_project_presentation", "tenant_share_token"]
)
async def test_indices_da_fase_existem(banco, indice):
    nomes = set(await banco["presentations"].index_information())
    assert indice in nomes, sorted(nomes)
