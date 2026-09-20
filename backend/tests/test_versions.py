"""Fase 10 — versões (até 3), comparação e aprovação.

As regras que esta suíte protege:

**Três versões, e a quarta é recusada.** O limite não é uma contagem antes do
insert: é um índice único parcial. `test_limite_aguenta_cliques_simultaneos`
dispara quatro promoções ao mesmo tempo e confere que sobraram três — uma
contagem ingênua passaria no teste sequencial e falharia aqui.

**Uma aprovada por foto.** A escolha mora em `photos.approved_version_id`, e
aprovar outra substitui num `$set` só. Não existe estado com duas versões
marcadas como aprovadas.
"""

import asyncio

import pytest
from bson import ObjectId

PLACA = [{"x": 200, "y": 300}, {"x": 800, "y": 300}, {"x": 800, "y": 540}, {"x": 200, "y": 540}]


async def prepara(api, owner, levantamento):
    """Foto com máscara de intervenção — pré-requisito para gerar."""
    resposta = await api.put(
        f"/api/photos/{levantamento.foto_id}/masks",
        headers=owner.auth,
        json={"layers": [{"kind": "intervention", "label": "Placa", "points": PLACA}]},
    )
    assert resposta.status_code == 200, resposta.text


async def gera(api, usuario, foto_id) -> str:
    """Gera uma proposta e devolve o id dela."""
    resposta = await api.post(f"/api/photos/{foto_id}/proposals", headers=usuario.auth)
    assert resposta.status_code == 201, resposta.text
    return resposta.json()["id"]


async def promove(api, usuario, foto_id, proposal_id, **extra):
    return await api.post(
        f"/api/photos/{foto_id}/versions",
        headers=usuario.auth,
        json={"proposal_id": proposal_id, **extra},
    )


async def versoes(api, usuario, foto_id) -> dict:
    resposta = await api.get(f"/api/photos/{foto_id}/versions", headers=usuario.auth)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


# ------------------------------------------------------------- estado vazio


async def test_foto_sem_versao_responde_estado_inicial(api, owner, levantamento):
    corpo = await versoes(api, owner, levantamento.foto_id)
    assert corpo["versions"] == []
    assert corpo["max_versions"] == 3
    assert corpo["slots_left"] == 3
    assert corpo["limit_reached"] is False
    assert corpo["approved_version_id"] is None


# ---------------------------------------------------------------- promover


async def test_promove_geracao_a_versao(api, owner, banco, levantamento):
    await prepara(api, owner, levantamento)
    proposal_id = await gera(api, owner, levantamento.foto_id)

    resposta = await promove(api, owner, levantamento.foto_id, proposal_id, label="Opção azul")
    assert resposta.status_code == 201, resposta.text
    versao = resposta.json()

    assert versao["position"] == 1
    assert versao["label"] == "Opção azul"
    assert versao["proposal_id"] == proposal_id
    assert versao["approved"] is False
    assert versao["generated_image"]["url"].startswith("/api/generated-images/")

    doc = await banco["versions"].find_one({"_id": ObjectId(versao["id"])})
    assert doc["tenant_id"] == owner.tenant_id
    assert doc["deleted_at"] is None
    assert doc["created_by"]


async def test_versao_sem_nome_recebe_rotulo_da_posicao(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    versao = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()
    assert versao["label"] == "Versão 1"


async def test_versao_aponta_para_a_imagem_existente_sem_copiar(
    api, owner, banco, levantamento
):
    """A versão elege uma geração; não duplica o arquivo no disco."""
    await prepara(api, owner, levantamento)
    proposal_id = await gera(api, owner, levantamento.foto_id)
    versao = (await promove(api, owner, levantamento.foto_id, proposal_id)).json()

    proposta = await banco["proposals"].find_one({"_id": ObjectId(proposal_id)})
    doc = await banco["versions"].find_one({"_id": ObjectId(versao["id"])})
    assert doc["generated_image_id"] == proposta["generated_image_id"]

    imagens = await banco["generated_images"].count_documents(
        {"photo_id": levantamento.foto_id}
    )
    assert imagens == 1, "promover não pode gerar um segundo arquivo"


async def test_tres_versoes_ocupam_as_tres_vagas(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    for esperado in (1, 2, 3):
        resposta = await promove(
            api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id)
        )
        assert resposta.status_code == 201, resposta.text
        assert resposta.json()["position"] == esperado

    corpo = await versoes(api, owner, levantamento.foto_id)
    assert len(corpo["versions"]) == 3
    assert corpo["slots_left"] == 0
    assert corpo["limit_reached"] is True


async def test_quarta_versao_e_recusada(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    for _ in range(3):
        await promove(
            api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id)
        )

    quarta = await promove(
        api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id)
    )
    assert quarta.status_code == 422, quarta.text
    assert "limite" in quarta.json()["detail"].lower()

    assert len((await versoes(api, owner, levantamento.foto_id))["versions"]) == 3


