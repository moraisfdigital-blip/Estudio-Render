"""Documento `calibrations` — a escala de uma foto do levantamento.

Uma calibração por foto: dois pontos que o **usuário** marcou sobre o original e
a medida real que o **usuário** informou entre eles. Com isso o servidor calcula
`pixels_per_unit` — o fator que as fases seguintes usam para converter pixel em
medida.

## A regra inegociável

`real_length` só entra por informação humana. Nenhuma IA, heurística, EXIF ou
"chute razoável" preenche esse campo: sem ele não há calibração, e sem
calibração as medidas da Fase 6 nascem como `estimated` e são rotuladas na tela.
Por isso o documento grava `source` fixo em `user_measured` — não existe caminho
neste código que escreva outro valor, e a API recusa o campo se o cliente tentar
mandá-lo.

## Por que o cálculo mora aqui

`pixels_per_unit` é derivado, nunca recebido: o cliente manda pontos e medida, o
servidor faz a conta. Deixar a fórmula no modelo (e não no router) mantém um só
lugar responsável pela matemática da escala quando a Fase 6 for consumi-la.
"""

import math
from typing import Any

from app.core.clock import utcnow

COLLECTION = "calibrations"

# A fonte da medida é sempre humana. Constante nomeada para a Fase 6 comparar
# contra isto em vez de repetir a string.
SOURCE_USER_MEASURED = "user_measured"

# Unidades aceitas na tela. Metro e centímetro cobrem levantamento de fachada e
# de peça; o valor normalizado (`pixels_per_meter`) evita que cada fase seguinte
# refaça a conversão por conta própria.
UNITS_IN_METERS: dict[str, float] = {"m": 1.0, "cm": 0.01}

# Dois cliques colados dariam um fator de escala sem sentido (um pixel de erro
# de clique viraria dezenas de por cento de erro na medida final). Abaixo disso
# a API recusa e pede que o usuário marque pontos mais afastados.
MIN_PIXEL_DISTANCE = 8.0

# Casas decimais do fator. Muito além disso é ruído de ponto flutuante — a
# precisão real é a do clique do usuário, não a do float.
_ROUND = 6


def pixel_distance(point_a: tuple[float, float], point_b: tuple[float, float]) -> float:
    """Distância euclidiana entre os dois pontos, em pixels do original."""
    return math.hypot(point_b[0] - point_a[0], point_b[1] - point_a[1])


def scale_factors(distance: float, real_length: float, unit: str) -> tuple[float, float]:
    """`(pixels_per_unit, pixels_per_meter)` a partir da medida informada.

    `pixels_per_unit` fica na unidade que o usuário escolheu — é o número que a
    tela mostra de volta para ele conferir. `pixels_per_meter` é o mesmo fator
    normalizado, para as fases seguintes não dependerem de qual unidade foi
    digitada naquele dia.
    """
    pixels_per_unit = distance / real_length
    pixels_per_meter = distance / (real_length * UNITS_IN_METERS[unit])
    return round(pixels_per_unit, _ROUND), round(pixels_per_meter, _ROUND)


def calibration_fields(
    *,
    point_a: tuple[float, float],
    point_b: tuple[float, float],
    real_length: float,
    unit: str,
    image_width: int,
    image_height: int,
    measured_by: str,
) -> dict[str, Any]:
    """Campos calculados + informados, prontos para o `$set` do upsert.

    Só entra aqui o que o usuário informou e o que o servidor derivou disso.
    Não há parâmetro nem ramo que aceite uma medida vinda de outro lugar.
    """
    distance = pixel_distance(point_a, point_b)
    pixels_per_unit, pixels_per_meter = scale_factors(distance, real_length, unit)
    return {
        "point_a": {"x": point_a[0], "y": point_a[1]},
        "point_b": {"x": point_b[0], "y": point_b[1]},
        "real_length": real_length,
        "unit": unit,
        "pixel_distance": round(distance, _ROUND),
        "pixels_per_unit": pixels_per_unit,
        "pixels_per_meter": pixels_per_meter,
        # Medida humana, sempre. Ver o cabeçalho deste módulo.
        "source": SOURCE_USER_MEASURED,
        # Dimensões do original no momento da calibração: servem para a Fase 6
        # conferir que os pontos continuam dentro da mesma foto.
        "image_width": image_width,
        "image_height": image_height,
        "measured_by": measured_by,
        "updated_at": utcnow(),
    }
