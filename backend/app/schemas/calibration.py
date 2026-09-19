"""Contratos de `calibrations`.

O corpo de entrada tem exatamente quatro campos: os dois pontos, a medida real e
a unidade. `pixels_per_unit` **não** está entre eles — é derivado no servidor. O
`extra="forbid"` faz disso uma regra da API: um cliente que tente enviar o fator
pronto (ou um `source`) recebe 422 em vez de ter o valor aceito calado.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.calibration import UNITS_IN_METERS


def _check_unit(value: str) -> str:
    """A lista de unidades vive no modelo; o schema só valida, sem duplicá-la."""
    if value not in UNITS_IN_METERS:
        raise ValueError(f"Unidade inválida. Use uma de: {', '.join(UNITS_IN_METERS)}.")
    return value


# `allow_inf_nan=False`: sem isso, `inf` passaria pelo `gt=0` e viraria uma
# escala infinita gravada no banco.
Coordinate = Annotated[float, Field(ge=0, allow_inf_nan=False)]
RealLength = Annotated[float, Field(gt=0, lt=1_000_000, allow_inf_nan=False)]


class Point(BaseModel):
    """Coordenada em pixels da foto **original** (origem no canto superior esquerdo)."""

    model_config = ConfigDict(extra="forbid")

    x: Coordinate
    y: Coordinate

    def as_tuple(self) -> tuple[float, float]:
        return self.x, self.y


class CalibrationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    point_a: Point
    point_b: Point
    # Medida informada pelo usuário. É o único caminho de entrada de medida no
    # sistema — nada preenche este campo automaticamente.
    real_length: RealLength
    unit: str

    _validate_unit = field_validator("unit")(_check_unit)


class CalibrationOut(BaseModel):
    """Estado da escala da foto.

    `calibrated=False` é resposta normal (200), não erro: a tela usa isso para o
    estado "não calibrado" em vez de tratar 404 como caso de sucesso.
    """

    photo_id: str
    tenant_id: str
    calibrated: bool

    point_a: Point | None = None
    point_b: Point | None = None
    real_length: float | None = None
    unit: str | None = None
    # Distância euclidiana entre os pontos, em pixels do original.
    pixel_distance: float | None = None
    # Fator na unidade escolhida pelo usuário.
    pixels_per_unit: float | None = None
    # Mesmo fator normalizado em metros, para as fases seguintes.
    pixels_per_meter: float | None = None
    # Sempre `user_measured` quando calibrado: medida é informação humana.
    source: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    updated_at: datetime | None = None
