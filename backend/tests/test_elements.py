"""Fase 6 — elementos, medidas e conferência.

A regra que esta suíte existe para proteger: **a IA nunca inventa medida**.
Toda medida carrega `source` (`user_measured` ou `estimated`), a estimativa
pela escala é calculada na leitura e **nunca gravada** como se alguém tivesse
medido, e o cliente não consegue forjar o rótulo.

É o arquivo que mais importa antes da Fase 8: as máscaras vão mexer no mesmo
elemento e na mesma foto.
"""

import pytest
from bson import ObjectId

from helpers import sha256

CAIXA = {"x": 200.0, "y": 300.0, "width": 600.0, "height": 240.0}


async def calibra(api, owner, foto_id: str, metros: float = 2.0) -> float:
    """Calibra a foto com 600 px = `metros` e devolve o px/unidade."""
    resposta = await api.put(
        f"/api/photos/{foto_id}/calibration",
        headers=owner.auth,
        json={
            "point_a": {"x": 300.0, "y": 400.0},
            "point_b": {"x": 900.0, "y": 400.0},
            "real_length": metros,
            "unit": "m",
        },
    )
    assert resposta.status_code in (200, 201), resposta.text
    return resposta.json()["pixels_per_unit"]


# ------------------------------------------------------------- estado inicial


async def test_foto_sobe_sem_elemento_e_sem_calibracao(api, owner, levantamento):
    foto = (
        await api.get(f"/api/photos/{levantamento.foto_id}", headers=owner.auth)
    ).json()
    assert foto["element_count"] == 0
    assert foto["calibrated"] is False


async def test_lista_vazia_e_estado_inicial_nao_erro(api, owner, levantamento):
    resposta = await api.get(
        f"/api/photos/{levantamento.foto_id}/elements", headers=owner.auth
    )
    assert resposta.status_code == 200
    assert resposta.json() == []


# ------------------------------------------------------------ marcar na foto


async def test_marcar_elemento_na_foto(api, owner, banco, levantamento):
    resposta = await api.post(
        f"/api/photos/{levantamento.foto_id}/elements",
        headers=owner.auth,
        json={
            "name": "  Letreiro   principal  ",
            "kind": "letra_caixa",
            "box": CAIXA,
            "notes": "letra caixa em aço escovado",
        },
    )
    assert resposta.status_code == 201, resposta.text
    elemento = resposta.json()

    assert elemento["name"] == "Letreiro principal", "espaço sobrando é normalizado"
    assert elemento["kind"] == "letra_caixa"
    assert elemento["kind_label"] == "Letra caixa", "o rótulo vem pronto do servidor"
    assert elemento["box"] == CAIXA
    assert elemento["area_id"] == levantamento.area_id, "área herdada da foto"
    assert elemento["project_id"] == levantamento.projeto_id
    assert all(
        elemento["measurements"][dim] is None for dim in ("width", "height", "depth")
    ), "elemento nasce sem medida: marcar não é medir"
    assert elemento["conference"]["status"] == "pendente"
    assert elemento["scale_estimate"] is None, "sem calibração não há estimativa"

    doc = await banco["elements"].find_one({"_id": ObjectId(elemento["id"])})
    assert doc["tenant_id"] == owner.tenant_id
    assert doc["deleted_at"] is None


# ---------------------------------------------------- estimativa pela escala


async def test_estimativa_aparece_so_depois_de_calibrar(
    api, owner, banco, levantamento, elemento
):
    """A estimativa é calculada na leitura e **nunca** gravada como medida."""
    ppu = await calibra(api, owner, levantamento.foto_id)
    assert ppu == 300.0, "600 px para 2,00 m"

    com_escala = (
        await api.get(
            f"/api/photos/{levantamento.foto_id}/elements", headers=owner.auth
        )
    ).json()[0]
    estimativa = com_escala["scale_estimate"]

    assert estimativa is not None
    assert estimativa["width"] == round(CAIXA["width"] / ppu, 2)
    assert estimativa["height"] == round(CAIXA["height"] / ppu, 2)
    assert estimativa["source"] == "estimated", "estimativa vem sempre rotulada"
    assert estimativa["unit"] == "m"

    doc = await banco["elements"].find_one({"_id": ObjectId(elemento["id"])})
    assert all(
        doc["measurements"][dim] is None for dim in ("width", "height", "depth")
    ), "A REGRA: estimativa não pode ser gravada como medida"
    assert "scale_estimate" not in doc, "estimativa nem existe no documento"


