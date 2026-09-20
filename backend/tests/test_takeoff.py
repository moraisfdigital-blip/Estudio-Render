"""Fase 12 — quantitativo e orçamento.

As três regras que esta suíte protege:

**Só elemento conferido entra.** Peça marcada e nunca conferida é hipótese, não
linha de orçamento.

**Estimativa continua estimativa.** A área sai de largura × altura e herda a
pior procedência das duas: uma medida de campo multiplicada por uma estimativa
é uma estimativa, e a linha sai rotulada assim para quem fecha preço.

**Preço nunca é inventado.** O catálogo não guarda preço, e não existe tabela
nem média neste código. Linha sem preço fica sem preço, e o total é declarado
parcial — nunca somado como se a linha fosse de graça.
"""

import pytest
from bson import ObjectId


async def elemento_conferido(
    api,
    owner,
    levantamento,
    *,
    largura: float | None = 2.0,
    altura: float | None = 1.5,
    origem_altura: str = "user_measured",
    nome: str = "Letreiro",
    spec: dict | None = None,
) -> dict:
    """Cria um elemento medido e conferido, opcionalmente com material."""
    criado = await api.post(
        f"/api/photos/{levantamento.foto_id}/elements",
        headers=owner.auth,
        json={
            "name": nome,
            "kind": "placa",
            "box": {"x": 100, "y": 100, "width": 400, "height": 300},
        },
    )
    assert criado.status_code == 201, criado.text
    element = criado.json()

    if spec:
        aplicada = await api.patch(
            f"/api/elements/{element['id']}/spec", headers=owner.auth, json=spec
        )
        assert aplicada.status_code == 200, aplicada.text

    if largura is not None:
        medidas: dict = {"unit": "m", "width": {"value": largura, "source": "user_measured"}}
        if altura is not None:
            medidas["height"] = {"value": altura, "source": origem_altura}
        salvas = await api.put(
            f"/api/elements/{element['id']}/measurements", headers=owner.auth, json=medidas
        )
        assert salvas.status_code == 200, salvas.text

        conferido = await api.post(
            f"/api/elements/{element['id']}/conference",
            headers=owner.auth,
            json={"status": "conferido"},
        )
        assert conferido.status_code == 200, conferido.text

    return element


async def catalogo(api, owner, sufixo) -> dict:
    material = (
        await api.post("/api/materials", headers=owner.auth, json={"name": f"ACM {sufixo}"})
    ).json()
    acabamento = (
        await api.post(
            "/api/finishes",
            headers=owner.auth,
            json={
                "material_id": material["id"],
                "name": "Brilho",
                "color_name": "Branco",
                "color_hex": "#ffffff",
            },
        )
    ).json()
    return {"material": material, "finish": acabamento}


async def gera(api, usuario, projeto_id):
    return await api.post(
        f"/api/projects/{projeto_id}/quantity-takeoff", headers=usuario.auth
    )


async def ver(api, usuario, projeto_id) -> dict:
    resposta = await api.get(
        f"/api/projects/{projeto_id}/quantity-takeoff", headers=usuario.auth
    )
    assert resposta.status_code == 200, resposta.text
    return resposta.json()


# ------------------------------------------------------------- estado vazio


async def test_projeto_sem_quantitativo_responde_vazio(api, owner, levantamento):
    corpo = await ver(api, owner, levantamento.projeto_id)
    assert corpo["generated"] is False
    assert corpo["items"] == []
    assert corpo["total"] is None, "orçamento vazio não é R$ 0,00"


async def test_elemento_nao_conferido_nao_entra(api, owner, levantamento):
    """Hipótese não vira linha de orçamento."""
    await api.post(
        f"/api/photos/{levantamento.foto_id}/elements",
        headers=owner.auth,
        json={
            "name": "Ainda não conferido",
            "kind": "placa",
            "box": {"x": 10, "y": 10, "width": 100, "height": 80},
        },
    )

    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    assert corpo["items"] == []


# ------------------------------------------------------------------- gerar