async def test_limite_aguenta_cliques_simultaneos(api, owner, levantamento):
    """A prova de que o limite é estrutural, e não uma contagem.

    Quatro promoções disparadas ao mesmo tempo: uma contagem antes do insert
    perderia a corrida e gravaria quatro versões. O índice único parcial recusa
    quem tentar uma vaga já tomada.
    """
    await prepara(api, owner, levantamento)
    propostas = [await gera(api, owner, levantamento.foto_id) for _ in range(4)]

    respostas = await asyncio.gather(
        *(promove(api, owner, levantamento.foto_id, pid) for pid in propostas)
    )
    criadas = [r for r in respostas if r.status_code == 201]
    recusadas = [r for r in respostas if r.status_code in (409, 422)]

    assert len(criadas) <= 3, "nunca pode passar de três"
    assert len(criadas) + len(recusadas) == 4, [r.status_code for r in respostas]

    corpo = await versoes(api, owner, levantamento.foto_id)
    assert len(corpo["versions"]) <= 3
    assert sorted(v["position"] for v in corpo["versions"]) == list(
        range(1, len(corpo["versions"]) + 1)
    ), "as posições ocupadas não podem ter buraco nem repetição"


async def test_mesma_proposta_nao_vira_duas_versoes(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    proposal_id = await gera(api, owner, levantamento.foto_id)
    assert (await promove(api, owner, levantamento.foto_id, proposal_id)).status_code == 201

    repetida = await promove(api, owner, levantamento.foto_id, proposal_id)
    assert repetida.status_code == 409, repetida.text


async def test_proposta_que_falhou_nao_vira_versao(api, owner, levantamento, monkeypatch):
    """Tentativa sem imagem não tem o que promover."""
    from app.adapters.image_gen import ImageGenError
    from app.api.routers import proposals as rota

    class Quebrado:
        name = "quebrado"

        async def generate(self, request):
            raise ImageGenError("cota esgotada")

    await prepara(api, owner, levantamento)
    monkeypatch.setattr(rota, "get_image_gen_adapter", lambda: Quebrado())
    falha = await api.post(
        f"/api/photos/{levantamento.foto_id}/proposals", headers=owner.auth
    )
    assert falha.status_code == 502

    doc_falho = await api.get(
        f"/api/photos/{levantamento.foto_id}/proposals", headers=owner.auth
    )
    proposal_id = doc_falho.json()[0]["id"]

    resposta = await promove(api, owner, levantamento.foto_id, proposal_id)
    assert resposta.status_code == 422, resposta.text
    assert "não tem imagem gerada" in resposta.json()["detail"]


async def test_proposta_de_outra_foto_e_recusada(api, owner, levantamento, sufixo):
    await prepara(api, owner, levantamento)
    proposal_id = await gera(api, owner, levantamento.foto_id)

    outra = await api.post(
        f"/api/areas/{levantamento.area_id}/photos",
        headers=owner.auth,
        files={"file": ("outra.jpg", levantamento.foto_bytes, "image/jpeg")},
    )
    resposta = await promove(api, owner, outra.json()["id"], proposal_id)
    assert resposta.status_code == 422, resposta.text
    assert "outra foto" in resposta.json()["detail"]


# ---------------------------------------------------------------- comparar


async def test_compara_versoes_na_ordem_pedida(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    primeira = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()
    segunda = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()

    resposta = await api.get(
        f"/api/photos/{levantamento.foto_id}/versions/compare",
        headers=owner.auth,
        params={"ids": f"{segunda['id']},{primeira['id']}"},
    )
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()

    assert [v["id"] for v in corpo["versions"]] == [segunda["id"], primeira["id"]]
    assert corpo["original_url"] == f"/api/photos/{levantamento.foto_id}/original"
    assert all(v["generated_image"] for v in corpo["versions"])


async def test_comparacao_recusa_id_de_outra_foto_em_vez_de_omitir(
    api, owner, levantamento
):
    """Lista silenciosamente menor esconderia o erro de quem chamou."""
    await prepara(api, owner, levantamento)
    versao = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()

    resposta = await api.get(
        f"/api/photos/{levantamento.foto_id}/versions/compare",
        headers=owner.auth,
        params={"ids": f"{versao['id']},{ObjectId()}"},
    )
    assert resposta.status_code == 404


async def test_comparacao_sem_ids_e_recusada(api, owner, levantamento):
    resposta = await api.get(
        f"/api/photos/{levantamento.foto_id}/versions/compare",
        headers=owner.auth,
        params={"ids": " , "},
    )
    assert resposta.status_code == 422


# ---------------------------------------------------------------- aprovar


async def test_owner_aprova_e_a_escolha_persiste(api, owner, banco, levantamento):
    await prepara(api, owner, levantamento)
    versao = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()

    resposta = await api.post(f"/api/versions/{versao['id']}/approve", headers=owner.auth)
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()

    assert corpo["approved_version_id"] == versao["id"]
    assert [v["approved"] for v in corpo["versions"]] == [True]

    doc = await banco["photos"].find_one({"_id": ObjectId(levantamento.foto_id)})
    assert doc["approved_version_id"] == versao["id"], "a escolha mora na foto"
    assert doc["approved_by"] and doc["approved_at"]


async def test_aprovar_outra_substitui_a_anterior(api, owner, banco, levantamento):
    """Uma aprovada por foto — nunca duas."""
    await prepara(api, owner, levantamento)
    primeira = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()
    segunda = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()

    await api.post(f"/api/versions/{primeira['id']}/approve", headers=owner.auth)
    corpo = (
        await api.post(f"/api/versions/{segunda['id']}/approve", headers=owner.auth)
    ).json()

    aprovadas = [v["id"] for v in corpo["versions"] if v["approved"]]
    assert aprovadas == [segunda["id"]]
    assert corpo["approved_version_id"] == segunda["id"]


async def test_editor_nao_aprova(api, owner, editor, banco, levantamento):
    """Aprovar é a decisão que vai para o cliente: fica com o owner."""
    await prepara(api, owner, levantamento)
    versao = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()

    resposta = await api.post(f"/api/versions/{versao['id']}/approve", headers=editor.auth)
    assert resposta.status_code == 403, resposta.text

    doc = await banco["photos"].find_one({"_id": ObjectId(levantamento.foto_id)})
    assert doc.get("approved_version_id") is None


async def test_editor_promove_versao(api, owner, editor, levantamento):
    """Promover candidata é trabalho de projeto visual — o editor faz."""
    await prepara(api, owner, levantamento)
    resposta = await promove(
        api, editor, levantamento.foto_id, await gera(api, editor, levantamento.foto_id)
    )
    assert resposta.status_code == 201, resposta.text


async def test_aprovacao_aparece_no_grid(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    versao = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()
    await api.post(f"/api/versions/{versao['id']}/approve", headers=owner.auth)

    foto = (
        await api.get(f"/api/photos/{levantamento.foto_id}", headers=owner.auth)
    ).json()
    assert foto["approved_version_id"] == versao["id"]


# --------------------------------------------------------------- descartar


async def test_descartar_versao_devolve_a_vaga(api, owner, banco, levantamento):
    """Sem isso o limite vira beco sem saída: três versões e nunca mais uma ideia nova."""
    await prepara(api, owner, levantamento)
    versoes_criadas = [
        (
            await promove(
                api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id)
            )
        ).json()
        for _ in range(3)
    ]
    assert (await versoes(api, owner, levantamento.foto_id))["limit_reached"] is True

    descarte = await api.delete(
        f"/api/versions/{versoes_criadas[1]['id']}", headers=owner.auth
    )
    assert descarte.status_code == 204, descarte.text

    depois = await versoes(api, owner, levantamento.foto_id)
    assert len(depois["versions"]) == 2
    assert depois["slots_left"] == 1
    assert depois["limit_reached"] is False

    # O histórico fica: soft-delete, não apagar.
    doc = await banco["versions"].find_one({"_id": ObjectId(versoes_criadas[1]["id"])})
    assert doc is not None
    assert doc["deleted_at"] is not None
    assert doc["deleted_by"]

    # E a vaga liberada é reocupada pela próxima promoção.
    nova = await promove(
        api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id)
    )
    assert nova.status_code == 201, nova.text
    assert nova.json()["position"] == 2, "a vaga 2 estava livre"


async def test_versao_aprovada_nao_pode_ser_descartada(api, owner, levantamento):
    """A Fase 11 depende de haver uma escolha registrada."""
    await prepara(api, owner, levantamento)
    versao = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()
    await api.post(f"/api/versions/{versao['id']}/approve", headers=owner.auth)

    resposta = await api.delete(f"/api/versions/{versao['id']}", headers=owner.auth)
    assert resposta.status_code == 422, resposta.text
    assert "versão aprovada" in resposta.json()["detail"]

    assert len((await versoes(api, owner, levantamento.foto_id))["versions"]) == 1


async def test_versao_descartada_responde_404(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    versao = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()
    await api.delete(f"/api/versions/{versao['id']}", headers=owner.auth)

    assert (
        await api.post(f"/api/versions/{versao['id']}/approve", headers=owner.auth)
    ).status_code == 404


# ----------------------------------------------------------- auth e tenant


async def test_versoes_exigem_token(api, levantamento):
    assert (await api.get(f"/api/photos/{levantamento.foto_id}/versions")).status_code == 401
    assert (
        await api.post(
            f"/api/photos/{levantamento.foto_id}/versions", json={"proposal_id": "0" * 24}
        )
    ).status_code == 401
    assert (await api.post(f"/api/versions/{ObjectId()}/approve")).status_code == 401
    assert (await api.delete(f"/api/versions/{ObjectId()}")).status_code == 401


async def test_outro_tenant_nao_alcanca_as_versoes(api, owner, banco, levantamento, sufixo):
    from app.core.security import create_access_token

    await prepara(api, owner, levantamento)
    versao = (
        await promove(api, owner, levantamento.foto_id, await gera(api, owner, levantamento.foto_id))
    ).json()

    outro_tenant = str(
        (await banco["tenants"].insert_one({"slug": f"outro-{sufixo}", "name": "Outro"})).inserted_id
    )
    outro_usuario = (
        await banco["users"].insert_one(
            {
                "tenant_id": outro_tenant,
                "email": f"outro-versao-{sufixo}@exemplo-teste.com",
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
        await api.get(f"/api/photos/{levantamento.foto_id}/versions", headers=invasor)
    ).status_code == 404
    assert (
        await api.post(f"/api/versions/{versao['id']}/approve", headers=invasor)
    ).status_code == 404
    assert (await api.delete(f"/api/versions/{versao['id']}", headers=invasor)).status_code == 404

    doc = await banco["photos"].find_one({"_id": ObjectId(levantamento.foto_id)})
    assert doc.get("approved_version_id") is None


async def test_cliente_nao_forja_posicao_nem_aprovacao(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    proposal_id = await gera(api, owner, levantamento.foto_id)

    for campo, valor in (("position", 3), ("approved", True), ("tenant_id", "outro")):
        resposta = await promove(api, owner, levantamento.foto_id, proposal_id, **{campo: valor})
        assert resposta.status_code == 422, f"{campo} devia ser recusado"


@pytest.mark.parametrize("indice", ["uniq_photo_version_position"])
async def test_indice_da_fase_existe(banco, indice):
    """É neste índice que o limite de três realmente vive."""
    nomes = set(await banco["versions"].index_information())
    assert indice in nomes, sorted(nomes)
