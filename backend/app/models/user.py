"""Documento `users`. Toda leitura/escrita é escopada por `tenant_id` (ver app/core/tenancy.py)."""

from datetime import datetime, timezone
from typing import Any, Literal

COLLECTION = "users"

Role = Literal["owner", "editor"]
ROLES: tuple[str, ...] = ("owner", "editor")


def normalize_email(email: str) -> str:
    """E-mail é identidade de login: comparado sempre em minúsculas e sem espaços."""
    return email.strip().lower()


def new_user_doc(
    *,
    tenant_id: str,
    email: str,
    password_hash: str,
    name: str,
    role: str,
) -> dict[str, Any]:
    return {
        "tenant_id": tenant_id,
        "email": normalize_email(email),
        "password_hash": password_hash,
        "name": name.strip(),
        "role": role,
        "created_at": datetime.now(timezone.utc),
    }