async def test_gera_linha_do_elemento_conferido(api, owner, banco, levantamento, sufixo):
    cat = await catalogo(api, owner, sufixo)
    await elemento_conferido(
        api,
        owner,
        levantamento,
        spec={"material_id": cat["material"]["id"], "finish_id": cat["finish"]["id"]},
    )

    resposta = await gera(api, owner, levantamento.projeto_id)
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()

    assert corpo["generated"] is True
    linha = corpo["items"][0]

    assert "Letreiro" in linha["description"]
    assert linha["kind_label"] == "Placa"
    assert linha["material_name"] == f"ACM {sufixo}"
    assert linha["finish_name"] == "Brilho"
    assert linha["color_hex"] == "#ffffff", "a cor vem do catálogo"
    assert linha["quantity"] == 3.0, "2,00 m × 1,50 m"
    assert linha["unit"] == "m2"
    assert linha["quantity_source"] == "user_measured"
    assert linha["quantity_source_label"] == "Medido em campo"
    assert linha["unit_price"] is None, "preço nasce vazio — o catálogo não tem preço"
    assert linha["line_total"] is None

    doc = await banco["quantity_takeoffs"].find_one({"project_id": levantamento.projeto_id})
    assert doc["tenant_id"] == owner.tenant_id
    assert doc["generated_by"]


async def test_medida_em_cm_vira_metro_quadrado(api, owner, levantamento):
    element = await elemento_conferido(api, owner, levantamento, largura=None)
    await api.put(
        f"/api/elements/{element['id']}/measurements",
        headers=owner.auth,
        json={
            "unit": "cm",
            "width": {"value": 200.0, "source": "user_measured"},
            "height": {"value": 150.0, "source": "user_measured"},
        },
    )
    await api.post(
        f"/api/elements/{element['id']}/conference",
        headers=owner.auth,
        json={"status": "conferido"},
    )

    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    assert corpo["items"][0]["quantity"] == 3.0, "200 cm × 150 cm = 3 m²"


# ------------------------------------------ A REGRA: estimativa não vira fato


async def test_estimativa_contamina_a_linha_inteira(api, owner, levantamento):
    """Medida de campo × estimativa = estimativa. Nunca o contrário."""
    await elemento_conferido(api, owner, levantamento, origem_altura="estimated")

    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    linha = corpo["items"][0]

    assert linha["quantity"] == 3.0
    assert linha["quantity_source"] == "estimated"
    assert linha["quantity_source_label"] == "Estimativa"
    assert corpo["items_with_estimate"] == 1, "o resumo avisa quantas linhas são estimativa"


async def test_duas_medidas_de_campo_continuam_medidas(api, owner, levantamento):
    await elemento_conferido(api, owner, levantamento, origem_altura="user_measured")
    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    assert corpo["items"][0]["quantity_source"] == "user_measured"
    assert corpo["items_with_estimate"] == 0


async def test_sem_medida_suficiente_nao_inventa_quantidade(api, owner, levantamento):
    """Só largura não vira área plausível: vira linha sem quantidade e com o motivo."""
    await elemento_conferido(api, owner, levantamento, altura=None)

    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    linha = corpo["items"][0]

    assert linha["quantity"] is None
    assert linha["quantity_source"] is None
    assert "não há como calcular a área" in linha["quantity_note"]
    assert corpo["skipped_without_measurement"] == 1
    assert corpo["total"] is None


# ----------------------------------------------- A REGRA: preço é informado


async def test_preco_informado_fecha_o_total(api, owner, levantamento):
    await elemento_conferido(api, owner, levantamento)
    linha = (await gera(api, owner, levantamento.projeto_id)).json()["items"][0]

    resposta = await api.patch(
        f"/api/budget-items/{linha['id']}", headers=owner.auth, json={"unit_price": 250.0}
    )
    assert resposta.status_code == 200, resposta.text
    corpo = resposta.json()

    assert corpo["items"][0]["unit_price"] == 250.0
    assert corpo["items"][0]["line_total"] == 750.0, "3 m² × R$ 250"
    assert corpo["total"] == 750.0
    assert corpo["items_without_price"] == 0


async def test_total_e_parcial_enquanto_falta_preco(api, owner, levantamento):
    """Linha sem preço não soma como zero — ela conta como pendência."""
    await elemento_conferido(api, owner, levantamento, nome="Com preço")
    await elemento_conferido(api, owner, levantamento, nome="Sem preço")
    corpo = (await gera(api, owner, levantamento.projeto_id)).json()

    com_preco = corpo["items"][0]
    atualizado = (
        await api.patch(
            f"/api/budget-items/{com_preco['id']}",
            headers=owner.auth,
            json={"unit_price": 100.0},
        )
    ).json()

    assert atualizado["total"] == 300.0
    assert atualizado["items_without_price"] == 1, "o resumo denuncia o orçamento incompleto"


