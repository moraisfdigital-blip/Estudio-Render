"""Fase 7 — catálogo de materiais, acabamentos e marca.

A regra que esta suíte existe para proteger: **a cor da proposta vem do
catálogo da ARTELUX, não do frontend**. O elemento guarda só ids; nome e cor
são resolvidos na leitura. Se alguém um dia desnormalizar isso "para ficar mais
rápido", `test_renomear_no_catalogo_aparece_no_elemento` quebra.

A segunda regra: **quem administra catálogo é o owner**. Editor especifica o
que já existe, não inventa material.
"""

import pytest
from bson import ObjectId

from helpers import imagem_png, sha256


async def cria_material(api, owner, nome: str, **extra) -> dict:
    resposta = await api.post(
        "/api/materials", headers=owner.auth, json={"name": nome, **extra}
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


async def cria_acabamento(api, owner, material_id: str, nome: str, cor: str, hexa: str) -> dict:
    resposta = await api.post(
        "/api/finishes",
        headers=owner.auth,
        json={
            "material_id": material_id,
            "name": nome,
            "color_name": cor,
            "color_hex": hexa,
        },
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


async def cria_marca(api, owner, nome: str) -> dict:
    resposta = await api.post("/api/brands", headers=owner.auth, json={"name": nome})
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


# --------------------------------------------------------------- estado inicial


async def test_elemento_nasce_sem_especificacao(elemento):
    """Marcar a peça na foto não decide do que ela é feita."""
    assert elemento["spec"]["is_empty"] is True
    assert elemento["spec"]["material"] is None
    assert elemento["spec"]["finish"] is None, "spec vazia não pode inventar cor"
    assert elemento["spec"]["brand"] is None


@pytest.mark.parametrize("rota", ["/api/materials", "/api/finishes", "/api/brands"])
async def test_catalogo_responde_lista_mesmo_vazio(api, owner, rota):
    """Catálogo sem nada é estado vazio na tela, não erro."""
    resposta = await api.get(rota, headers=owner.auth)
    assert resposta.status_code == 200
    assert isinstance(resposta.json(), list)


# ------------------------------------------------------------------- cadastro


async def test_owner_cadastra_material_acabamento_e_marca(api, owner, sufixo):
    material = await cria_material(
        api, owner, f"  ACM {sufixo}  ", description="Chapa composta"
    )
    assert material["name"] == f"ACM {sufixo}", "espaço sobrando devia ser normalizado"
    assert material["finish_count"] == 0

    acabamento = await cria_acabamento(
        api, owner, material["id"], "Brilho", "Branco", "#FFFFFF"
    )
    assert acabamento["material_name"] == f"ACM {sufixo}"
    assert acabamento["color_hex"] == "#ffffff", "hex é guardado minúsculo"
    assert acabamento["color_name"] == "Branco", "o nome da cor é o que vai pra fábrica"

    marca = await cria_marca(api, owner, f"Marca {sufixo}")
    assert marca["logo"] is None, "marca nasce sem logo, e isso é normal"


async def test_contador_de_acabamentos_e_filtro_por_material(api, owner, sufixo):
    material = await cria_material(api, owner, f"ACM {sufixo}")
    outro = await cria_material(api, owner, f"Vinil {sufixo}")
    brilho = await cria_acabamento(api, owner, material["id"], "Brilho", "Branco", "#ffffff")
    fosco = await cria_acabamento(api, owner, material["id"], "Fosco", "Preto", "#1c1c1e")
    await cria_acabamento(api, owner, outro["id"], "Recortado", "Vermelho", "#c0392b")

    listados = (await api.get("/api/materials", headers=owner.auth)).json()
    encontrado = next(item for item in listados if item["id"] == material["id"])
    assert encontrado["finish_count"] == 2

    filtrados = (
        await api.get(
            "/api/finishes", headers=owner.auth, params={"material_id": material["id"]}
        )
    ).json()
    assert {item["id"] for item in filtrados} == {brilho["id"], fosco["id"]}


async def test_gravado_no_mongo_com_tenant_id(api, owner, banco, sufixo):
    """200 na API não prova nada; o que vale é o documento."""
    material = await cria_material(api, owner, f"ACM {sufixo}")
    acabamento = await cria_acabamento(
        api, owner, material["id"], "Brilho", "Branco", "#FFFFFF"
    )
    marca = await cria_marca(api, owner, f"Marca {sufixo}")

    doc_material = await banco["materials"].find_one({"_id": ObjectId(material["id"])})
    assert doc_material["tenant_id"] == owner.tenant_id
    assert doc_material["name_key"] == f"acm {sufixo}"

    doc_acabamento = await banco["finishes"].find_one({"_id": ObjectId(acabamento["id"])})
    assert doc_acabamento["tenant_id"] == owner.tenant_id
    assert doc_acabamento["material_id"] == material["id"]
    assert doc_acabamento["color_hex"] == "#ffffff"

    doc_marca = await banco["brands"].find_one({"_id": ObjectId(marca["id"])})
    assert doc_marca["tenant_id"] == owner.tenant_id


# ----------------------------------------------------------------------- RBAC


async def test_editor_le_o_catalogo(api, editor):
    """Editor precisa da lista para especificar — leitura é do tenant inteiro."""
    for rota in ("/api/materials", "/api/finishes", "/api/brands"):
        assert (await api.get(rota, headers=editor.auth)).status_code == 200


async def test_editor_nao_gerencia_catalogo(api, owner, editor, banco, sufixo):
    material = await cria_material(api, owner, f"ACM {sufixo}")

    negado = await api.post(
        "/api/materials", headers=editor.auth, json={"name": f"Proibido {sufixo}"}
    )
    assert negado.status_code == 403, negado.text

    assert (
        await api.post(
            "/api/finishes",
            headers=editor.auth,
            json={
                "material_id": material["id"],
                "name": "X",
                "color_name": "Y",
                "color_hex": "#000000",
            },
        )
    ).status_code == 403
    assert (
        await api.post("/api/brands", headers=editor.auth, json={"name": f"X {sufixo}"})
    ).status_code == 403
    assert (
        await api.patch(
            f"/api/materials/{material['id']}",
            headers=editor.auth,
            json={"name": "Renomeado"},
        )
    ).status_code == 403

    assert await banco["materials"].find_one({"name_key": f"proibido {sufixo}"}) is None


# ------------------------------------------------------------ aplicar no elemento


async def test_editor_aplica_spec_no_elemento(api, owner, editor, banco, elemento, sufixo):
    """Especificar é trabalho de levantamento: o editor pode."""
    material = await cria_material(api, owner, f"ACM {sufixo}")
    acabamento = await cria_acabamento(
        api, owner, material["id"], "Brilho", "Branco", "#FFFFFF"
    )
    marca = await cria_marca(api, owner, f"Marca {sufixo}")

    resposta = await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=editor.auth,
        json={
            "material_id": material["id"],
            "finish_id": acabamento["id"],
            "brand_id": marca["id"],
        },
    )
    assert resposta.status_code == 200, resposta.text
    spec = resposta.json()["spec"]

    assert spec["is_empty"] is False
    assert spec["material"]["name"] == f"ACM {sufixo}"
    assert spec["finish"]["name"] == "Brilho"
    assert spec["finish"]["color_hex"] == "#ffffff", "a cor tem que vir do catálogo"
    assert spec["finish"]["color_name"] == "Branco"
    assert spec["brand"]["name"] == f"Marca {sufixo}"
    assert spec["brand"]["logo_url"] is None, "marca sem logo não inventa url"
    assert spec["applied_at"] is not None

    doc = await banco["elements"].find_one({"_id": ObjectId(elemento["id"])})
    assert doc["spec"]["material_id"] == material["id"]
    assert "name" not in doc["spec"] and "color_hex" not in doc["spec"], (
        "o elemento não pode guardar cópia de nome nem de cor do catálogo"
    )
    assert doc["spec"]["applied_by"]


async def test_spec_nao_encosta_em_medida_nem_conferencia(api, owner, elemento, sufixo):
    material = await cria_material(api, owner, f"ACM {sufixo}")
    acabamento = await cria_acabamento(
        api, owner, material["id"], "Brilho", "Branco", "#ffffff"
    )
    marca = await cria_marca(api, owner, f"Marca {sufixo}")
    await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={
            "material_id": material["id"],
            "finish_id": acabamento["id"],
            "brand_id": marca["id"],
        },
    )

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

    depois = (
        await api.patch(
            f"/api/elements/{elemento['id']}/spec",
            headers=owner.auth,
            json={"brand_id": None},
        )
    ).json()
    assert depois["conference"]["status"] == "conferido", "trocar spec não derruba conferência"
    assert depois["measurements"]["width"]["value"] == 4.2
    assert depois["measurements"]["width"]["source"] == "user_measured"
    assert depois["spec"]["brand"] is None, "null limpa aquele vínculo"
    assert depois["spec"]["material"]["id"] == material["id"]

    parcial = (
        await api.patch(
            f"/api/elements/{elemento['id']}/spec", headers=owner.auth, json={}
        )
    ).json()
    assert parcial["spec"]["material"]["id"] == material["id"], "PATCH vazio não apaga nada"
    assert parcial["spec"]["finish"]["id"] == acabamento["id"]


