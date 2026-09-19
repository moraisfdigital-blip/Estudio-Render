"""Contratos do catálogo (material, acabamento, marca) e da spec do elemento.

Todo schema de entrada usa `extra="forbid"`. Além de pegar erro de digitação,
é o que impede o cliente de mandar campo calculado pelo servidor — `color_hex`
resolvido, nome do material dentro do elemento, `applied_at` — e ver isso
gravado como se tivesse vindo do catálogo.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import LongText, Name

# Hex de 6 dígitos com `#`. O padrão vale na entrada para o banco nunca guardar
# uma cor que a tela não consiga desenhar.
ColorHex = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]

# Id de documento chega como string de 24 hex; o router ainda resolve contra o
# catálogo do tenant, então isto é só o primeiro filtro.
ObjectIdStr = Annotated[str, Field(pattern=r"^[0-9a-fA-F]{24}$")]


class MaterialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: LongText = None


class MaterialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: LongText = None


class MaterialOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    description: str | None = None
    finish_count: int = 0
    created_at: datetime
    updated_at: datetime


class FinishCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material_id: ObjectIdStr
    name: Name
    color_name: Name
    color_hex: ColorHex
    description: LongText = None


class FinishUpdate(BaseModel):
    """PATCH parcial. `material_id` fica de fora: mover acabamento de material
    trocaria a cor de todo elemento que já usa esse acabamento."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    color_name: Name | None = None
    color_hex: ColorHex | None = None
    description: LongText = None


class FinishOut(BaseModel):
    id: str
    tenant_id: str
    material_id: str
    material_name: str
    name: str
    color_name: str
    color_hex: str
    description: str | None = None
    created_at: datetime
    updated_at: datetime


class BrandCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: LongText = None


class BrandUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: LongText = None


class BrandLogoOut(BaseModel):
    url: str
    filename: str
    content_type: str
    size_bytes: int
    checksum_sha256: str
    uploaded_at: datetime


class BrandOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    description: str | None = None
    logo: BrandLogoOut | None = None
    created_at: datetime
    updated_at: datetime


class SpecIn(BaseModel):
    """Aplica material, acabamento e marca no elemento.

    PATCH parcial: campo ausente fica como está, campo explicitamente nulo
    limpa aquele vínculo. É por isso que o router olha `model_fields_set` em
    vez do valor — `null` aqui é uma instrução, não "não informado".
    """

    model_config = ConfigDict(extra="forbid")

    material_id: ObjectIdStr | None = None
    finish_id: ObjectIdStr | None = None
    brand_id: ObjectIdStr | None = None


class SpecMaterialOut(BaseModel):
    id: str
    name: str


class SpecFinishOut(BaseModel):
    id: str
    name: str
    color_name: str
    color_hex: str


class SpecBrandOut(BaseModel):
    id: str
    name: str
    logo_url: str | None = None


class SpecOut(BaseModel):
    """Spec já resolvida contra o catálogo.

    A tela recebe nome e cor prontos e nunca precisa de um mapa de hex próprio.
    Os objetos vêm resolvidos na leitura, então renomear um material aparece em
    todo elemento na próxima resposta.
    """

    material: SpecMaterialOut | None = None
    finish: SpecFinishOut | None = None
    brand: SpecBrandOut | None = None
    applied_at: datetime | None = None
    is_empty: bool = True
