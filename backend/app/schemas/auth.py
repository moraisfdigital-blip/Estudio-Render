"""Contratos de entrada/saída da autenticação. Toda rota valida com Pydantic."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.security import MAX_PASSWORD_BYTES

# 12 é o mínimo do ASVS v5.0 §2.1. Subir isto DEPOIS de a equipe estar
# cadastrada não adianta: a política não revalida senha que já existe, e quem
# entrou com 8 caracteres fica com 8 para sempre. Por isso ele muda antes do
# primeiro cadastro, não depois.
PASSWORD_MIN_LENGTH = 12

# Senhas comuns que sobrevivem ao mínimo de 12 caracteres. A lista é curta e
# local de propósito: consultar a API do Have I Been Pwned seria mais completo,
# mas adiciona uma chamada de rede no caminho do cadastro e uma dependência
# externa que este projeto ainda não tem. Isto cobre o caso barato — teclado
# batido, sequência, repetição — que é o que de fato aparece.
SENHAS_OBVIAS = frozenset(
    {
        "123456789012",
        "1234567890123",
        "12345678901234",
        "senhasenhasenha",
        "senha123456789",
        "qwertyuiopasdf",
        "asdfghjklzxcvb",
        "abcdefghijkl",
        "administrador",
        "artelux123456",
        "password12345",
        "passwordpassword",
    }
)


def _senha_obvia(valor: str) -> bool:
    """Reconhece senha que só passa no comprimento.

    Três casos: está na lista, é um caractere repetido, ou é uma sequência de
    dígitos. Nenhum deles é força bruta — é chute na primeira tentativa.
    """
    limpa = valor.strip().lower()
    if limpa in SENHAS_OBVIAS:
        return True
    if len(set(limpa)) <= 2:
        return True
    if limpa.isdigit() and (limpa in "01234567890123456789" or limpa in "09876543210987654321"):
        return True
    return False


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
        if _senha_obvia(value):
            raise ValueError(
                "Esta senha é previsível demais (sequência, repetição ou senha "
                "conhecida). Use algo que só você saberia."
            )
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
