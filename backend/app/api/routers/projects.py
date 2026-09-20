"""Rotas de `projects` — o dashboard da Fase 3.

Um projeto só existe amarrado a um cliente e a um local **do mesmo tenant**:
o vínculo é revalidado a cada create/patch, nunca aceito só porque veio no corpo.
"""

from collections.abc import Iterable
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, HTTPException, status
from pymongo import ReturnDocument

from typing import Annotated

from fastapi import Depends

from app.api.deps import CurrentScope, require_role
from app.api.routers.clients import get_client_doc
from app.api.routers.locations import get_location_doc
from app.core.clock import as_utc, utcnow
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import client as client_model
from app.models import location as location_model
from app.models import project as project_model
from app.schemas.mask import ArchitectureLockIn
from app.schemas.project import ProjectCreate, ProjectOut, ProjectUpdate, RelatedOut

router = APIRouter()

NOT_FOUND = "Projeto não encontrado neste workspace."
CLIENT_NOT_FOUND = "Cliente informado não existe neste workspace."
LOCATION_NOT_FOUND = "Local informado não existe neste workspace."


async def _names_by_id(
    scope: TenantScope, collection: str, ids: Iterable[str]
) -> dict[str, RelatedOut]:
    """Resolve nomes de cliente/local em uma query só (em vez de uma por projeto)."""
    oids = []
    for value in {i for i in ids if i}:
        try:
            oids.append(ObjectId(value))
        except (InvalidId, TypeError):
            # Id gravado fora do formato: o projeto lista sem o nome, não quebra.
            continue
    if not oids:
        return {}

    cursor = get_db()[collection].find(scope.filter(_id={"$in": oids}), {"name": 1})
    return {str(doc["_id"]): RelatedOut(id=str(doc["_id"]), name=doc["name"]) async for doc in cursor}


def _to_out(
    doc: dict[str, Any],
    clients: dict[str, RelatedOut],
    locations: dict[str, RelatedOut],
) -> ProjectOut:
    status_value = doc.get("status", project_model.DEFAULT_STATUS)
    return ProjectOut(
        id=str(doc["_id"]),
        tenant_id=doc["tenant_id"],
        name=doc["name"],
        status=status_value,
        status_label=project_model.STATUS_LABELS.get(status_value, status_value),
        description=doc.get("description"),
        architecture_lock=project_model.architecture_lock_of(doc),
        client=clients.get(doc.get("client_id") or ""),
        location=locations.get(doc.get("location_id") or ""),
        created_at=as_utc(doc["created_at"]),
        updated_at=as_utc(doc["updated_at"]),
    )


async def _serialize(scope: TenantScope, docs: list[dict[str, Any]]) -> list[ProjectOut]:
    clients = await _names_by_id(
        scope, client_model.COLLECTION, (d.get("client_id") for d in docs)
    )
    locations = await _names_by_id(
        scope, location_model.COLLECTION, (d.get("location_id") for d in docs)
    )
    return [_to_out(doc, clients, locations) for doc in docs]


async def _ensure_links(scope: TenantScope, *, client_id: str | None, location_id: str | None):
    if client_id is not None and await get_client_doc(scope, client_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=CLIENT_NOT_FOUND
        )
    if location_id is not None and await get_location_doc(scope, location_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=LOCATION_NOT_FOUND
        )


@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(scope: CurrentScope) -> list[ProjectOut]:
    """Dashboard: projetos do tenant autenticado, mais recentes primeiro."""
    cursor = get_db()[project_model.COLLECTION].find(scope.filter()).sort("created_at", -1)
    return await _serialize(scope, [doc async for doc in cursor])


@router.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(payload: ProjectCreate, scope: CurrentScope) -> ProjectOut:
    await _ensure_links(scope, client_id=payload.client_id, location_id=payload.location_id)

    doc = scope.stamp(
        project_model.new_project_doc(
            name=payload.name,
            client_id=payload.client_id,
            location_id=payload.location_id,
            status=payload.status,
            description=payload.description,
        )
    )
    result = await get_db()[project_model.COLLECTION].insert_one(doc)
    created = {**doc, "_id": result.inserted_id}
    return (await _serialize(scope, [created]))[0]


async def get_project_doc(scope: TenantScope, project_id: str) -> dict[str, Any]:
    """Documento do projeto, escopado por tenant. Reusado pelas máscaras (Fase 8)."""
    oid = parse_object_id(project_id, detail=NOT_FOUND)
    doc = await get_db()[project_model.COLLECTION].find_one(scope.filter(_id=oid))
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return doc


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, scope: CurrentScope) -> ProjectOut:
    doc = await get_project_doc(scope, project_id)
    return (await _serialize(scope, [doc]))[0]


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str, payload: ProjectUpdate, scope: CurrentScope
) -> ProjectOut:
    oid = parse_object_id(project_id, detail=NOT_FOUND)

    changes = payload.model_dump(exclude_unset=True)
    for field, label in (("name", "Nome"), ("client_id", "Cliente"), ("location_id", "Local")):
        if field in changes and changes[field] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{label} do projeto é obrigatório e não pode ser removido.",
            )
    if "status" in changes and changes["status"] is None:
        del changes["status"]

    await _ensure_links(
        scope, client_id=changes.get("client_id"), location_id=changes.get("location_id")
    )

    if not changes:
        return await get_project(project_id, scope)

    if "name" in changes:
        changes["name"] = " ".join(changes["name"].split())
    changes["updated_at"] = utcnow()

    doc = await get_db()[project_model.COLLECTION].find_one_and_update(
        scope.filter(_id=oid),
        {"$set": changes},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return (await _serialize(scope, [doc]))[0]


# Só o owner administra o lock; ler o estado continua aberto ao tenant inteiro.
OwnerUser = Annotated[dict[str, Any], Depends(require_role("owner"))]


@router.patch("/projects/{project_id}/architecture-lock", response_model=ProjectOut)
async def set_architecture_lock(
    project_id: str, payload: ArchitectureLockIn, scope: CurrentScope, user: OwnerUser
) -> ProjectOut:
    """Liga ou desliga o Architecture Lock do projeto.

    Nasce ligado, e **desligar é decisão de owner**: com o lock off a geração
    recusa (Fase 9), então isto não é preferência de tela — é abrir mão da
    garantia de que a proposta preserva a arquitetura original.
    """
    projeto = await get_project_doc(scope, project_id)

    doc = await get_db()[project_model.COLLECTION].find_one_and_update(
        scope.filter(_id=projeto["_id"]),
        {"$set": {"architecture_lock": payload.enabled, "updated_at": utcnow()}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return (await _serialize(scope, [doc]))[0]
