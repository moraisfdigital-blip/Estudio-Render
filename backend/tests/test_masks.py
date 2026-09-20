"""Fase 8 — máscaras de intervenção/proteção e Architecture Lock.

A regra que esta suíte existe para proteger: **a geração só pode alterar pixel
sob máscara de intervenção**. Aqui ainda não se gera nada — o que se estabelece
é o contrato que a Fase 9 vai obedecer, e o veredito (`generation_ready` +
`blocked_reason`) já sai pronto do servidor.

Os dois bloqueios que precisam continuar existindo depois que a Fase 9 chegar:

* foto sem camada de intervenção → não há onde gerar;
* Architecture Lock desligado → gerar significaria abrir mão de preservar a
  arquitetura original.
"""

import pytest
from bson import ObjectId

from helpers import sha256

# Retângulos em pixel do original (a foto do cenário é 1600x1200).
PLACA = [{"x": 200, "y": 300}, {"x": 800, "y": 300}, {"x": 800, "y": 540}, {"x": 200, "y": 540}]
JANELA = [{"x": 900, "y": 200}, {"x": 1100, "y": 200}, {"x": 1100, "y": 500}, {"x": 900, "y": 500}]


def intervencao(points=None, label=None) -> dict:
    return {"kind": "intervention", "points": points or PLACA, **({"label": label} if label else {})}


def protecao(points=None, label=None) -> dict:
    return {"kind": "protect", "points": points or JANELA, **({"label": label} if label else {})}


async def salva(api, usuario, foto_id: str, layers: list[dict]):
    return await api.put(
        f"/api/photos/{foto_id}/masks", headers=usuario.auth, json={"layers": layers}
    )


# ------------------------------------------------------------- estado inicial


async def test_foto_sem_mascara_responde_estado_vazio(api, owner, levantamento):
    """Foto sem máscara é o estado inicial normal, não erro."""
    resposta = await api.get(f"/api/photos/{levantamento.foto_id}/masks", headers=owner.auth)
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()

    assert corpo["masked"] is False
    assert corpo["layers"] == []
    assert corpo["intervention_count"] == 0
    assert corpo["protect_count"] == 0


async def test_sem_intervencao_a_geracao_fica_bloqueada(api, owner, levantamento):
    """O motivo do bloqueio sai pronto do servidor — a tela não o inventa."""
    corpo = (
        await api.get(f"/api/photos/{levantamento.foto_id}/masks", headers=owner.auth)
    ).json()
    assert corpo["generation_ready"] is False
    assert "máscara de intervenção" in corpo["blocked_reason"]


async def test_architecture_lock_nasce_ligado(api, owner, levantamento):
    """Preservar a arquitetura é o padrão; desligar é decisão explícita."""
    projeto = (
        await api.get(f"/api/projects/{levantamento.projeto_id}", headers=owner.auth)
    ).json()
    assert projeto["architecture_lock"] is True

    masks = (
        await api.get(f"/api/photos/{levantamento.foto_id}/masks", headers=owner.auth)
    ).json()
    assert masks["architecture_lock"] is True


# --------------------------------------------------------------- desenhar


async def test_salvar_camadas_de_intervencao_e_protecao(api, owner, levantamento):
    resposta = await salva(
        api,
        owner,
        levantamento.foto_id,
        [intervencao(label="Placa do totem"), protecao(label="Janela do vizinho")],
    )
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()

    assert corpo["masked"] is True
    assert corpo["intervention_count"] == 1
    assert corpo["protect_count"] == 1
    assert corpo["image_width"] == levantamento.largura
    assert corpo["image_height"] == levantamento.altura

    placa, janela = corpo["layers"]
    assert placa["kind"] == "intervention"
    assert placa["kind_label"] == "Intervenção", "o rótulo vem pronto do servidor"
    assert placa["label"] == "Placa do totem"
    # 600 x 240 px = 144.000 px², calculado no servidor pelo shoelace.
    assert placa["area_px"] == 144000.0
    assert placa["id"], "o id da camada nasce no servidor"
    assert janela["kind"] == "protect"
    assert janela["kind_label"] == "Proteção"
    assert placa["id"] != janela["id"]


async def test_camada_sem_nome_recebe_o_rotulo_do_tipo(api, owner, levantamento):
    """Item em branco na lista é pior do que um nome genérico."""
    corpo = (await salva(api, owner, levantamento.foto_id, [intervencao()])).json()
    assert corpo["layers"][0]["label"] == "Intervenção"


async def test_gravado_no_mongo_com_tenant_id(api, owner, banco, levantamento):
    await salva(api, owner, levantamento.foto_id, [intervencao(), protecao()])

    doc = await banco["masks"].find_one({"photo_id": levantamento.foto_id})
    assert doc["tenant_id"] == owner.tenant_id
    assert doc["project_id"] == levantamento.projeto_id, "contexto desnormalizado p/ Fase 9"
    assert doc["area_id"] == levantamento.area_id
    assert len(doc["layers"]) == 2
    assert doc["layers"][0]["area_px"] == 144000.0
    assert doc["updated_by"], "quem desenhou fica registrado"


async def test_put_substitui_as_camadas_em_vez_de_acumular(api, owner, banco, levantamento):
    """O que está na tela ao salvar é exatamente o que fica no banco."""
    primeira = (await salva(api, owner, levantamento.foto_id, [intervencao(), protecao()])).json()
    assert len(primeira["layers"]) == 2

    segunda = (await salva(api, owner, levantamento.foto_id, [intervencao()])).json()
    assert len(segunda["layers"]) == 1, "redesenhar não empilha sobras do desenho anterior"
    assert segunda["protect_count"] == 0

    doc = await banco["masks"].find_one({"photo_id": levantamento.foto_id})
    assert len(doc["layers"]) == 1


async def test_lista_vazia_apaga_o_desenho(api, owner, levantamento):
    await salva(api, owner, levantamento.foto_id, [intervencao()])

    vazia = (await salva(api, owner, levantamento.foto_id, [])).json()
    assert vazia["masked"] is False
    assert vazia["layers"] == []
    assert vazia["generation_ready"] is False, "sem intervenção, volta a bloquear"


async def test_desenho_sobrevive_ao_reload(api, owner, levantamento):
    salvo = (await salva(api, owner, levantamento.foto_id, [intervencao(label="Placa")])).json()

    recarregado = (
        await api.get(f"/api/photos/{levantamento.foto_id}/masks", headers=owner.auth)
    ).json()
    assert recarregado["layers"] == salvo["layers"]
    assert recarregado["updated_at"] is not None


# ------------------------------------------------------- o veredito da geração


async def test_com_intervencao_e_lock_ligado_a_geracao_libera(api, owner, levantamento):
    corpo = (await salva(api, owner, levantamento.foto_id, [intervencao()])).json()
    assert corpo["generation_ready"] is True
    assert corpo["blocked_reason"] is None


async def test_so_protecao_nao_libera_geracao(api, owner, levantamento):
    """Proteção sozinha diz onde *não* mexer — não cria lugar para gerar."""
    corpo = (await salva(api, owner, levantamento.foto_id, [protecao()])).json()
    assert corpo["masked"] is True
    assert corpo["generation_ready"] is False
    assert "máscara de intervenção" in corpo["blocked_reason"]


async def test_lock_desligado_bloqueia_mesmo_com_intervencao(api, owner, levantamento):
    """O lock desligado é bloqueio por si só, não um detalhe da máscara."""
    await salva(api, owner, levantamento.foto_id, [intervencao()])

    desligado = await api.patch(
        f"/api/projects/{levantamento.projeto_id}/architecture-lock",
        headers=owner.auth,
        json={"enabled": False},
    )
    assert desligado.status_code == 200, desligado.text
    assert desligado.json()["architecture_lock"] is False

    corpo = (
        await api.get(f"/api/photos/{levantamento.foto_id}/masks", headers=owner.auth)
    ).json()
    assert corpo["architecture_lock"] is False
    assert corpo["generation_ready"] is False
    assert "Architecture Lock" in corpo["blocked_reason"]

    religado = await api.patch(
        f"/api/projects/{levantamento.projeto_id}/architecture-lock",
        headers=owner.auth,
        json={"enabled": True},
    )
    assert religado.json()["architecture_lock"] is True
    liberado = (
        await api.get(f"/api/photos/{levantamento.foto_id}/masks", headers=owner.auth)
    ).json()
    assert liberado["generation_ready"] is True


async def test_lock_persiste_no_banco(api, owner, banco, levantamento):
    await api.patch(
        f"/api/projects/{levantamento.projeto_id}/architecture-lock",
        headers=owner.auth,
        json={"enabled": False},
    )
    doc = await banco["projects"].find_one({"_id": ObjectId(levantamento.projeto_id)})
    assert doc["architecture_lock"] is False


# ----------------------------------------------------------------------- RBAC


async def test_editor_desenha_mascara(api, owner, editor, levantamento):
    """Desenhar é trabalho de levantamento: o editor faz."""
    resposta = await salva(api, editor, levantamento.foto_id, [intervencao()])
    assert resposta.status_code == 200, resposta.text


