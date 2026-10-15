"""Prévia em escala: o estudo da aba 02 desenhado sobre a foto, em metros reais.

Por que existe: IA de imagem não respeita medida. A medida tem de vir da
calibração (pixels por metro), não do modelo. Então o servidor desenha as
peças do estudo — testeira, pilares, totem, áreas de ACM — exatamente onde e
do tamanho que a calibração manda, e:

1. a IA recebe esse desenho como referência e só dá o acabamento realista;
2. do que a IA devolver, só entra o que cai **dentro do contorno das peças**
   (`shapes_mask`). Placa desenhada maior é cortada; o tamanho final é sempre
   o da prévia;
3. `check()` confere, peça a peça, se a cor do resultado ficou perto da
   prevista e se a peça estava dentro da área liberada em Máscaras.

A geometria segue a do painel (`drawPhotoOverlay` no front): origem no ponto
mais à esquerda e mais baixo da calibração; `x` cresce para a direita e `y`
(altura da base) para cima, ambos em metros.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat

# Diferença máxima (distância RGB) entre a cor média da peça no resultado e a
# cor prevista. Folgada de propósito: luz, sombra e brilho do ACM mudam a cor
# percebida; o que se quer pegar é "pintou de outra cor" ou "não pintou".
TOLERANCIA_COR = 110.0
# Abaixo disto a peça está, na prática, fora da área liberada em Máscaras.
COBERTURA_MINIMA = 0.6


@dataclass
class Peca:
    nome: str
    tipo: str  # "peca" (retângulo do estudo) ou "superficie" (contorno marcado)
    cor: str
    texto: str
    largura_m: float | None
    altura_m: float | None
    material: str
    acabamento: str
    poligono: list[tuple[float, float]]


@dataclass
class Previa:
    imagem_png: bytes
    contorno: Image.Image  # L: 255 onde há peça ou superfície
    pecas: list[Peca] = field(default_factory=list)
    pixels_por_metro: float = 0.0

    def descricao(self) -> list[str]:
        """Uma linha por peça, para o pedido à IA e para a tela."""
        linhas = []
        for peca in self.pecas:
            partes = [peca.nome]
            if peca.largura_m and peca.altura_m:
                partes.append(f"{peca.largura_m:.2f} m × {peca.altura_m:.2f} m")
            if peca.material:
                partes.append(" ".join(x for x in (peca.material, peca.acabamento) if x))
            partes.append(f"cor {peca.cor}")
            if peca.texto:
                partes.append(f'texto exato "{peca.texto}"')
            linhas.append(" · ".join(partes))
        return linhas


def _rgb(cor: str) -> tuple[int, int, int]:
    cor = cor.lstrip("#")
    return int(cor[0:2], 16), int(cor[2:4], 16), int(cor[4:6], 16)


def _origem(calibration: dict[str, Any]) -> tuple[float, float]:
    a, b = calibration["point_a"], calibration["point_b"]
    return min(a["x"], b["x"]), max(a["y"], b["y"])


def _pecas_da_foto(study: dict[str, Any] | None, photo_id: str) -> tuple[list[dict], list[dict]]:
    """Peças e superfícies que o painel mostra sobre esta foto."""
    if not study:
        return [], []
    for entrada in study.get("photos") or []:
        if entrada.get("photo_id") == photo_id:
            objetos = entrada.get("objects") or study.get("objects") or []
            return objetos, entrada.get("surfaces") or []
    return study.get("objects") or [], []


def _fonte_que_cabe(desenho: ImageDraw.ImageDraw, texto: str, largura: float, altura: float):
    tamanho = max(8, int(altura * 0.55))
    while tamanho > 8:
        fonte = ImageFont.load_default(size=tamanho)
        if desenho.textlength(texto, font=fonte) <= largura * 0.9:
            return fonte
        tamanho = int(tamanho * 0.9)
    return ImageFont.load_default(size=8)


def build(
    *,
    original_bytes: bytes,
    study: dict[str, Any] | None,
    photo_id: str,
    calibration: dict[str, Any] | None,
) -> Previa | None:
    """Desenha a prévia. `None` quando não há como garantir escala.

    Sem calibração não há conversão metro → pixel; sem peça nem superfície no
    estudo não há o que desenhar. Nos dois casos a rota segue no modo livre e
    avisa a tela.
    """
    if not calibration or not calibration.get("pixels_per_meter"):
        return None
    objetos, superficies = _pecas_da_foto(study, photo_id)
    if not objetos and not superficies:
        return None

    ppm = float(calibration["pixels_per_meter"])
    ox, oy = _origem(calibration)
    foto = Image.open(io.BytesIO(original_bytes)).convert("RGB")
    camada = Image.new("RGBA", foto.size, (0, 0, 0, 0))
    desenho = ImageDraw.Draw(camada)
    contorno = Image.new("L", foto.size, 0)
    marca = ImageDraw.Draw(contorno)
    pecas: list[Peca] = []

    # Superfícies primeiro (revestimento), peças por cima — como no painel.
    for sup in superficies:
        pontos = [(p["x"], p["y"]) for p in sup.get("points") or []]
        if len(pontos) < 3:
            continue
        alfa = round(255 * max(0.0, min(100.0, float(sup.get("opacity", 74)))) / 100)
        desenho.polygon(pontos, fill=(*_rgb(sup["color"]), alfa))
        marca.polygon(pontos, fill=255)
        pecas.append(Peca(
            nome=sup.get("name") or "Área de revestimento", tipo="superficie", cor=sup["color"],
            texto="", largura_m=None, altura_m=None, material=sup.get("material", ""),
            acabamento=sup.get("finish", ""), poligono=pontos,
        ))

    for obj in objetos:
        largura, altura = float(obj["width"]), float(obj["height"])
        x0 = ox + float(obj["x"]) * ppm
        y1 = oy - float(obj["y"]) * ppm
        x1, y0 = x0 + largura * ppm, y1 - altura * ppm
        if not (math.isfinite(x0) and math.isfinite(y0)) or x1 <= 0 or y1 <= 0 or x0 >= foto.width or y0 >= foto.height:
            continue  # peça fora da foto: não há onde desenhar
        caixa = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        desenho.rectangle([x0, y0, x1, y1], fill=(*_rgb(obj["color"]), 255))
        marca.rectangle([x0, y0, x1, y1], fill=255)
        texto = (obj.get("label") or "").strip()
        if texto:
            fonte = _fonte_que_cabe(desenho, texto, x1 - x0, y1 - y0)
            claro = sum(_rgb(obj["color"])) > 600
            desenho.text(((x0 + x1) / 2, (y0 + y1) / 2), texto, font=fonte, anchor="mm",
                         fill=(48, 52, 56, 255) if claro else (255, 255, 255, 255))
        pecas.append(Peca(
            nome=obj.get("name") or "Peça", tipo="peca", cor=obj["color"], texto=texto,
            largura_m=largura, altura_m=altura, material=obj.get("material", ""),
            acabamento=obj.get("finish", ""), poligono=caixa,
        ))

    if not pecas:
        return None
    composta = Image.alpha_composite(foto.convert("RGBA"), camada).convert("RGB")
    saida = io.BytesIO()
    composta.save(saida, format="PNG")
    return Previa(imagem_png=saida.getvalue(), contorno=contorno, pecas=pecas, pixels_por_metro=ppm)


def check(previa: Previa, resultado_png: bytes, permitido: Image.Image) -> dict[str, Any]:
    """Confere peça a peça o resultado já composto (só dentro da área liberada)."""
    imagem = Image.open(io.BytesIO(resultado_png)).convert("RGB")
    itens = []
    for peca in previa.pecas:
        forma = Image.new("L", imagem.size, 0)
        ImageDraw.Draw(forma).polygon(peca.poligono, fill=255)
        area = forma.histogram()[255]
        dentro = ImageChops.multiply(forma, permitido)
        liberada = dentro.histogram()[255]
        cobertura = liberada / area if area else 0.0
        delta = None
        if liberada:
            media = ImageStat.Stat(imagem, mask=dentro).mean
            delta = math.dist(media, _rgb(peca.cor))
        ok = cobertura >= COBERTURA_MINIMA and delta is not None and delta <= TOLERANCIA_COR
        if cobertura < COBERTURA_MINIMA:
            aviso = "fora da área liberada em Máscaras — não foi renderizada"
        elif not ok:
            aviso = "cor diferente da prevista — confira"
        else:
            aviso = ""
        itens.append({"nome": peca.nome, "cobertura": round(cobertura, 3),
                      "diferenca_cor": round(delta, 1) if delta is not None else None,
                      "ok": ok, "aviso": aviso})
    return {
        "modo": "escala",
        "ok": all(item["ok"] for item in itens),
        "pixels_por_metro": round(previa.pixels_por_metro, 3),
        "pecas": itens,
    }


SEM_PREVIA = {
    "modo": "livre",
    "ok": None,
    "pixels_por_metro": None,
    "pecas": [],
}