# ------------------------------------------------------ medida com procedência


async def test_medida_guarda_a_procedencia_declarada(api, owner, banco, elemento):
    resposta = await api.put(
        f"/api/elements/{elemento['id']}/measurements",
        headers=owner.auth,
        json={
            "unit": "m",
            "width": {"value": 2.4, "source": "user_measured"},
            "height": {"value": 0.82, "source": "estimated"},
        },
    )
    assert resposta.status_code == 200, resposta.text
    medidas = resposta.json()["measurements"]

    assert medidas["width"]["value"] == 2.4
    assert medidas["width"]["source"] == "user_measured"
    assert medidas["width"]["source_label"] == "Medido em campo"
    assert medidas["height"]["source"] == "estimated"
    assert medidas["height"]["source_label"] == "Estimativa"
    assert medidas["depth"] is None, "dimensão não informada não vira zero"
    assert medidas["has_estimate"] is True, "a lista usa isso para rotular"

    doc = await banco["elements"].find_one({"_id": ObjectId(elemento["id"])})
    assert doc["measurements"]["width"] == {"value": 2.4, "source": "user_measured"}
    assert doc["measurements"]["height"]["source"] == "estimated"
    assert doc["measurements"].get("measured_by"), "quem mediu fica registrado"


# ------------------------------------------------------------- conferência


async def test_conferir_e_despendurar(api, owner, banco, elemento):
    await api.put(
        f"/api/elements/{elemento['id']}/measurements",
        headers=owner.auth,
        json={
            "unit": "m",
            "width": {"value": 2.4, "source": "user_measured"},
            "height": {"value": 0.82, "source": "estimated"},
        },
    )

    conferido = await api.post(
        f"/api/elements/{elemento['id']}/conference",
        headers=owner.auth,
        json={"status": "conferido"},
    )
    assert conferido.status_code == 200, conferido.text
    assert conferido.json()["conference"]["status"] == "conferido"
    assert conferido.json()["conference"]["at"] is not None
    assert (
        conferido.json()["measurements"]["height"]["source"] == "estimated"
    ), "conferir não apaga o rótulo de estimativa"

    doc = await banco["elements"].find_one({"_id": ObjectId(elemento["id"])})
    assert doc["conference"]["by"]

    de_volta = await api.post(
        f"/api/elements/{elemento['id']}/conference",
        headers=owner.auth,
        json={"status": "pendente"},
    )
    assert de_volta.json()["conference"]["at"] is None, "despendurar limpa o carimbo"


async def test_mexer_na_medida_devolve_a_conferencia_para_pendente(api, owner, elemento):
    """Medida que mudou depois de conferida precisa ser conferida de novo."""
    await api.put(
        f"/api/elements/{elemento['id']}/measurements",
        headers=owner.auth,
        json={
            "unit": "m",
            "width": {"value": 2.4, "source": "user_measured"},
            "height": {"value": 0.82, "source": "estimated"},
        },
    )
    await api.post(
        f"/api/elements/{elemento['id']}/conference",
        headers=owner.auth,
        json={"status": "conferido"},
    )

    de_novo = await api.put(
        f"/api/elements/{elemento['id']}/measurements",
        headers=owner.auth,
        json={"unit": "cm", "width": {"value": 245.0, "source": "user_measured"}},
    )
    assert de_novo.status_code == 200
    assert de_novo.json()["conference"]["status"] == "pendente"
    assert de_novo.json()["measurements"]["height"] is None, "PUT troca o bloco inteiro"
    assert de_novo.json()["measurements"]["unit"] == "cm"


