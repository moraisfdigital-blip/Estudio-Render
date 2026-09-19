"""Documento `areas` — recorte do local dentro de um projeto (fachada, totem, interior)."""

from typing import Any

from app.core.clock import utcnow

COLLECTION = "areas"


def name_key(name: str) -> str:
    """Chave de unicidade do nome **dentro do projeto** (case/espaço-insensível)."""
    return " ".join(name.split()).casefold()


def new_area_doc(*, project_id: str, name: str, description: str | None) -> dict[str, Any]:
    now = utcnow()
    clean = " ".join(name.split())
    return {
        "project_id": project_id,
        "name": clean,
        "name_key": name_key(clean),
        "description": description,
        "created_at": now,
        "updated_at": now,
    }