async def test_editor_nao_mexe_no_architecture_lock(api, owner, editor, banco, levantamento):
    """Desligar o lock é abrir mão da garantia — decisão de owner."""
    resposta = await api.patch(
        f"/api/projects/{levantamento.projeto_id}/architecture-lock",
        headers=editor.auth,
        json={"enabled": False},
    )
    assert resposta.status_code == 403, resposta.text

    doc = await banco["projects"].find_one({"_id": ObjectId(levantamento.projeto_id)})
    assert doc["architecture_lock"] is True, "a recusa não pode ter encostado no projeto"


# -------------------------------------------------------------------- recusas


@pytest.mark.parametrize(
    ("layers", "motivo"),
    [
        ([{"kind": "intervention", "points": [{"x": 0, "y": 0}, {"x": 10, "y": 0}]}],
         "polígono com dois vértices não tem interior"),
        ([{"kind": "escultura", "points": PLACA}], "tipo de camada fora da lista"),
        ([{"kind": "intervention", "points": [{"x": -5, "y": 0}, {"x": 10, "y": 0},
                                              {"x": 10, "y": 10}]}],
         "coordenada negativa não existe em imagem"),
        ([{"kind": "intervention", "points": PLACA, "id": "forjado"}],
         "cliente tentando escolher o id da camada"),
        ([{"kind": "intervention", "points": PLACA, "area_px": 1}],
         "cliente tentando forjar a área calculada"),
        ([{"points": PLACA}], "camada sem tipo"),
    ],
)
async def test_camada_invalida_e_recusada_pelo_schema(api, owner, levantamento, layers, motivo):
    resposta = await salva(api, owner, levantamento.foto_id, layers)
    assert resposta.status_code == 422, f"{motivo}: {resposta.status_code}"


async def test_campo_extra_no_corpo_e_recusado(api, owner, levantamento):
    resposta = await api.put(
        f"/api/photos/{levantamento.foto_id}/masks",
        headers=owner.auth,
        json={"layers": [intervencao()], "architecture_lock": False},
    )
    assert resposta.status_code == 422, "o lock não se desliga por dentro do PUT de máscara"


async def test_vertice_fora_da_foto_e_recusado(api, owner, levantamento):
    """Área de intervenção fora da imagem daria à Fase 9 permissão sobre pixel inexistente."""
    fora = [{"x": 10, "y": 10}, {"x": 5000, "y": 10}, {"x": 5000, "y": 400}, {"x": 10, "y": 400}]
    resposta = await salva(api, owner, levantamento.foto_id, [intervencao(points=fora)])
    assert resposta.status_code == 422, resposta.text
    assert "fora da foto" in resposta.json()["detail"]


async def test_poligono_sem_area_e_recusado(api, owner, levantamento):
    """Três cliques quase no mesmo lugar não são um recorte de peça."""
    colados = [{"x": 100, "y": 100}, {"x": 103, "y": 100}, {"x": 103, "y": 102}]
    resposta = await salva(api, owner, levantamento.foto_id, [intervencao(points=colados)])
    assert resposta.status_code == 422, resposta.text
    assert "não delimita área" in resposta.json()["detail"]


async def test_payload_gigante_e_recusado(api, owner, levantamento):
    """Teto de payload: a Fase 9 carrega este documento a cada geração."""
    muitos_pontos = [{"x": 100 + (i % 400), "y": 100 + (i % 300)} for i in range(600)]
    assert (
        await salva(api, owner, levantamento.foto_id, [intervencao(points=muitos_pontos)])
    ).status_code == 422

    muitas_camadas = [intervencao() for _ in range(60)]
    assert (await salva(api, owner, levantamento.foto_id, muitas_camadas)).status_code == 422


async def test_recusa_nao_encosta_no_desenho_salvo(api, owner, banco, levantamento):
    await salva(api, owner, levantamento.foto_id, [intervencao(label="Válida")])

    fora = [{"x": 10, "y": 10}, {"x": 9000, "y": 10}, {"x": 9000, "y": 400}]
    await salva(api, owner, levantamento.foto_id, [intervencao(points=fora)])

    doc = await banco["masks"].find_one({"photo_id": levantamento.foto_id})
    assert len(doc["layers"]) == 1
    assert doc["layers"][0]["label"] == "Válida"


# ----------------------------------------------------------- auth e tenant


async def test_mascaras_exigem_token(api, levantamento):
    assert (await api.get(f"/api/photos/{levantamento.foto_id}/masks")).status_code == 401
    assert (
        await api.put(f"/api/photos/{levantamento.foto_id}/masks", json={"layers": []})
    ).status_code == 401
    assert (
        await api.patch(
            f"/api/projects/{levantamento.projeto_id}/architecture-lock",
            json={"enabled": False},
        )
    ).status_code == 401


