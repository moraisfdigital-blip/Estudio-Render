"""Links enviados por e-mail: redefinir senha e confirmar e-mail novo.

O código que vai no link nunca é gravado — só o SHA-256 dele. Quem lê o banco
(um backup vazado, por exemplo) não consegue montar um link válido.

Cada registro vale uma vez (`used_at`) e até `expires_at`; o índice TTL apaga
os vencidos sozinho.
"""

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Any, Literal

from app.core.clock import utcnow

COLLECTION = "password_resets"

Tipo = Literal["password", "email"]


def novo_codigo() -> str:
    return secrets.token_urlsafe(32)


def hash_do_codigo(codigo: str) -> str:
    return hashlib.sha256(codigo.encode("utf-8")).hexdigest()


def new_link_doc(
    *,
    tipo: Tipo,
    codigo: str,
    user_id: str,
    tenant_id: str,
    email: str,
    minutos: int,
    new_email: str | None = None,
) -> dict[str, Any]:
    agora = utcnow()
    return {
        "kind": tipo,
        "token_hash": hash_do_codigo(codigo),
        "user_id": user_id,
        "tenant_id": tenant_id,
        "email": email,
        "new_email": new_email,
        "created_at": agora,
        "expires_at": agora + timedelta(minutes=minutos),
        "used_at": None,
    }


def expira_em(doc: dict[str, Any]) -> datetime:
    return doc["expires_at"]
