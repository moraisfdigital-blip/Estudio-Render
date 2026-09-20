"""Rotas de `locations`. Toda query nasce escopada pelo TenantScope."""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.api.pagination import PageDep
from app.api.deps import CurrentScope
from app.api.routers.clients import get_client_doc
from app.core.clock import utcnow
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import location as location_model
from app.schemas.location import LocationCreate, LocationOut, LocationUpdate

router = APIRouter()

NOT_FOUND = "Local não encontrado neste workspace."
DUPLICATE = "Já existe um local com este nome neste workspace."
CLIENT_NOT_FOUND = "Cliente informado não existe neste workspace."


def to_out(doc: dict[str, Any]) -> LocationOut:
    return LocationOut(
        id=str(doc["_id"]),
        tenant_id=doc["tenant_id"],
        name=doc["name"],
        client_id=doc.get("client_id"),
        address=doc.get("address"),
        city=doc.get("city"),
        state=doc.get("state"),
        notes=doc.get("notes"),
    )


async def get_location_doc(scope: TenantScope, location_id: str) -> dict[str, Any] | None:
    oid = parse_object_id(location_id, detail=NOT_FOUND)
    return await get_db()[location_model.COLLECTION].find_one(scope.filter(_id=oid))


async def ensure_client_in_tenant(scope: TenantScope, client_id: str | None) -> None:
    """Vínculo opcional, mas se vier tem de ser um cliente deste workspace."""
    if client_id is None:
        return
    if await get_client_doc(scope, client_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=CLIENT_NOT_FOUND
        )


@router.get("/locations", response_model=list[LocationOut])
async def list_locations(scope: CurrentScope, page: PageDep) -> list[LocationOut]:
    cursor = get_db()[location_model.COLLECTION].find(scope.filter()).sort("name", 1).skip(page.offset).limit(page.limit)
    return [to_out(doc) async for doc in cursor]


@router.post("/locations", response_model=LocationOut, status_code=status.HTTP_201_CREATED)
async def create_location(payload: LocationCreate, scope: CurrentScope) -> LocationOut:
    await ensure_client_in_tenant(scope, payload.client_id)

    doc = scope.stamp(
        location_model.new_location_doc(
            name=payload.name,
            client_id=payload.client_id,
            address=payload.address,
            city=payload.city,
            state=payload.state,
            notes=payload.notes,
        )
    )
    try:
        result = await get_db()[location_model.COLLECTION].insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE) from None
    return to_out({**doc, "_id": result.inserted_id})


@router.patch("/locations/{location_id}", response_model=LocationOut)
async def update_location(
    location_id: str, payload: LocationUpdate, scope: CurrentScope
) -> LocationOut:
    oid = parse_object_id(location_id, detail=NOT_FOUND)

    changes = payload.model_dump(exclude_unset=True)
    if "client_id" in changes:
        await ensure_client_in_tenant(scope, changes["client_id"])
    if "name" in changes:
        if changes["name"] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Nome do local não pode ficar vazio.",
            )
        changes["name"] = " ".join(changes["name"].split())
        changes["name_key"] = location_model.name_key(changes["name"])

    if not changes:
        doc = await get_db()[location_model.COLLECTION].find_one(scope.filter(_id=oid))
        if doc is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
        return to_out(doc)

    changes["updated_at"] = utcnow()
    try:
        doc = await get_db()[location_model.COLLECTION].find_one_and_update(
            scope.filter(_id=oid),
            {"$set": changes},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE) from None

    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return to_out(doc)
