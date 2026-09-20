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


# Fase 8 — Architecture Lock. Nasce LIGADO: preservar a arquitetura do cliente
# é o comportamento padrão do produto, e desligar é uma decisão explícita do
# owner. Projeto criado antes desta fase não tem o campo, e `architecture_lock_of`
# trata essa ausência como ligado — migração para trás sem script.
ARCHITECTURE_LOCK_DEFAULT = True


def architecture_lock_of(doc: dict[str, Any]) -> bool:
    """Estado do lock, com o default seguro para documento antigo."""
    return bool(doc.get("architecture_lock", ARCHITECTURE_LOCK_DEFAULT))


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
        "architecture_lock": ARCHITECTURE_LOCK_DEFAULT,
        "created_at": now,
        "updated_at": now,
    }