async def test_renomear_no_catalogo_aparece_no_elemento(
    api, owner, levantamento, elemento, sufixo
):
    """A prova de que nada está desnormalizado.

    Renomear o material e corrigir a cor tem que aparecer no elemento na
    resposta seguinte, sem tocar no elemento.
    """
    material = await cria_material(api, owner, f"ACM {sufixo}")
    acabamento = await cria_acabamento(
        api, owner, material["id"], "Brilho", "Branco", "#ffffff"
    )
    await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={"material_id": material["id"], "finish_id": acabamento["id"]},
    )

    await api.patch(
        f"/api/materials/{material['id']}",
        headers=owner.auth,
        json={"name": f"ACM renomeado {sufixo}"},
    )
    await api.patch(
        f"/api/finishes/{acabamento['id']}", headers=owner.auth, json={"color_hex": "#ABCDEF"}
    )

    atual = (
        await api.get(
            f"/api/photos/{levantamento.foto_id}/elements", headers=owner.auth
        )
    ).json()[0]
    assert atual["spec"]["material"]["name"] == f"ACM renomeado {sufixo}"
    assert atual["spec"]["finish"]["color_hex"] == "#abcdef"


# -------------------------------------------------------------------- recusas


async def test_acabamento_de_outro_material_e_recusado(api, owner, elemento, sufixo):
    material = await cria_material(api, owner, f"ACM {sufixo}")
    outro = await cria_material(api, owner, f"Vinil {sufixo}")
    de_outro = await cria_acabamento(
        api, owner, outro["id"], "Recortado", "Vermelho", "#c0392b"
    )

    resposta = await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={"material_id": material["id"], "finish_id": de_outro["id"]},
    )
    assert resposta.status_code == 422, resposta.text
    detalhe = resposta.json()["detail"].lower()
    assert "não é do material" in detalhe, detalhe


