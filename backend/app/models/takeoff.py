"""Documento `quantity_takeoffs` — o quantitativo e as linhas de orçamento.

Um por projeto. As linhas nascem dos **elementos conferidos**: peça, material,
acabamento e a quantidade derivada das medidas que alguém registrou.

## A regra que este arquivo carrega

**Quantidade estimada continua estimada.** A área sai de largura × altura, e a
procedência da linha é a pior das duas: se qualquer dimensão usada foi
`estimated`, a quantidade inteira é `estimated`. Uma medida de campo
multiplicada por uma estimativa não vira medida de campo.

**Sem medida suficiente, não há quantidade.** Só largura, ou nenhuma dimensão,
resulta em linha sem quantidade — não em um número plausível. Quem souber o
valor informa pelo PATCH, e aí a procedência passa a ser `user_informed`.

**Preço nunca é inventado.** O catálogo da Fase 7 não guarda preço, e este
módulo não tem tabela, média nem "valor de referência". Linha sem preço é linha
sem preço; o total só existe quando alguém digitou o valor.

## Regerar não apaga trabalho

`POST` recalcula as linhas derivadas a partir do estado atual do levantamento,
mas **preserva preço, quantidade informada e observações** de cada elemento que
continua no quantitativo. Perder os preços digitados a cada regeração tornaria
o botão inutilizável na prática.
"""

import uuid
from typing import Any

from app.core.clock import utcnow
from app.models.calibration import UNITS_IN_METERS

COLLECTION = "quantity_takeoffs"

ORIGIN_ELEMENT = "element"
ORIGIN_MANUAL = "manual"

# Procedência da quantidade. As duas primeiras herdam da medida do elemento; a
# terceira é de quem digitou direto na linha.
SOURCE_MEASURED = "user_measured"
SOURCE_ESTIMATED = "estimated"
SOURCE_INFORMED = "user_informed"

QUANTITY_SOURCES: tuple[str, ...] = (SOURCE_MEASURED, SOURCE_ESTIMATED, SOURCE_INFORMED)

SOURCE_LABELS = {
    SOURCE_MEASURED: "Medido em campo",
    SOURCE_ESTIMATED: "Estimativa",
    SOURCE_INFORMED: "Informado no orçamento",
}

UNIT_AREA = "m2"
UNIT_EACH = "un"
UNITS: tuple[str, ...] = (UNIT_AREA, UNIT_EACH, "m")

NO_MEASUREMENT = (
    "Sem largura e altura registradas não há como calcular a área. Informe a "
    "quantidade na linha, ou meça o elemento no levantamento."
)

# Casas decimais da área. Além disso é ruído: a precisão real é a da trena.
_ROUND = 3


def _dimensao(measurements: dict[str, Any], nome: str) -> tuple[float, str] | None:
    """`(valor_em_metros, procedência)` de uma dimensão, ou `None` se não existe."""
    entrada = (measurements or {}).get(nome)
    if not entrada or entrada.get("value") is None:
        return None
    unidade = (measurements or {}).get("unit")
    fator = UNITS_IN_METERS.get(unidade)
    if fator is None:
        return None
    return entrada["value"] * fator, entrada.get("source", SOURCE_ESTIMATED)


def area_from(measurements: dict[str, Any]) -> tuple[float | None, str | None]:
    """Área em m² e a procedência dela.

    A procedência é a **pior** das duas dimensões: estimativa contamina o
    resultado. Multiplicar uma medida de campo por uma estimativa não produz
    uma medida de campo — produz uma estimativa, e é assim que a linha sai
    rotulada para quem vai fechar preço.
    """
    largura = _dimensao(measurements, "width")
    altura = _dimensao(measurements, "height")
    if largura is None or altura is None:
        return None, None

    valor = round(largura[0] * altura[0], _ROUND)
    procedencia = (
        SOURCE_ESTIMATED
        if SOURCE_ESTIMATED in (largura[1], altura[1])
        else SOURCE_MEASURED
    )
    return valor, procedencia


def new_item(
    *,
    origin: str,
    description: str,
    element_id: str | None = None,
    photo_id: str | None = None,
    area_id: str | None = None,
    kind_label: str | None = None,
    material_name: str | None = None,
    finish_name: str | None = None,
    color_name: str | None = None,
    color_hex: str | None = None,
    quantity: float | None = None,
    unit: str = UNIT_AREA,
    quantity_source: str | None = None,
    quantity_note: str | None = None,
) -> dict[str, Any]:
    """Uma linha do quantitativo. Nasce **sem preço**, sempre."""
    return {
        "id": uuid.uuid4().hex,
        "origin": origin,
        "element_id": element_id,
        "photo_id": photo_id,
        "area_id": area_id,
        "description": description,
        "kind_label": kind_label,
        "material_name": material_name,
        "finish_name": finish_name,
        "color_name": color_name,
        "color_hex": color_hex,
        "quantity": quantity,
        "unit": unit,
        "quantity_source": quantity_source,
        # Por que não há quantidade, quando não há. A tela mostra isto em vez
        # de um campo vazio sem explicação.
        "quantity_note": quantity_note,
        # O catálogo não tem preço e este módulo não inventa nenhum.
        "unit_price": None,
        "notes": None,
    }


# Campos que sobrevivem a uma regeração: é o trabalho humano em cima da linha.
PRESERVED = ("unit_price", "notes")


def carry_over(novo: dict[str, Any], anterior: dict[str, Any]) -> dict[str, Any]:
    """Traz para a linha recalculada o que foi digitado à mão na anterior.

    O id também é preservado, senão a tela perderia a referência de cada linha
    a cada regeração — e um PATCH em andamento apontaria para algo que sumiu.
    """
    resultado = {**novo, "id": anterior["id"]}
    for campo in PRESERVED:
        if anterior.get(campo) is not None:
            resultado[campo] = anterior[campo]

    # Quantidade informada à mão vence a derivada: alguém olhou a peça e
    # digitou. Recalcular por cima apagaria essa decisão.
    if anterior.get("quantity_source") == SOURCE_INFORMED:
        resultado["quantity"] = anterior.get("quantity")
        resultado["unit"] = anterior.get("unit", resultado["unit"])
        resultado["quantity_source"] = SOURCE_INFORMED
        resultado["quantity_note"] = None
    return resultado


def line_total(item: dict[str, Any]) -> float | None:
    """Total da linha, ou `None` enquanto faltar quantidade ou preço.

    Devolver `None` (e não zero) é o que impede um orçamento incompleto de
    parecer fechado: zero somaria como se a linha não custasse nada.
    """
    quantidade = item.get("quantity")
    preco = item.get("unit_price")
    if quantidade is None or preco is None:
        return None
    return round(quantidade * preco, 2)


def takeoff_fields(*, items: list[dict[str, Any]], generated_by: str) -> dict[str, Any]:
    return {
        "items": items,
        "generated_by": generated_by,
        "generated_at": utcnow(),
        "updated_at": utcnow(),
    }
