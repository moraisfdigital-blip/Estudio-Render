"""Rotas de `areas` — o recorte do levantamento dentro de um projeto.

Área nenhuma é criada ou lida sem antes confirmar que o **projeto pai pertence
ao tenant do token**. O `project_id` que chega na URL é tratado como palpite do
cliente até essa checagem passar.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.api.deps import CurrentScope
from app.core.clock import as_utc
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import area as area_model
from app.models import photo as photo_model
from app.models import project as project_model
from app.schemas.area import AreaCreate, AreaOut

router = APIRouter()

NOT_FOUND = "Área não encontrada neste workspace."
PROJECT_NOT_FOUND = "Projeto não encontrado neste workspace."
DUPLICATE = "Já existe uma área com este nome neste projeto."


async def ensure_project(scope: TenantScope, project_id: str) -> dict[str, Any]:
    """Projeto do tenant ou 404. Porta de entrada de tudo que pende de projeto."""
    oid = parse_object_id(project_id, detail=PROJECT_NOT_FOUND)
    doc = await get_db()[project_model.COLLECTION].find_one(scope.filter(_id=oid))
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=PROJECT_NOT_FOUND)
    return doc


async def get_area_doc(scope: TenantScope, area_id: str) -> dict[str, Any]:
    """Área do tenant ou 404 — usada também pelas rotas de foto."""
    oid = parse_object_id(area_id, detail=NOT_FOUND)
    doc = await get_db()[area_model.COLLECTION].find_one(scope.filter(_id=oid))
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return doc


async def _photo_counts(scope: TenantScope, area_ids: list[str]) -> dict[str, int]:
    """Fotos ativas por área, numa agregação só (em vez de um count por área)."""
    if not area_ids:
        return {}
    pipeline = [
        {"$match": scope.filter(area_id={"$in": area_ids}, deleted_at=None)},
        {"$group": {"_id": "$area_id", "total": {"$sum": 1}}},
    ]
    cursor = get_db()[photo_model.COLLECTION].aggregate(pipeline)
    return {doc["_id"]: doc["total"] async for doc in cursor}


def _to_out(doc: dict[str, Any], photo_count: int) -> AreaOut:
    return AreaOut(
        id=str(doc["_id"]),
        tenant_id=doc["tenant_id"],
        project_id=doc["project_id"],
        name=doc["name"],
        description=doc.get("description"),
        photo_count=photo_count,
        created_at=as_utc(doc["created_at"]),
        updated_at=as_utc(doc["updated_at"]),
    )


@router.get("/projects/{project_id}/areas", response_model=list[AreaOut])
async def list_areas(project_id: str, scope: CurrentScope) -> list[AreaOut]:
    """Áreas do projeto, mais antigas primeiro — a ordem em que o levantamento andou."""
    await ensure_project(scope, project_id)

    cursor = (
        get_db()[area_model.COLLECTION]
        .find(scope.filter(project_id=project_id))
        .sort("created_at", 1)
    )
    docs = [doc async for doc in cursor]
    counts = await _photo_counts(scope, [str(doc["_id"]) for doc in docs])
    return [_to_out(doc, counts.get(str(doc["_id"]), 0)) for doc in docs]


@router.post(
    "/projects/{project_id}/areas", response_model=AreaOut, status_code=status.HTTP_201_CREATED
)
async def create_area(project_id: str, payload: AreaCreate, scope: CurrentScope) -> AreaOut:
    await ensure_project(scope, project_id)

    doc = scope.stamp(
        area_model.new_area_doc(
            project_id=project_id,
            name=payload.name,
            description=payload.description,
        )
    )
    try:
        result = await get_db()[area_model.COLLECTION].insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE) from None

    return _to_out({**doc, "_id": result.inserted_id}, 0)