async def test_conferir_sem_medida_e_recusado(api, owner, levantamento):
    sem_medida = (
        await api.post(
            f"/api/photos/{levantamento.foto_id}/elements",
            headers=owner.auth,
            json={
                "name": "Faixa sem medida",
                "kind": "faixa",
                "box": {"x": 10.0, "y": 10.0, "width": 100.0, "height": 40.0},
            },
        )
    ).json()

    resposta = await api.post(
        f"/api/elements/{sem_medida['id']}/conference",
        headers=owner.auth,
        json={"status": "conferido"},
    )
    assert resposta.status_code == 422, resposta.text
    assert "medida" in resposta.json()["detail"].lower()


# --------------------------------------------------------------- corrigir


async def test_patch_corrige_sem_mexer_em_medida(api, owner, levantamento, elemento):
    ppu = await calibra(api, owner, levantamento.foto_id)
    await api.put(
        f"/api/elements/{elemento['id']}/measurements",
        headers=owner.auth,
        json={"unit": "m", "width": {"value": 2.45, "source": "user_measured"}},
    )
    await api.post(
        f"/api/elements/{elemento['id']}/conference",
        headers=owner.auth,
        json={"status": "conferido"},
    )
    await api.patch(
        f"/api/elements/{elemento['id']}",
        headers=owner.auth,
        json={"notes": "letra caixa em aço escovado"},
    )

    corrigido = await api.patch(
        f"/api/elements/{elemento['id']}",
        headers=owner.auth,
        json={"name": "Letreiro da fachada", "kind": "placa"},
    )
    assert corrigido.status_code == 200, corrigido.text
    corpo = corrigido.json()
    assert corpo["name"] == "Letreiro da fachada"
    assert corpo["kind"] == "placa"
    assert corpo["notes"] == "letra caixa em aço escovado", "PATCH parcial não apaga o resto"
    assert corpo["measurements"]["width"]["value"] == 2.45
    assert corpo["conference"]["status"] == "conferido"

    nova_caixa = {"x": 210.0, "y": 305.0, "width": 590.0, "height": 250.0}
    movido = await api.patch(
        f"/api/elements/{elemento['id']}", headers=owner.auth, json={"box": nova_caixa}
    )
    assert movido.json()["box"] == nova_caixa
    assert movido.json()["scale_estimate"]["width"] == round(
        nova_caixa["width"] / ppu, 2
    ), "a estimativa acompanha o retângulo novo"


# --------------------------------------------------------------- recusas


@pytest.mark.parametrize(
    ("payload", "motivo"),
    [
        ({"unit": "m", "width": {"value": 1.0}}, "medida sem procedência declarada"),
        (
            {"unit": "m", "width": {"value": 1.0, "source": "ia_chutou"}},
            "procedência fora do enum",
        ),
        ({"unit": "m"}, "nenhuma dimensão informada"),
        ({"unit": "m", "width": {"value": 0, "source": "user_measured"}}, "medida zero"),
        (
            {"unit": "m", "width": {"value": -3, "source": "user_measured"}},
            "medida negativa",
        ),
        (
            {"unit": "polegada", "width": {"value": 1.0, "source": "user_measured"}},
            "unidade fora da lista",
        ),
        (
            {
                "unit": "m",
                "width": {"value": 1.0, "source": "user_measured"},
                "measured_by": "eu",
            },
            "campo calculado pelo servidor veio do cliente",
        ),
        (
            {
                "unit": "m",
                "width": {
                    "value": 1.0,
                    "source": "user_measured",
                    "source_label": "Medido em campo",
                },
            },
            "cliente tentando forjar o rótulo",
        ),
    ],
)
async def test_medida_invalida_e_recusada(api, owner, elemento, payload, motivo):
    resposta = await api.put(
        f"/api/elements/{elemento['id']}/measurements", headers=owner.auth, json=payload
    )
    assert resposta.status_code == 422, f"{motivo}: {resposta.status_code}"


async def test_medida_infinita_responde_422_e_nao_500(api, owner, elemento):
    """`1e999` é JSON válido e vira `inf` no parse. Tem que ser recusa, não erro."""
    resposta = await api.put(
        f"/api/elements/{elemento['id']}/measurements",
        headers={"Content-Type": "application/json", **owner.auth},
        content='{"unit": "m", "width": {"value": 1e999, "source": "user_measured"}}',
    )
    assert resposta.status_code == 422, resposta.text


