"""Rotas de `clients`. Nenhuma query sai daqui sem o filtro do TenantScope."""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.api.pagination import PageDep
from app.api.deps import CurrentScope
from app.core.clock import utcnow
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import client as client_model
from app.schemas.client import ClientCreate, ClientOut, ClientUpdate

router = APIRouter()

NOT_FOUND = "Cliente não encontrado neste workspace."
DUPLICATE = "Já existe um cliente com este nome neste workspace."


def to_out(doc: dict[str, Any]) -> ClientOut:
    return ClientOut(
        id=str(doc["_id"]),
        tenant_id=doc["tenant_id"],
        name=doc["name"],
        document=doc.get("document"),
        contact_name=doc.get("contact_name"),
        email=doc.get("email"),
        phone=doc.get("phone"),
        notes=doc.get("notes"),
    )


async def get_client_doc(scope: TenantScope, client_id: str) -> dict[str, Any] | None:
    """Busca escopada reusada pelas rotas de projeto ao validar o vínculo."""
    oid = parse_object_id(client_id, detail=NOT_FOUND)
    return await get_db()[client_model.COLLECTION].find_one(scope.filter(_id=oid))


@router.get("/clients", response_model=list[ClientOut])
async def list_clients(scope: CurrentScope, page: PageDep) -> list[ClientOut]:
    cursor = get_db()[client_model.COLLECTION].find(scope.filter()).sort("name", 1).skip(page.offset).limit(page.limit)
    return [to_out(doc) async for doc in cursor]


@router.post("/clients", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
async def create_client(payload: ClientCreate, scope: CurrentScope) -> ClientOut:
    doc = scope.stamp(
        client_model.new_client_doc(
            name=payload.name,
            document=payload.document,
            contact_name=payload.contact_name,
            email=payload.email,
            phone=payload.phone,
            notes=payload.notes,
        )
    )
    try:
        result = await get_db()[client_model.COLLECTION].insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE) from None
    return to_out({**doc, "_id": result.inserted_id})


@router.patch("/clients/{client_id}", response_model=ClientOut)
async def update_client(client_id: str, payload: ClientUpdate, scope: CurrentScope) -> ClientOut:
    oid = parse_object_id(client_id, detail=NOT_FOUND)

    # Só o que o cliente mandou explicitamente entra no $set — PATCH sem um campo
    # não apaga o valor guardado.
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        if changes["name"] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Nome do cliente não pode ficar vazio.",
            )
        changes["name"] = " ".join(changes["name"].split())
        changes["name_key"] = client_model.name_key(changes["name"])

    if not changes:
        doc = await get_db()[client_model.COLLECTION].find_one(scope.filter(_id=oid))
        if doc is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
        return to_out(doc)

    changes["updated_at"] = utcnow()
    try:
        doc = await get_db()[client_model.COLLECTION].find_one_and_update(
            scope.filter(_id=oid),
            {"$set": changes},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE) from None

    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return to_out(doc)
