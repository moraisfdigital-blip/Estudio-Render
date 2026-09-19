"""Contratos de entrada/saída da autenticação. Toda rota valida com Pydantic."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.security import MAX_PASSWORD_BYTES

PASSWORD_MIN_LENGTH = 8


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)
    name: str = Field(min_length=1, max_length=120)

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"Senha longa demais (máximo {MAX_PASSWORD_BYTES} bytes).")
        return value

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Nome não pode ser vazio.")
        return value


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1)


class UserOut(BaseModel):
    id: str
    tenant_id: str
    email: EmailStr
    name: str
    role: Literal["owner", "editor"]


class TenantOut(BaseModel):
    id: str
    slug: str
    name: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserOut
