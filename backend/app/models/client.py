"""Documento `clients` — cadastro comercial. Sempre lido/escrito via TenantScope."""

from typing import Any

from app.core.clock import utcnow

COLLECTION = "clients"


def name_key(name: str) -> str:
    """Chave de unicidade do nome dentro do tenant (case/espaço-insensível).

    Serve só para impedir dois clientes iguais no mesmo select; o nome exibido
    continua sendo o que o usuário digitou.
    """
    return " ".join(name.split()).casefold()


def new_client_doc(
    *,
    name: str,
    document: str | None,
    contact_name: str | None,
    email: str | None,
    phone: str | None,
    notes: str | None,
) -> dict[str, Any]:
    now = utcnow()
    clean = " ".join(name.split())
    return {
        "name": clean,
        "name_key": name_key(clean),
        "document": document,
        "contact_name": contact_name,
        "email": email,
        "phone": phone,
        "notes": notes,
        "created_at": now,
        "updated_at": now,
    }
