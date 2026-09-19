"""Escopo de tenant — o padrão que toda fase seguinte reusa.

Regra do projeto: nenhuma query toca o banco sem `tenant_id`. Em vez de repetir
`{"tenant_id": ...}` em cada rota (e um dia esquecer), o handler recebe um
`TenantScope` já preenchido pela dependency de auth e monta o filtro por aqui.
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class TenantScope:
    """Tenant do usuário autenticado. Fonte única do `tenant_id` nas queries."""

    tenant_id: str

    def filter(self, **extra: Any) -> dict[str, Any]:
        """Filtro de leitura/atualização já escopado.

        >>> scope.filter(_id=oid)  # {"tenant_id": "...", "_id": oid}
        """
        if "tenant_id" in extra:
            raise ValueError("tenant_id é definido pelo escopo, não pelo chamador.")
        return {"tenant_id": self.tenant_id, **extra}

    def stamp(self, doc: dict[str, Any]) -> dict[str, Any]:
        """Carimba `tenant_id` num documento novo antes do insert."""
        return {**doc, "tenant_id": self.tenant_id}
