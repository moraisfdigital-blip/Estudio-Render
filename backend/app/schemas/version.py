"""Contratos das versões.

O cliente escolhe **qual geração** promover e como chamá-la. Tudo o mais —
posição, se está aprovada, quantas vagas sobraram — é do servidor. `extra` é
proibido, então mandar `position` ou `approved` no corpo é 422, não um campo
gravado por fora da regra.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.models.version import MAX_VERSIONS
from app.schemas.common import LongText, Name
from app.schemas.proposal import GeneratedImageOut

ObjectIdStr = Annotated[str, Field(pattern=r"^[0-9a-fA-F]{24}$")]


class VersionCreate(BaseModel):
    """Promove uma proposta concluída a versão."""

    model_config = ConfigDict(extra="forbid")

    proposal_id: ObjectIdStr
    # Sem nome, o servidor usa "Versão N". Um card em branco na comparação é
    # pior do que um rótulo genérico.
    label: Name | None = None
    notes: LongText = None


class VersionOut(BaseModel):
    id: str
    tenant_id: str
    photo_id: str
    project_id: str
    proposal_id: str
    position: int
    label: str
    notes: str | None = None
    # A imagem não é copiada: a versão elege uma geração que já existe.
    generated_image: GeneratedImageOut | None = None
    approved: bool = False
    created_at: datetime


class VersionListOut(BaseModel):
    """Lista + o estado do limite, para a tela não recontar por conta própria."""

    photo_id: str
    versions: list[VersionOut] = Field(default_factory=list)
    max_versions: int = MAX_VERSIONS
    slots_left: int = MAX_VERSIONS
    limit_reached: bool = False
    # Id da versão aprovada desta foto, ou nulo enquanto ninguém escolheu.
    approved_version_id: str | None = None


class VersionCompareOut(BaseModel):
    """Versões pedidas na comparação, na ordem em que foram solicitadas."""

    photo_id: str
    original_url: str
    versions: list[VersionOut] = Field(default_factory=list)
