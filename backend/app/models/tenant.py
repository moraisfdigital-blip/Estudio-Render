"""Documento `tenants`. Hoje existe um só (ARTELUX, via seed), mas o modelo já é multi-tenant."""

from datetime import datetime, timezone
from typing import Any

COLLECTION = "tenants"


def new_tenant_doc(*, slug: str, name: str) -> dict[str, Any]:
    return {
        "slug": slug,
        "name": name,
        "created_at": datetime.now(timezone.utc),
    }