@pytest.mark.parametrize(
    ("payload", "motivo"),
    [
        (
            {"name": "Fora", "box": {"x": 1500.0, "y": 10.0, "width": 400.0, "height": 40.0}},
            "retângulo estourando a borda da foto",
        ),
        (
            {"name": "Ponto", "box": {"x": 10.0, "y": 10.0, "width": 2.0, "height": 2.0}},
            "retângulo minúsculo (clique torto)",
        ),
        (
            {"name": "Linha", "box": {"x": 10.0, "y": 10.0, "width": 0.0, "height": 40.0}},
            "lado zero",
        ),
        (
            {"name": "Negativo", "box": {"x": -5.0, "y": 10.0, "width": 40.0, "height": 40.0}},
            "coordenada negativa",
        ),
        (
            {
                "name": "Estranho",
                "kind": "escultura",
                "box": {"x": 10.0, "y": 10.0, "width": 40.0, "height": 40.0},
            },
            "tipo fora do catálogo",
        ),
        (
            {"name": "   ", "box": {"x": 10.0, "y": 10.0, "width": 40.0, "height": 40.0}},
            "nome vazio",
        ),
        (
            {
                "name": "Atalho",
                "box": {"x": 10.0, "y": 10.0, "width": 40.0, "height": 40.0},
                "conference": {"status": "conferido"},
            },
            "cliente gravando conferência direto",
        ),
        (
            {
                "name": "Injecao",
                "box": {"x": 10.0, "y": 10.0, "width": 40.0, "height": 40.0},
                "measurements": {
                    "unit": "m",
                    "width": {"value": 9.9, "source": "user_measured"},
                },
            },
            "cliente injetando medida na criação",
        ),
    ],
)
async def test_elemento_invalido_e_recusado(api, owner, levantamento, payload, motivo):
    resposta = await api.post(
        f"/api/photos/{levantamento.foto_id}/elements", headers=owner.auth, json=payload
    )
    assert resposta.status_code == 422, f"{motivo}: {resposta.status_code}"


async def test_status_de_conferencia_invalido_e_recusado(api, owner, elemento):
    resposta = await api.post(
        f"/api/elements/{elemento['id']}/conference",
        headers=owner.auth,
        json={"status": "mais_ou_menos"},
    )
    assert resposta.status_code == 422


# ----------------------------------------------------------- auth e tenant


async def test_elementos_exigem_token(api, levantamento, elemento):
    rota = f"/api/photos/{levantamento.foto_id}/elements"
    assert (await api.get(rota)).status_code == 401
    assert (await api.post(rota, json={"name": "x", "box": CAIXA})).status_code == 401
    assert (
        await api.put(
            f"/api/elements/{elemento['id']}/measurements",
            json={"unit": "m", "width": {"value": 1, "source": "user_measured"}},
        )
    ).status_code == 401
    assert (
        await api.post(
            f"/api/elements/{elemento['id']}/conference", json={"status": "conferido"}
        )
    ).status_code == 401


async def test_foto_inexistente_e_id_malformado_respondem_404(api, owner):
    assert (
        await api.get(f"/api/photos/{ObjectId()}/elements", headers=owner.auth)
    ).status_code == 404
    assert (
        await api.patch(
            "/api/elements/nao-e-id", headers=owner.auth, json={"name": "x"}
        )
    ).status_code == 404


async def test_outro_tenant_nao_alcanca_o_elemento(
    api, owner, banco, levantamento, elemento, sufixo
):
    """O isolamento é do `TenantScope`, e some como 404 — nunca 403.

    Responder 403 diria "existe, mas não é seu". 404 não conta nada.
    """
    from app.core.security import create_access_token

    outro_tenant = str(
        (await banco["tenants"].insert_one({"slug": f"outro-{sufixo}", "name": "Outro"}))
        .inserted_id
    )
    outro_usuario = (
        await banco["users"].insert_one(
            {
                "tenant_id": outro_tenant,
                "email": f"outro-{sufixo}@exemplo-teste.com",
                "password_hash": "x",
                "name": "Outro",
                "role": "editor",
            }
        )
    ).inserted_id
    invasor = {
        "Authorization": "Bearer "
        + create_access_token(
            user_id=str(outro_usuario), tenant_id=outro_tenant, role="editor"
        )
    }

    assert (
        await api.get(
            f"/api/photos/{levantamento.foto_id}/elements", headers=invasor
        )
    ).status_code == 404
    assert (
        await api.patch(
            f"/api/elements/{elemento['id']}", headers=invasor, json={"name": "sequestrado"}
        )
    ).status_code == 404
    assert (
        await api.put(
            f"/api/elements/{elemento['id']}/measurements",
            headers=invasor,
            json={"unit": "m", "width": {"value": 1, "source": "user_measured"}},
        )
    ).status_code == 404
    assert (
        await api.post(
            f"/api/elements/{elemento['id']}/conference",
            headers=invasor,
            json={"status": "conferido"},
        )
    ).status_code == 404

    doc = await banco["elements"].find_one({"_id": ObjectId(elemento["id"])})
    assert doc["name"] == "Letreiro principal", "nada disso pode ter alterado o elemento"


