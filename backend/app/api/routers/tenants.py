"""Rotas de tenant. Nesta fase só a leitura do workspace atual (badge da UI)."""

from bson import ObjectId
from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentScope
from app.core.db import get_db
from app.models import tenant as tenant_model
from app.schemas.auth import TenantOut

router = APIRouter()


@router.get("/tenants/current", response_model=TenantOut)
async def current_tenant(scope: CurrentScope) -> TenantOut:
    """O tenant vem do token, nunca de parâmetro do cliente."""
    doc = await get_db()[tenant_model.COLLECTION].find_one({"_id": ObjectId(scope.tenant_id)})
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workspace não encontrado.",
        )
    return TenantOut(id=str(doc["_id"]), slug=doc["slug"], name=doc["name"])
