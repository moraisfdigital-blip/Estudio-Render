"""Contratos de `projects`. O dashboard lê `client` e `location` já resolvidos."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.project import DEFAULT_STATUS, STATUSES
from app.schemas.common import LongText, Name


def _check_status(value: str | None) -> str | None:
    """A lista de status vive no modelo; o schema só a valida, sem duplicá-la."""
    if value is not None and value not in STATUSES:
        raise ValueError(f"Status inválido. Use um de: {', '.join(STATUSES)}.")
    return value


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    client_id: str = Field(min_length=1)
    location_id: str = Field(min_length=1)
    status: str = DEFAULT_STATUS
    description: LongText = None

    _validate_status = field_validator("status")(_check_status)


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    client_id: str | None = Field(default=None, min_length=1)
    location_id: str | None = Field(default=None, min_length=1)
    status: str | None = None
    description: LongText = None

    _validate_status = field_validator("status")(_check_status)


class RelatedOut(BaseModel):
    """Resumo do cliente/local embutido no projeto — evita N+1 no dashboard."""

    id: str
    name: str


class ProjectOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    status: str
    status_label: str
    description: str | None = None
    # Podem vir nulos se o cliente/local referenciado sumir do banco;
    # o dashboard trata esse caso em vez de quebrar a listagem.
    client: RelatedOut | None = None
    location: RelatedOut | None = None
    created_at: datetime
    updated_at: datetime