# ------------------------------------------------------ reload e soft-delete


async def test_lista_recarrega_na_ordem_de_marcacao(api, owner, levantamento, elemento):
    segundo = (
        await api.post(
            f"/api/photos/{levantamento.foto_id}/elements",
            headers=owner.auth,
            json={
                "name": "Faixa",
                "kind": "faixa",
                "box": {"x": 10.0, "y": 10.0, "width": 100.0, "height": 40.0},
            },
        )
    ).json()

    lista = (
        await api.get(
            f"/api/photos/{levantamento.foto_id}/elements", headers=owner.auth
        )
    ).json()
    assert len(lista) == 2
    assert lista[0]["id"] == elemento["id"], "mais antigo primeiro"
    assert lista[1]["id"] == segundo["id"]

    grid = (
        await api.get(f"/api/areas/{levantamento.area_id}/photos", headers=owner.auth)
    ).json()[0]
    assert grid["element_count"] == 2


async def test_delete_e_soft_delete(api, owner, banco, levantamento, elemento):
    """Remover da tela não apaga o histórico do levantamento."""
    removido = await api.delete(
        f"/api/elements/{elemento['id']}", headers=owner.auth
    )
    assert removido.status_code == 204, removido.text

    lista = (
        await api.get(
            f"/api/photos/{levantamento.foto_id}/elements", headers=owner.auth
        )
    ).json()
    assert lista == [], "some da lista"
    assert (
        await api.patch(
            f"/api/elements/{elemento['id']}", headers=owner.auth, json={"name": "volta"}
        )
    ).status_code == 404

    doc = await banco["elements"].find_one({"_id": ObjectId(elemento["id"])})
    assert doc is not None, "o documento continua no banco"
    assert doc["deleted_at"] is not None
    assert doc.get("deleted_by")

    foto = (
        await api.get(f"/api/photos/{levantamento.foto_id}", headers=owner.auth)
    ).json()
    assert foto["element_count"] == 0


async def test_foto_original_intacta_depois_de_tudo(
    api, owner, banco, midia, levantamento, elemento
):
    await api.put(
        f"/api/elements/{elemento['id']}/measurements",
        headers=owner.auth,
        json={"unit": "m", "width": {"value": 2.4, "source": "user_measured"}},
    )
    await calibra(api, owner, levantamento.foto_id)

    baixado = (
        await api.get(
            f"/api/photos/{levantamento.foto_id}/original", headers=owner.auth
        )
    ).content
    assert baixado == levantamento.foto_bytes
    assert sha256(baixado) == levantamento.foto_sha

    doc = await banco["photos"].find_one({"_id": ObjectId(levantamento.foto_id)})
    pasta = (midia / doc["storage_key"]).parent
    arquivos = sorted(p.name for p in pasta.rglob("*"))
    assert arquivos == ["original.jpg"], f"nenhum derivado devia existir: {arquivos}"
    modo = (pasta / "original.jpg").stat().st_mode & 0o777
    assert modo & 0o222 == 0, f"original devia ser somente-leitura: {oct(modo)}"


@pytest.mark.parametrize(
    "indice", ["tenant_photo_element", "tenant_project_element"]
)
async def test_indices_da_fase_existem(banco, indice):
    nomes = set(await banco["elements"].index_information())
    assert indice in nomes, sorted(nomes)
