"""Documento `locations` — o sítio do levantamento (posto, loja, fachada)."""

from typing import Any

from app.core.clock import utcnow

COLLECTION = "locations"


def name_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def new_location_doc(
    *,
    name: str,
    client_id: str | None,
    address: str | None,
    city: str | None,
    state: str | None,
    notes: str | None,
) -> dict[str, Any]:
    now = utcnow()
    clean = " ".join(name.split())
    return {
        "name": clean,
        "name_key": name_key(clean),
        # Opcional: um local pode existir antes de saber de qual cliente é,
        # e o vínculo que importa para o fluxo é o do projeto.
        "client_id": client_id,
        "address": address,
        "city": city,
        "state": state,
        "notes": notes,
        "created_at": now,
        "updated_at": now,
    }
