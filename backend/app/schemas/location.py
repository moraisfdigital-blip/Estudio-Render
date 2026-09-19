"""Contratos de `locations`."""

from pydantic import BaseModel, ConfigDict

from app.schemas.common import Address, LongText, Name, ShortText, StateText


class LocationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    # Vínculo opcional: o local pode ser cadastrado antes de saber de quem é.
    # O vínculo que o fluxo exige é o do projeto.
    client_id: ShortText = None
    address: Address = None
    city: ShortText = None
    state: StateText = None
    notes: LongText = None


class LocationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    client_id: ShortText = None
    address: Address = None
    city: ShortText = None
    state: StateText = None
    notes: LongText = None


class LocationOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    client_id: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    notes: str | None = None