async def test_limpar_material_deixando_acabamento_e_recusado(api, owner, elemento, sufixo):
    """Acabamento é variante de um material: sem material não há o que variar."""
    material = await cria_material(api, owner, f"ACM {sufixo}")
    acabamento = await cria_acabamento(
        api, owner, material["id"], "Brilho", "Branco", "#ffffff"
    )
    await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={"material_id": material["id"], "finish_id": acabamento["id"]},
    )

    orfao = await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={"material_id": None},
    )
    assert orfao.status_code == 422, orfao.text


async def test_spec_com_item_inexistente_ou_id_invalido(api, owner, elemento):
    inexistente = await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={"material_id": "0" * 24},
    )
    assert inexistente.status_code == 404

    malformado = await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={"material_id": "nao-e-id"},
    )
    assert malformado.status_code == 422


async def test_cliente_nao_forja_campo_calculado(api, owner, elemento, sufixo):
    """`extra="forbid"`: o cliente não manda cor resolvida nem nome de material."""
    material = await cria_material(api, owner, f"ACM {sufixo}")

    na_spec = await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={"material_id": material["id"], "color_hex": "#ff0000"},
    )
    assert na_spec.status_code == 422

    no_catalogo = await api.post(
        "/api/finishes",
        headers=owner.auth,
        json={
            "material_id": material["id"],
            "name": "Z",
            "color_name": "Z",
            "color_hex": "#000000",
            "material_name": "mentira",
        },
    )
    assert no_catalogo.status_code == 422


@pytest.mark.parametrize(
    ("cor", "motivo"),
    [
        ("vermelho", "cor tem que ser hex"),
        ("#fff", "forma curta fica de fora: um formato só no banco"),
        ("#gggggg", "hex inválido"),
    ],
)
async def test_hex_invalido_e_recusado(api, owner, sufixo, cor, motivo):
    material = await cria_material(api, owner, f"ACM {sufixo}")
    resposta = await api.post(
        "/api/finishes",
        headers=owner.auth,
        json={
            "material_id": material["id"],
            "name": "Z",
            "color_name": "Z",
            "color_hex": cor,
        },
    )
    assert resposta.status_code == 422, motivo


async def test_acabamento_precisa_de_material_existente(api, owner):
    sem_material = await api.post(
        "/api/finishes",
        headers=owner.auth,
        json={"name": "Z", "color_name": "Z", "color_hex": "#ffffff"},
    )
    assert sem_material.status_code == 422

    inexistente = await api.post(
        "/api/finishes",
        headers=owner.auth,
        json={
            "material_id": "0" * 24,
            "name": "Z",
            "color_name": "Z",
            "color_hex": "#ffffff",
        },
    )
    assert inexistente.status_code == 404


