"""Documento `projects` — container do fluxo (levantamento → visual → apresentação)."""

from typing import Any

from app.core.clock import utcnow

COLLECTION = "projects"

# Espelha o fluxo do blueprint. É só o estágio declarado pelo usuário nesta fase;
# as fases seguintes é que passam a derivar trabalho de cada etapa.
STATUSES: tuple[str, ...] = ("levantamento", "projeto_visual", "apresentacao", "concluido")
DEFAULT_STATUS = "levantamento"

STATUS_LABELS = {
    "levantamento": "Levantamento",
    "projeto_visual": "Projeto visual",
    "apresentacao": "Apresentação",
    "concluido": "Concluído",
}


def new_project_doc(
    *,
    name: str,
    client_id: str,
    location_id: str,
    status: str,
    description: str | None,
) -> dict[str, Any]:
    now = utcnow()
    return {
        "name": " ".join(name.split()),
        "client_id": client_id,
        "location_id": location_id,
        "status": status,
        "description": description,
        "created_at": now,
        "updated_at": now,
    }
