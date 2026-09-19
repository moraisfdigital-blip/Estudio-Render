"""Contratos de `clients`."""

from pydantic import BaseModel, ConfigDict

from app.schemas.common import LongText, Name, Phone, ShortText


class ClientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    document: ShortText = None
    contact_name: ShortText = None
    email: ShortText = None
    phone: Phone = None
    notes: LongText = None


class ClientUpdate(BaseModel):
    """PATCH parcial: só os campos realmente enviados mudam (ver `model_fields_set`)."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    document: ShortText = None
    contact_name: ShortText = None
    email: ShortText = None
    phone: Phone = None
    notes: LongText = None


class ClientOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    document: str | None = None
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    notes: str | None = None