async def test_nome_vazio_e_duplicidade(api, owner, sufixo):
    vazio = await api.post("/api/materials", headers=owner.auth, json={"name": "   "})
    assert vazio.status_code == 422

    material = await cria_material(api, owner, f"ACM {sufixo}")
    await cria_acabamento(api, owner, material["id"], "Brilho", "Branco", "#ffffff")
    await cria_marca(api, owner, f"Marca {sufixo}")

    # Duplicidade é insensível a caixa e espaço: é erro de digitação, não escolha.
    duplicado = await api.post(
        "/api/materials", headers=owner.auth, json={"name": f"  acm {sufixo.upper()}  "}
    )
    assert duplicado.status_code == 409, duplicado.text
    assert (
        await api.post("/api/brands", headers=owner.auth, json={"name": f"marca {sufixo}"})
    ).status_code == 409
    assert (
        await api.post(
            "/api/finishes",
            headers=owner.auth,
            json={
                "material_id": material["id"],
                "name": "brilho",
                "color_name": "X",
                "color_hex": "#ffffff",
            },
        )
    ).status_code == 409


async def test_mesmo_acabamento_em_outro_material_e_permitido(api, owner, sufixo):
    """"Branco fosco" pode existir em ACM e em vinil ao mesmo tempo."""
    acm = await cria_material(api, owner, f"ACM {sufixo}")
    vinil = await cria_material(api, owner, f"Vinil {sufixo}")
    await cria_acabamento(api, owner, acm["id"], "Brilho", "Branco", "#ffffff")

    resposta = await api.post(
        "/api/finishes",
        headers=owner.auth,
        json={
            "material_id": vinil["id"],
            "name": "Brilho",
            "color_name": "Branco",
            "color_hex": "#ffffff",
        },
    )
    assert resposta.status_code == 201, resposta.text


# ------------------------------------------------------------ logo da marca


async def test_logo_e_gravado_e_devolvido_igual(api, owner, banco, midia, sufixo):
    marca = await cria_marca(api, owner, f"Marca {sufixo}")
    conteudo = imagem_png((200, 30, 40))

    upload = await api.put(
        f"/api/brands/{marca['id']}/logo",
        headers=owner.auth,
        files={"file": ("logo.png", conteudo, "image/png")},
    )
    assert upload.status_code == 200, upload.text
    logo = upload.json()["logo"]
    assert logo["checksum_sha256"] == sha256(conteudo)
    assert logo["url"] == f"/api/brands/{marca['id']}/logo", "a url é montada pelo servidor"

    download = await api.get(f"/api/brands/{marca['id']}/logo", headers=owner.auth)
    assert download.status_code == 200
    assert download.content == conteudo, "bytes de volta têm que ser os mesmos"


async def test_trocar_logo_nao_sobrescreve_o_anterior(api, owner, banco, midia, sufixo):
    """Mesma regra da foto original: derivado é arquivo novo, nunca reescrita."""
    marca = await cria_marca(api, owner, f"Marca {sufixo}")
    primeiro = imagem_png((200, 30, 40))
    await api.put(
        f"/api/brands/{marca['id']}/logo",
        headers=owner.auth,
        files={"file": ("logo.png", primeiro, "image/png")},
    )
    doc = await banco["brands"].find_one({"_id": ObjectId(marca["id"])})
    chave_antiga = doc["logo"]["storage_key"]

    await api.put(
        f"/api/brands/{marca['id']}/logo",
        headers=owner.auth,
        files={"file": ("logo2.png", imagem_png((10, 200, 90)), "image/png")},
    )
    doc = await banco["brands"].find_one({"_id": ObjectId(marca["id"])})
    chave_nova = doc["logo"]["storage_key"]

    assert chave_antiga != chave_nova, "trocar logo grava arquivo novo"
    anterior = midia / chave_antiga
    assert anterior.is_file(), "o logo anterior continua no disco"
    assert sha256(anterior.read_bytes()) == sha256(primeiro), "intacto byte a byte"
    assert (midia / chave_nova).stat().st_mode & 0o222 == 0, "mídia nasce somente-leitura"


async def test_logo_recusa_arquivo_que_nao_e_imagem(api, owner, sufixo):
    """O tipo vem dos bytes, não do `Content-Type` que o cliente mandou."""
    marca = await cria_marca(api, owner, f"Marca {sufixo}")
    resposta = await api.put(
        f"/api/brands/{marca['id']}/logo",
        headers=owner.auth,
        files={"file": ("x.png", b"%PDF-1.4 nao sou imagem", "image/png")},
    )
    assert resposta.status_code == 415, resposta.text


async def test_editor_nao_envia_logo(api, owner, editor, sufixo):
    marca = await cria_marca(api, owner, f"Marca {sufixo}")
    resposta = await api.put(
        f"/api/brands/{marca['id']}/logo",
        headers=editor.auth,
        files={"file": ("logo.png", imagem_png((1, 2, 3)), "image/png")},
    )
    assert resposta.status_code == 403, resposta.text


async def test_elemento_com_marca_que_tem_logo_devolve_a_url(api, owner, elemento, sufixo):
    marca = await cria_marca(api, owner, f"Marca {sufixo}")
    await api.put(
        f"/api/brands/{marca['id']}/logo",
        headers=owner.auth,
        files={"file": ("logo.png", imagem_png((5, 5, 5)), "image/png")},
    )

    spec = (
        await api.patch(
            f"/api/elements/{elemento['id']}/spec",
            headers=owner.auth,
            json={"brand_id": marca["id"]},
        )
    ).json()["spec"]
    assert spec["brand"]["logo_url"] == f"/api/brands/{marca['id']}/logo"


# ------------------------------------------------------------- auth e tenant


async def test_catalogo_exige_token(api, elemento, owner, sufixo):
    marca = await cria_marca(api, owner, f"Marca {sufixo}")
    assert (await api.get("/api/materials")).status_code == 401
    assert (await api.post("/api/materials", json={"name": "x"})).status_code == 401
    assert (
        await api.patch(f"/api/elements/{elemento['id']}/spec", json={})
    ).status_code == 401
    assert (await api.get(f"/api/brands/{marca['id']}/logo")).status_code == 401


async def test_marca_inexistente_responde_404(api, owner):
    assert (
        await api.get(f"/api/brands/{'0' * 24}", headers=owner.auth)
    ).status_code == 404


# ----------------------------------------------------------- reload e índices


async def test_tudo_sobrevive_ao_reload(api, owner, levantamento, elemento, sufixo):
    """O que a tela recarrega depois de fechar o navegador."""
    material = await cria_material(api, owner, f"ACM {sufixo}")
    acabamento = await cria_acabamento(
        api, owner, material["id"], "Brilho", "Branco", "#ffffff"
    )
    marca = await cria_marca(api, owner, f"Marca {sufixo}")
    await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={
            "material_id": material["id"],
            "finish_id": acabamento["id"],
            "brand_id": marca["id"],
        },
    )
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

    recarregado = (
        await api.get(
            f"/api/photos/{levantamento.foto_id}/elements", headers=owner.auth
        )
    ).json()[0]
    assert recarregado["spec"]["material"]["id"] == material["id"]
    assert recarregado["spec"]["finish"]["id"] == acabamento["id"]
    assert recarregado["spec"]["brand"]["id"] == marca["id"]
    assert recarregado["measurements"]["width"]["value"] == 4.2
    assert recarregado["conference"]["status"] == "conferido"


async def test_foto_original_continua_intacta_depois_de_tudo(
    api, owner, banco, midia, levantamento, elemento, sufixo
):
    """A regra inegociável do projeto, conferida no disco."""
    material = await cria_material(api, owner, f"ACM {sufixo}")
    await api.patch(
        f"/api/elements/{elemento['id']}/spec",
        headers=owner.auth,
        json={"material_id": material["id"]},
    )

    baixado = await api.get(
        f"/api/photos/{levantamento.foto_id}/original", headers=owner.auth
    )
    assert baixado.content == levantamento.foto_bytes
    assert sha256(baixado.content) == levantamento.foto_sha

    doc = await banco["photos"].find_one({"_id": ObjectId(levantamento.foto_id)})
    pasta = (midia / doc["storage_key"]).parent
    # Derivados existem e vivem em `derived/` — a cópia sem EXIF é um deles. A
    # regra proíbe o original ser tocado ou substituído, não que derivados
    # existam; por isso o assert olha só os arquivos da raiz da pasta.
    raiz = sorted(p.name for p in pasta.iterdir() if p.is_file())
    assert raiz == ["original.jpg"], raiz


@pytest.mark.parametrize(
    ("colecao", "indice"),
    [
        ("materials", "uniq_tenant_material_name"),
        ("finishes", "uniq_material_finish_name"),
        ("brands", "uniq_tenant_brand_name"),
    ],
)
async def test_indices_da_fase_existem(banco, colecao, indice):
    """Sem o índice único, o 409 de duplicidade vira dois cadastros iguais."""
    nomes = set(await banco[colecao].index_information())
    assert indice in nomes, sorted(nomes)