async def test_quantidade_informada_e_rotulada_como_tal(api, owner, levantamento):
    """Número digitado não passa a valer como medida de campo."""
    await elemento_conferido(api, owner, levantamento, altura=None)
    linha = (await gera(api, owner, levantamento.projeto_id)).json()["items"][0]
    assert linha["quantity"] is None

    corpo = (
        await api.patch(
            f"/api/budget-items/{linha['id']}", headers=owner.auth, json={"quantity": 4.5}
        )
    ).json()
    atualizada = corpo["items"][0]

    assert atualizada["quantity"] == 4.5
    assert atualizada["quantity_source"] == "user_informed"
    assert atualizada["quantity_source_label"] == "Informado no orçamento"
    assert atualizada["quantity_note"] is None, "a explicação de 'sem medida' perdeu sentido"


@pytest.mark.parametrize(
    ("payload", "motivo"),
    [
        ({"quantity": 0}, "quantidade zero é linha que não deveria existir"),
        ({"quantity": -3}, "quantidade negativa"),
        ({"unit_price": -10}, "preço negativo"),
        ({"unit": "duzia"}, "unidade fora da lista"),
        ({"quantity_source": "user_measured"}, "cliente tentando forjar a procedência"),
        ({"line_total": 999}, "cliente tentando forjar o total"),
    ],
)
async def test_linha_invalida_e_recusada(api, owner, levantamento, payload, motivo):
    await elemento_conferido(api, owner, levantamento)
    linha = (await gera(api, owner, levantamento.projeto_id)).json()["items"][0]

    resposta = await api.patch(
        f"/api/budget-items/{linha['id']}", headers=owner.auth, json=payload
    )
    assert resposta.status_code == 422, f"{motivo}: {resposta.status_code}"


# --------------------------------------------------- regerar sem perder nada


async def test_regerar_preserva_preco_e_observacao(api, owner, levantamento):
    """Se a regeração apagasse os preços, o botão seria inutilizável."""
    await elemento_conferido(api, owner, levantamento)
    linha = (await gera(api, owner, levantamento.projeto_id)).json()["items"][0]
    await api.patch(
        f"/api/budget-items/{linha['id']}",
        headers=owner.auth,
        json={"unit_price": 180.0, "notes": "Inclui instalação"},
    )

    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    depois = corpo["items"][0]

    assert depois["id"] == linha["id"], "o id sobrevive: a tela não perde a referência"
    assert depois["unit_price"] == 180.0
    assert depois["notes"] == "Inclui instalação"
    assert depois["line_total"] == 540.0


async def test_regerar_atualiza_a_quantidade_quando_a_medida_muda(api, owner, levantamento):
    element = await elemento_conferido(api, owner, levantamento)
    linha = (await gera(api, owner, levantamento.projeto_id)).json()["items"][0]
    assert linha["quantity"] == 3.0

    await api.put(
        f"/api/elements/{element['id']}/measurements",
        headers=owner.auth,
        json={
            "unit": "m",
            "width": {"value": 4.0, "source": "user_measured"},
            "height": {"value": 2.0, "source": "user_measured"},
        },
    )
    await api.post(
        f"/api/elements/{element['id']}/conference",
        headers=owner.auth,
        json={"status": "conferido"},
    )

    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    assert corpo["items"][0]["quantity"] == 8.0, "a medida nova manda"


async def test_quantidade_informada_sobrevive_a_regeracao(api, owner, levantamento):
    """Alguém olhou a peça e digitou: recalcular por cima apagaria a decisão."""
    await elemento_conferido(api, owner, levantamento)
    linha = (await gera(api, owner, levantamento.projeto_id)).json()["items"][0]
    await api.patch(
        f"/api/budget-items/{linha['id']}", headers=owner.auth, json={"quantity": 12.0}
    )

    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    assert corpo["items"][0]["quantity"] == 12.0
    assert corpo["items"][0]["quantity_source"] == "user_informed"


# -------------------------------------------------------------- item manual


async def test_adiciona_item_manual(api, owner, levantamento):
    """Instalação, frete, projeto: coisas que não saem de um elemento."""
    await elemento_conferido(api, owner, levantamento)
    await gera(api, owner, levantamento.projeto_id)

    resposta = await api.post(
        f"/api/quantity-takeoff/{levantamento.projeto_id}/items",
        headers=owner.auth,
        json={
            "description": "Instalação com cesto aéreo",
            "quantity": 1,
            "unit": "un",
            "unit_price": 1200.0,
        },
    )
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()

    manual = next(item for item in corpo["items"] if item["origin"] == "manual")
    assert manual["description"] == "Instalação com cesto aéreo"
    assert manual["quantity_source"] == "user_informed"
    assert manual["line_total"] == 1200.0
    assert manual["element_id"] is None


