"""Contratos das máscaras de intervenção e proteção.

Entrada com `extra="forbid"`: o cliente manda o tipo e os vértices, e nada
mais. Tudo que o servidor deriva — `id` da camada, área do polígono, dimensões
da imagem, se a geração está liberada — sai calculado na resposta e não pode
ser injetado pelo corpo do PUT.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.models.mask import KINDS, MAX_LAYERS, MAX_POINTS, MIN_POINTS
from app.schemas.common import Name

MaskKind = Annotated[str, Field(pattern=f"^({'|'.join(KINDS)})$")]


class MaskPoint(BaseModel):
    """Vértice em pixel do original. Negativo não existe em coordenada de imagem."""

    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0)
    y: float = Field(ge=0)

    def as_tuple(self) -> tuple[float, float]:
        return (self.x, self.y)


class MaskLayerIn(BaseModel):
    """Um polígono desenhado na tela."""

    model_config = ConfigDict(extra="forbid")

    kind: MaskKind
    # O nome ajuda quem revisa o levantamento depois ("placa do totem",
    # "janela do vizinho"). Opcional: o servidor preenche com o rótulo do tipo.
    label: Name | None = None
    points: list[MaskPoint] = Field(min_length=MIN_POINTS, max_length=MAX_POINTS)


class MasksIn(BaseModel):
    """PUT substitui o conjunto inteiro de camadas da foto.

    Lista vazia é válida e significa "apaguei tudo" — é como a tela desfaz um
    desenho inteiro sem precisar de uma rota de DELETE.
    """

    model_config = ConfigDict(extra="forbid")

    layers: list[MaskLayerIn] = Field(default_factory=list, max_length=MAX_LAYERS)


class MaskLayerOut(BaseModel):
    id: str
    kind: str
    kind_label: str
    label: str
    points: list[MaskPoint]
    # Área do polígono em pixels quadrados, calculada no servidor. A tela usa
    # para ordenar e para mostrar o tamanho relativo do recorte.
    area_px: float


class MasksOut(BaseModel):
    """Estado das máscaras de uma foto, com o motivo do bloqueio já resolvido."""

    photo_id: str
    tenant_id: str
    # Falso quando a foto ainda não tem documento de máscara: é o estado
    # inicial normal, não erro. Mesma escolha da calibração na Fase 5.
    masked: bool = False
    layers: list[MaskLayerOut] = Field(default_factory=list)
    intervention_count: int = 0
    protect_count: int = 0
    image_width: int | None = None
    image_height: int | None = None
    # Estado do lock do projeto, repetido aqui para a tela de desenho não
    # precisar de uma segunda chamada só para saber se pode gerar.
    architecture_lock: bool = True
    generation_ready: bool = False
    # Texto pronto do porquê a geração está bloqueada. É o mesmo que a Fase 9
    # devolverá no 422 — a tela não escreve motivo por conta própria.
    blocked_reason: str | None = None
    updated_at: datetime | None = None


class ArchitectureLockIn(BaseModel):
    """Liga ou desliga o lock do projeto inteiro."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool
