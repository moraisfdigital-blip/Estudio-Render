"""Contratos de `areas`. A área só existe dentro de um projeto do tenant."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.common import LongText, Name


class AreaCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: LongText = None


class AreaOut(BaseModel):
    id: str
    tenant_id: str
    project_id: str
    name: str
    description: str | None = None
    # Contagem de fotos ativas: o grid mostra o número sem buscar todas as fotos
    # de todas as áreas de uma vez.
    photo_count: int = 0
    created_at: datetime
    updated_at: datetime
