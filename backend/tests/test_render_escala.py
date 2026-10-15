"""Render com escala garantida.

O tamanho das peças vem da calibração, não da IA: o servidor desenha a prévia
em escala (estudo da aba 02 × pixels por metro) e, do resultado da IA, só
aceita o que cai dentro do contorno das peças. Aqui o mock devolve a própria
prévia, então dá para afirmar pixel a pixel onde a imagem mudou.

Cenário: foto 1600×1200 (fixture `levantamento`), calibração de 1000 px = 10 m
(100 px/m) com origem em (200, 1000). Testeira de 6,0 × 1,5 m em x=1 m,
base a 3 m → retângulo (300, 550)–(900, 700) na foto.
"""

import io

from PIL import Image

VERMELHO = "#d01010"
RET = (300, 550, 900, 700)
MASCARA_GRANDE = [{"x": 100, "y": 100}, {"x": 1500, "y": 100}, {"x": 1500, "y": 1100}, {"x": 100, "y": 1100}]
MASCARA_FORA = [{"x": 1000, "y": 100}, {"x": 1500, "y": 100}, {"x": 1500, "y": 400}, {"x": 1000, "y": 400}]


async def prepara(api, owner, lev, *, calibrar=True, mascara=MASCARA_GRANDE, objetos=True):
    if calibrar:
        r = await api.put(f"/api/photos/{lev.foto_id}/calibration", headers=owner.auth, json={
            "point_a": {"x": 200, "y": 1000}, "point_b": {"x": 1200, "y": 1000}, "real_length": 10, "unit": "m"})
        assert r.status_code == 200, r.text
    r = await api.put(f"/api/photos/{lev.foto_id}/masks", headers=owner.auth,
                      json={"layers": [{"kind": "intervention", "label": "Fachada", "points": mascara}]})
    assert r.status_code == 200, r.text
    pecas = [{"name": "Testeira", "type": "Revestimento", "width": 6, "height": 1.5, "x": 1, "y": 3,
              "color": VERMELHO, "material": "ACM", "finish": "Fosco", "label": "ARTELUX"}] if objetos else []
    r = await api.put(f"/api/projects/{lev.projeto_id}/study", headers=owner.auth, json={
        "revision": 0, "photos": [{"photo_id": lev.foto_id, "objects": pecas, "surfaces": []}],
        "active_photo_id": lev.foto_id})
    assert r.status_code == 200, r.text


async def renderiza(api, owner, lev):
    r = await api.post(f"/api/photos/{lev.foto_id}/proposals", headers=owner.auth)
    assert r.status_code == 201, r.text
    return r.json()


async def imagem(api, owner, url):
    r = await api.get(url, headers=owner.auth)
    assert r.status_code == 200, r.text
    return Image.open(io.BytesIO(r.content)).convert("RGB")


async def test_render_usa_a_previa_em_escala_e_confere(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    prop = await renderiza(api, owner, levantamento)
    gerada = prop["generated_image"]
    assert gerada["scale_check"]["modo"] == "escala"
    assert gerada["scale_check"]["ok"] is True
    assert gerada["scale_check"]["pixels_por_metro"] == 100
    assert gerada["guide_url"]
    previa = await imagem(api, owner, gerada["guide_url"])
    assert previa.getpixel((310, 560)) == (0xD0, 0x10, 0x10)


async def test_tamanho_da_peca_e_o_da_calibracao(api, owner, levantamento):
    """Dentro da máscara mas fora do contorno da peça, a foto não muda."""
    await prepara(api, owner, levantamento)
    prop = await renderiza(api, owner, levantamento)
    original = await imagem(api, owner, f"/api/photos/{levantamento.foto_id}/original")
    final = await imagem(api, owner, prop["generated_image"]["url"])
    x0, y0, x1, y1 = RET
    assert final.getpixel((x0 + 5, y0 + 5)) == (0xD0, 0x10, 0x10)
    for ponto in ((x0 - 3, y0 + 50), (x1 + 3, y0 + 50), (x0 + 50, y0 - 3), (x0 + 50, y1 + 3), (1200, 300)):
        assert final.getpixel(ponto) == original.getpixel(ponto), ponto
    area = (x1 - x0 + 1) * (y1 - y0 + 1)
    assert 0 < prop["generated_image"]["changed_pixels"] <= area


async def test_pedido_a_ia_leva_medidas_e_texto_exatos(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    prop = await renderiza(api, owner, levantamento)
    texto = prop["prompt"]["text"]
    assert "6.00 m × 1.50 m" in texto
    assert 'texto exato "ARTELUX"' in texto
    assert prop["prompt"]["previa"]


async def test_peca_fora_da_mascara_e_avisada(api, owner, levantamento):
    await prepara(api, owner, levantamento, mascara=MASCARA_FORA)
    prop = await renderiza(api, owner, levantamento)
    conferencia = prop["generated_image"]["scale_check"]
    assert conferencia["ok"] is False
    assert "fora da área liberada" in conferencia["pecas"][0]["aviso"]


async def test_sem_calibracao_cai_no_modo_livre(api, owner, levantamento):
    await prepara(api, owner, levantamento, calibrar=False)
    prop = await renderiza(api, owner, levantamento)
    assert prop["generated_image"]["scale_check"]["modo"] == "livre"
    assert prop["generated_image"]["guide_url"] is None


async def test_sem_pecas_no_estudo_cai_no_modo_livre(api, owner, levantamento):
    await prepara(api, owner, levantamento, objetos=False)
    prop = await renderiza(api, owner, levantamento)
    assert prop["generated_image"]["scale_check"]["modo"] == "livre"


async def test_previa_exige_login(api, owner, levantamento):
    await prepara(api, owner, levantamento)
    prop = await renderiza(api, owner, levantamento)
    assert (await api.get(prop["generated_image"]["guide_url"])).status_code == 401