async def test_item_manual_sobrevive_a_regeracao(api, owner, levantamento):
    await elemento_conferido(api, owner, levantamento)
    await gera(api, owner, levantamento.projeto_id)
    await api.post(
        f"/api/quantity-takeoff/{levantamento.projeto_id}/items",
        headers=owner.auth,
        json={"description": "Frete", "quantity": 1, "unit": "un", "unit_price": 300.0},
    )

    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    manuais = [item for item in corpo["items"] if item["origin"] == "manual"]
    assert len(manuais) == 1
    assert manuais[0]["unit_price"] == 300.0


# ------------------------------------------------------ reload e integridade


async def test_quantitativo_sobrevive_ao_reload(api, owner, levantamento, sufixo):
    cat = await catalogo(api, owner, sufixo)
    await elemento_conferido(
        api,
        owner,
        levantamento,
        origem_altura="estimated",
        spec={"material_id": cat["material"]["id"], "finish_id": cat["finish"]["id"]},
    )
    linha = (await gera(api, owner, levantamento.projeto_id)).json()["items"][0]
    await api.patch(
        f"/api/budget-items/{linha['id']}", headers=owner.auth, json={"unit_price": 90.0}
    )

    recarregado = await ver(api, owner, levantamento.projeto_id)
    item = recarregado["items"][0]
    assert item["material_name"] == f"ACM {sufixo}"
    assert item["quantity_source"] == "estimated", "a estimativa continua rotulada no reload"
    assert item["unit_price"] == 90.0
    assert item["line_total"] == 270.0
    assert recarregado["total"] == 270.0


async def test_elemento_removido_sai_do_quantitativo(api, owner, levantamento):
    element = await elemento_conferido(api, owner, levantamento)
    assert len((await gera(api, owner, levantamento.projeto_id)).json()["items"]) == 1

    await api.delete(f"/api/elements/{element['id']}", headers=owner.auth)

    corpo = (await gera(api, owner, levantamento.projeto_id)).json()
    assert corpo["items"] == []


# ----------------------------------------------------------- auth e tenant


async def test_quantitativo_exige_token(api, levantamento):
    assert (
        await api.get(f"/api/projects/{levantamento.projeto_id}/quantity-takeoff")
    ).status_code == 401
    assert (
        await api.post(f"/api/projects/{levantamento.projeto_id}/quantity-takeoff")
    ).status_code == 401
    assert (await api.patch("/api/budget-items/qualquer", json={})).status_code == 401


async def test_editor_gera_e_precifica(api, owner, editor, levantamento):
    """Orçar é trabalho do projeto — não é administração de workspace."""
    await elemento_conferido(api, owner, levantamento)
    resposta = await gera(api, editor, levantamento.projeto_id)
    assert resposta.status_code == 200, resposta.text

    linha = resposta.json()["items"][0]
    precificada = await api.patch(
        f"/api/budget-items/{linha['id']}", headers=editor.auth, json={"unit_price": 50.0}
    )
    assert precificada.status_code == 200


async def test_outro_tenant_nao_alcanca_o_quantitativo(
    api, owner, banco, levantamento, sufixo
):
    from app.core.security import create_access_token

    await elemento_conferido(api, owner, levantamento)
    linha = (await gera(api, owner, levantamento.projeto_id)).json()["items"][0]

    outro_tenant = str(
        (await banco["tenants"].insert_one({"slug": f"outro-{sufixo}", "name": "Outro"})).inserted_id
    )
    outro_usuario = (
        await banco["users"].insert_one(
            {
                "tenant_id": outro_tenant,
                "email": f"outro-orcamento-{sufixo}@exemplo-teste.com",
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
        await api.get(
            f"/api/projects/{levantamento.projeto_id}/quantity-takeoff", headers=invasor
        )
    ).status_code == 404
    assert (
        await api.patch(
            f"/api/budget-items/{linha['id']}", headers=invasor, json={"unit_price": 1.0}
        )
    ).status_code == 404

    doc = await banco["quantity_takeoffs"].find_one({"project_id": levantamento.projeto_id})
    assert doc["items"][0]["unit_price"] is None, "a recusa não pode ter encostado no preço"


async def test_linha_inexistente_responde_404(api, owner):
    assert (
        await api.patch(
            f"/api/budget-items/{ObjectId()}", headers=owner.auth, json={"unit_price": 1.0}
        )
    ).status_code == 404


@pytest.mark.parametrize(
    "indice", ["uniq_tenant_project_takeoff", "tenant_takeoff_item"]
)
async def test_indices_da_fase_existem(banco, indice):
    nomes = set(await banco["quantity_takeoffs"].index_information())
    assert indice in nomes, sorted(nomes)