async def test_foto_inexistente_e_id_malformado(api, owner):
    assert (
        await api.get(f"/api/photos/{ObjectId()}/masks", headers=owner.auth)
    ).status_code == 404
    assert (
        await api.get("/api/photos/nao-e-id/masks", headers=owner.auth)
    ).status_code == 404


async def test_outro_tenant_nao_alcanca_as_mascaras(api, owner, banco, levantamento, sufixo):
    """Isolamento some como 404 — nunca 403, que contaria que o recurso existe."""
    from app.core.security import create_access_token

    outro_tenant = str(
        (await banco["tenants"].insert_one({"slug": f"outro-{sufixo}", "name": "Outro"})).inserted_id
    )
    outro_usuario = (
        await banco["users"].insert_one(
            {
                "tenant_id": outro_tenant,
                "email": f"outro-mascara-{sufixo}@exemplo-teste.com",
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
        await api.get(f"/api/photos/{levantamento.foto_id}/masks", headers=invasor)
    ).status_code == 404
    assert (
        await api.put(
            f"/api/photos/{levantamento.foto_id}/masks",
            headers=invasor,
            json={"layers": [intervencao()]},
        )
    ).status_code == 404
    assert (
        await api.patch(
            f"/api/projects/{levantamento.projeto_id}/architecture-lock",
            headers=invasor,
            json={"enabled": False},
        )
    ).status_code == 404

    assert await banco["masks"].find_one({"photo_id": levantamento.foto_id}) is None


# --------------------------------------------------- convivência com as fases


async def test_grid_mostra_quantos_recortes_a_foto_tem(api, owner, levantamento):
    """O grid diz o andamento sem abrir foto por foto — como `calibrated`."""
    antes = (
        await api.get(f"/api/photos/{levantamento.foto_id}", headers=owner.auth)
    ).json()
    assert antes["intervention_count"] == 0

    await salva(api, owner, levantamento.foto_id, [intervencao(), intervencao(), protecao()])

    depois = (
        await api.get(f"/api/photos/{levantamento.foto_id}", headers=owner.auth)
    ).json()
    assert depois["intervention_count"] == 2, "só a camada de intervenção conta"

    grid = (
        await api.get(f"/api/areas/{levantamento.area_id}/photos", headers=owner.auth)
    ).json()[0]
    assert grid["intervention_count"] == 2


async def test_mascara_nao_encosta_em_medida_conferencia_nem_spec(
    api, owner, levantamento, elemento
):
    """Desenhar máscara é outro assunto: não pode derrubar o levantamento."""
    await api.put(
        f"/api/elements/{elemento['id']}/measurements",
        headers=owner.auth,
        json={"unit": "m", "width": {"value": 4.2, "source": "user_measured"}},
    )
    await api.post(
        f"/api/elements/{elemento['id']}/conference",
        headers=owner.auth,
        json={"status": "conferido"},
    )

    await salva(api, owner, levantamento.foto_id, [intervencao(), protecao()])

    depois = (
        await api.get(f"/api/photos/{levantamento.foto_id}/elements", headers=owner.auth)
    ).json()[0]
    assert depois["measurements"]["width"]["value"] == 4.2
    assert depois["measurements"]["width"]["source"] == "user_measured"
    assert depois["conference"]["status"] == "conferido"


async def test_foto_original_intacta_depois_de_desenhar(
    api, owner, banco, midia, levantamento
):
    """A regra inegociável: máscara é registro novo, não edição da foto."""
    await salva(api, owner, levantamento.foto_id, [intervencao(), protecao()])

    baixado = await api.get(
        f"/api/photos/{levantamento.foto_id}/original", headers=owner.auth
    )
    assert baixado.content == levantamento.foto_bytes
    assert sha256(baixado.content) == levantamento.foto_sha

    doc = await banco["photos"].find_one({"_id": ObjectId(levantamento.foto_id)})
    pasta = (midia / doc["storage_key"]).parent
    arquivos = sorted(p.name for p in pasta.rglob("*"))
    assert arquivos == ["original.jpg"], f"nenhum derivado devia existir: {arquivos}"


@pytest.mark.parametrize("indice", ["uniq_tenant_photo_mask", "tenant_project_mask"])
async def test_indices_da_fase_existem(banco, indice):
    """Sem o índice único, dois saves concorrentes viram duas máscaras na foto."""
    nomes = set(await banco["masks"].index_information())
    assert indice in nomes, sorted(nomes)
