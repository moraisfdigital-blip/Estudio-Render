"""Contratos de `elements`.

Dois cuidados que valem a leitura:

1. **Medida sempre declara a origem.** `MeasurementIn` exige `value` e `source`
   juntos, sem default; não existe forma de mandar um número sem dizer se ele
   foi medido em campo ou estimado.
2. **`extra="forbid"` em tudo.** Um cliente que tente enviar `conference`,
   `measured_by` ou qualquer campo derivado recebe 422, em vez de ter o valor
   aceito calado.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.calibration import UNITS_IN_METERS
from app.models.element import CONFERENCE_STATUSES, DIMENSIONS, KINDS, SOURCES
from app.schemas.catalog import SpecOut
from app.schemas.common import LongText, Name

# As listas fechadas vivem no modelo; aqui viram enum de validação, sem cópia.
Kind = Literal[KINDS]  # type: ignore[valid-type]
Source = Literal[SOURCES]  # type: ignore[valid-type]
ConferenceStatus = Literal[CONFERENCE_STATUSES]  # type: ignore[valid-type]
MeasurementUnit = Literal[tuple(UNITS_IN_METERS)]  # type: ignore[valid-type]

# `allow_inf_nan=False`: sem isso `inf` passaria pelo `gt=0` e viraria um
# retângulo (ou uma medida) impossível gravado no banco.
Coordinate = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Side = Annotated[float, Field(gt=0, lt=1_000_000, allow_inf_nan=False)]
MeasurementValue = Annotated[float, Field(gt=0, lt=1_000_000, allow_inf_nan=False)]


class Box(BaseModel):
    """Retângulo em pixels da foto **original** (origem no canto superior esquerdo)."""

    model_config = ConfigDict(extra="forbid")

    x: Coordinate
    y: Coordinate
    width: Side
    height: Side


class ElementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    kind: Kind = "outro"
    box: Box
    notes: LongText = None


class ElementUpdate(BaseModel):
    """PATCH parcial: só o que foi enviado muda (ver `model_fields_set`)."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    kind: Kind | None = None
    box: Box | None = None
    notes: LongText = None


class MeasurementIn(BaseModel):
    """Um valor e a origem dele. Os dois campos, sempre.

    `source` é declaração do usuário na tela: ele diz se aquele número saiu da
    trena ou de uma estimativa. Sem default de propósito — um valor sem origem
    declarada é exatamente a medida sem procedência que o blueprint proíbe.
    """

    model_config = ConfigDict(extra="forbid")

    value: MeasurementValue
    source: Source


class MeasurementsIn(BaseModel):
    """Medidas do elemento. Dimensão omitida fica sem medida — não vira zero."""

    model_config = ConfigDict(extra="forbid")

    unit: MeasurementUnit
    width: MeasurementIn | None = None
    height: MeasurementIn | None = None
    depth: MeasurementIn | None = None

    @model_validator(mode="after")
    def at_least_one(self) -> "MeasurementsIn":
        if not any(getattr(self, dimension) for dimension in DIMENSIONS):
            raise ValueError("Informe ao menos uma medida (largura, altura ou profundidade).")
        return self


class ConferenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ConferenceStatus


# ---- saída ----------------------------------------------------------------


class MeasurementOut(BaseModel):
    value: float
    # `user_measured` ou `estimated`. A tela é obrigada a rotular o segundo.
    source: str
    source_label: str


class MeasurementsOut(BaseModel):
    unit: str | None = None
    width: MeasurementOut | None = None
    height: MeasurementOut | None = None
    depth: MeasurementOut | None = None
    measured_at: datetime | None = None
    # Verdadeiro quando alguma dimensão salva é `estimated`: a lista mostra o
    # rótulo sem precisar abrir elemento por elemento.
    has_estimate: bool = False


class ConferenceOut(BaseModel):
    status: str
    at: datetime | None = None


class ScaleEstimateOut(BaseModel):
    """Sugestão derivada do retângulo + calibração da foto.

    Não é o que está salvo: é o que o retângulo *daria* pela escala. Volta em
    campo separado, sempre com `source="estimated"`, e só vira medida do
    elemento se o usuário mandar salvar.
    """

    unit: str
    source: str
    width: float
    height: float


class ElementOut(BaseModel):
    id: str
    tenant_id: str
    photo_id: str
    area_id: str
    project_id: str
    name: str
    kind: str
    kind_label: str
    box: Box
    notes: str | None = None
    measurements: MeasurementsOut
    conference: ConferenceOut
    # Fase 7: material/acabamento/marca já resolvidos contra o catálogo, com a
    # cor real vinda do cadastro — nunca de hex chumbado no frontend.
    spec: SpecOut = Field(default_factory=SpecOut)
    # Ausente quando a foto não tem calibração: sem escala não há de onde
    # estimar, e a tela diz isso em vez de mostrar um número inventado.
    scale_estimate: ScaleEstimateOut | None = None
    created_at: datetime
    updated_at: datetime
