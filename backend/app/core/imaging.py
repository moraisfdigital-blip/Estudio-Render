"""O Architecture Lock em pixel.

A Fase 8 guardou **onde** a geração pode mexer. Este módulo é o que transforma
isso em garantia: qualquer imagem que volte de um provedor passa por
`compose_locked` antes de virar arquivo, e o que sai é o **original** com os
pixels do candidato aplicados **somente** na área permitida.

## Por que compor em vez de confiar

Um provedor de IA recebe a foto e a máscara e devolve uma imagem inteira. Nada
impede que ele mexa fora da máscara — por bug, por atualização de modelo, ou
porque o prompt vazou. Se a gente simplesmente salvasse o retorno dele, o
Architecture Lock seria uma promessa escrita no README.

Compondo, ele vira estrutura: o provedor pode devolver o que quiser, porque só
os pixels sob a máscara de intervenção sobrevivem. A fachada do cliente não
depende do comportamento de um serviço externo.

## Área permitida = intervenção menos proteção

Proteção vence o empate, como a Fase 8 estabeleceu. A conta é feita em máscara
de 8 bits (`L`): 255 onde pode escrever, 0 onde não pode.

## PNG na saída

O derivado é gravado em PNG, sem perda. Assim "o pixel fora da máscara é
idêntico ao original" é uma afirmação verificável — com JPEG, a recompressão
mudaria pixels que ninguém pediu para mudar e a garantia viraria aproximação.
"""

import io
from typing import Any

from PIL import Image, ImageChops, ImageDraw

from app.models import mask as mask_model

# Tudo é convertido para RGB antes de compor. Sem isso, um provedor que devolve
# RGBA ou escala de cinza produziria um `paste` com canais incompatíveis.
_MODE = "RGB"

_OPACO = 255
_TRANSPARENTE = 0


def _pontos(layer: dict[str, Any]) -> list[tuple[float, float]]:
    return [(ponto["x"], ponto["y"]) for ponto in layer["points"]]


def allowed_mask(
    layers: list[dict[str, Any]], size: tuple[int, int]
) -> Image.Image:
    """Máscara 8 bits da área onde a geração pode escrever.

    Branco (255) = intervenção que sobrou depois de descontar a proteção.
    Preto (0) = tudo o mais, inclusive o que nenhum polígono cobre.
    """
    mascara = Image.new("L", size, _TRANSPARENTE)
    desenho = ImageDraw.Draw(mascara)

    for layer in layers:
        if layer.get("kind") == mask_model.INTERVENTION:
            desenho.polygon(_pontos(layer), fill=_OPACO)

    # Proteção depois, apagando: é assim que ela vence o empate com a
    # intervenção em vez de depender da ordem em que o usuário desenhou.
    for layer in layers:
        if layer.get("kind") == mask_model.PROTECT:
            desenho.polygon(_pontos(layer), fill=_TRANSPARENTE)

    return mascara


def mask_png_bytes(layers: list[dict[str, Any]], size: tuple[int, int]) -> bytes:
    """A máscara como PNG — o formato que provedores de inpainting recebem.

    O mock não precisa disto, mas o contrato do adapter entrega a máscara já
    pronta para que trocar `IMAGE_GEN_PROVIDER` não exija reescrever a rota.
    """
    buffer = io.BytesIO()
    allowed_mask(layers, size).save(buffer, format="PNG")
    return buffer.getvalue()


def compose_locked(
    *,
    original_bytes: bytes,
    candidate_bytes: bytes,
    layers: list[dict[str, Any]],
) -> tuple[bytes, int]:
    """Aplica o candidato sobre o original **só** na área permitida.

    Devolve `(png, pixels_alterados)`. A contagem sai daqui porque é o número
    que prova a regra: ele nunca pode ser maior que a área da máscara, e é
    gravado junto da imagem para quem auditar a proposta depois.

    Candidato de tamanho diferente é redimensionado para o do original — um
    provedor que devolve 1024×1024 para uma foto 1600×1200 não pode deslocar a
    composição e acabar escrevendo fora do lugar.
    """
    original = Image.open(io.BytesIO(original_bytes)).convert(_MODE)
    candidato = Image.open(io.BytesIO(candidate_bytes)).convert(_MODE)
    if candidato.size != original.size:
        candidato = candidato.resize(original.size)

    permitido = allowed_mask(layers, original.size)

    resultado = original.copy()
    resultado.paste(candidato, (0, 0), permitido)

    buffer = io.BytesIO()
    resultado.save(buffer, format="PNG")

    return buffer.getvalue(), changed_pixels(original, resultado)


def changed_pixels(antes: Image.Image, depois: Image.Image) -> int:
    """Quantos pixels diferem entre duas imagens do mesmo tamanho.

    Usado para registrar o alcance real da geração na proposta. É a métrica que
    permite responder "o que exatamente mudou nesta foto?" sem abrir as duas
    imagens lado a lado.
    """
    diferenca = ImageChops.difference(antes.convert(_MODE), depois.convert(_MODE))
    # `point` marca em 255 todo pixel que diferiu em qualquer canal; o
    # histograma conta essas marcas dentro do Pillow, sem trazer dois milhões
    # de pixels para um laço em Python.
    marcados = diferenca.convert("L").point(lambda valor: 255 if valor else 0)
    return marcados.histogram()[255]


def size_of(image_bytes: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(image_bytes)).size
