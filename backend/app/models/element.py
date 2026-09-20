"""Documento `elements` — a peça a intervir, marcada sobre a foto original.

Um elemento é uma placa, faixa, letra caixa, adesivo ou totem que o levantamento
identificou numa foto: onde está (retângulo em pixels do original), quanto mede
e se alguém já conferiu essas medidas.

## Medida tem procedência

Toda medida guarda `source`: `user_measured` (alguém foi lá e mediu) ou
`estimated` (número aproximado, assumido como aproximado). Não existe medida sem
essa marca, e nenhuma delas nasce sozinha no servidor — o valor sempre chega
digitado.

`estimate_from_scale` calcula, a partir do retângulo e da calibração da foto,
quanto o elemento *daria* de medida. Esse resultado **nunca** é gravado por
conta própria: volta na resposta como sugestão rotulada e só vira medida do
elemento se o usuário mandar salvar — e aí entra como `estimated`, porque
estimativa virando fato é exatamente o que o blueprint proíbe.

## Conferência acompanha os números

`conference` é sobre as medidas que estavam lá quando alguém conferiu. Mexeu nas
medidas, volta para `pendente`: senão o selo de conferido passaria a valer para
um número que ninguém olhou.
"""

from typing import Any

from app.core.clock import utcnow
from app.models import catalog

COLLECTION = "elements"

# Tipos de peça do blueprint. Lista fechada para a Fase 12 (quantitativo) poder
# agrupar por tipo sem depender de texto livre digitado diferente a cada vez.
KINDS: tuple[str, ...] = ("placa", "faixa", "letra_caixa", "adesivo", "totem", "outro")
DEFAULT_KIND = "outro"

KIND_LABELS = {
    "placa": "Placa",
    "faixa": "Faixa",
    "letra_caixa": "Letra caixa",
    "adesivo": "Adesivo",
    "totem": "Totem",
    "outro": "Outro",
}

# As duas únicas origens possíveis de uma medida.
SOURCE_USER_MEASURED = "user_measured"
SOURCE_ESTIMATED = "estimated"
SOURCES: tuple[str, ...] = (SOURCE_USER_MEASURED, SOURCE_ESTIMATED)

SOURCE_LABELS = {
    SOURCE_USER_MEASURED: "Medido em campo",
    SOURCE_ESTIMATED: "Estimativa",
}

# Dimensões que o levantamento registra. Profundidade quase sempre fica vazia
# (placa plana não tem), mas o campo existe para caixa e totem.
DIMENSIONS: tuple[str, ...] = ("width", "height", "depth")

CONFERENCE_PENDING = "pendente"
CONFERENCE_CONFIRMED = "conferido"
CONFERENCE_STATUSES: tuple[str, ...] = (CONFERENCE_PENDING, CONFERENCE_CONFIRMED)

# Retângulo com lado quase zero é clique torto, não peça. Abaixo disso a API
# recusa em vez de gravar uma posição que ninguém consegue ver na tela.
MIN_BOX_SIDE = 4.0

# Mesma precisão da calibração: além disso é ruído de float, não medida.
_ROUND = 6


def normalized_box(*, x: float, y: float, width: float, height: float) -> dict[str, float]:
    """Retângulo arredondado, pronto para gravar.

    Chega já validado pelo schema e pelo router (lados positivos, dentro da
    foto); aqui só caem as casas decimais que não significam nada.
    """
    return {
        "x": round(x, _ROUND),
        "y": round(y, _ROUND),
        "width": round(width, _ROUND),
        "height": round(height, _ROUND),
    }


def empty_measurements() -> dict[str, Any]:
    """Elemento recém-marcado: posição conhecida, medida nenhuma."""
    return {"unit": None, **{dimension: None for dimension in DIMENSIONS}}


def new_conference(status: str = CONFERENCE_PENDING, *, by: str | None = None) -> dict[str, Any]:
    """Estado de conferência. `pendente` é o estado inicial de todo elemento."""
    confirmed = status == CONFERENCE_CONFIRMED
    return {
        "status": status,
        "by": by if confirmed else None,
        "at": utcnow() if confirmed else None,
    }


def new_element_doc(
    *,
    photo_id: str,
    area_id: str,
    project_id: str,
    name: str,
    kind: str,
    box: dict[str, float],
    notes: str | None,
    created_by: str,
) -> dict[str, Any]:
    now = utcnow()
    return {
        "photo_id": photo_id,
        # Desnormalizado como em `photos`: a Fase 12 lista elemento por projeto
        # sem subir a cadeia foto → área → projeto.
        "area_id": area_id,
        "project_id": project_id,
        "name": " ".join(name.split()),
        "kind": kind,
        "box": box,
        "notes": notes,
        # Medida entra pelo PUT próprio, nunca na criação: o elemento existe
        # marcado na foto antes de alguém ter ido medir.
        "measurements": empty_measurements(),
        "conference": new_conference(),
        # Fase 7: material/acabamento/marca entram pelo PATCH de spec. Decidir
        # o que a peça vai ser é passo separado de marcá-la na foto.
        "spec": catalog.empty_spec(),
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        # Soft-delete, como nas fotos: levantamento é histórico de campo.
        "deleted_at": None,
    }


def measurement_fields(
    *,
    unit: str,
    values: dict[str, tuple[float, str]],
    measured_by: str,
) -> dict[str, Any]:
    """Bloco `measurements` a partir do que o usuário informou.

    `values` mapeia dimensão → `(valor, source)`. Dimensão ausente fica nula:
    salvar só a largura é normal (faixa), e gravar zero no resto seria inventar
    uma medida que ninguém tomou.
    """
    fields: dict[str, Any] = {"unit": unit, "measured_by": measured_by, "measured_at": utcnow()}
    for dimension in DIMENSIONS:
        entry = values.get(dimension)
        if entry is None:
            fields[dimension] = None
            continue
        value, source = entry
        # Quem diz de onde vem o número é quem digitou: nada aqui deriva origem.
        fields[dimension] = {"value": round(value, _ROUND), "source": source}
    return fields


def has_any_measurement(measurements: dict[str, Any] | None) -> bool:
    """Existe ao menos uma dimensão preenchida?"""
    if not measurements:
        return False
    return any(measurements.get(dimension) for dimension in DIMENSIONS)


def has_estimate(measurements: dict[str, Any] | None) -> bool:
    """Alguma dimensão salva é estimativa? A lista rotula sem abrir o elemento."""
    if not measurements:
        return False
    return any(
        (measurements.get(dimension) or {}).get("source") == SOURCE_ESTIMATED
        for dimension in DIMENSIONS
    )


def estimate_from_scale(
    *, box: dict[str, float], pixels_per_unit: float, unit: str
) -> dict[str, Any]:
    """Quanto o retângulo mediria pela escala da foto — **sempre** estimativa.

    É geometria sobre dois dados humanos (o retângulo desenhado e a calibração
    medida), mas continua sendo aproximação: a caixa segue o contorno aparente
    na foto, não a peça, e a peça pode não estar no mesmo plano da calibração.
    Por isso o `source` sai fixo em `estimated` e o resultado volta em campo
    separado do que está salvo — sugestão rotulada, nunca medida do elemento.
    """
    return {
        "unit": unit,
        "source": SOURCE_ESTIMATED,
        "width": round(box["width"] / pixels_per_unit, 2),
        "height": round(box["height"] / pixels_per_unit, 2),
    }
