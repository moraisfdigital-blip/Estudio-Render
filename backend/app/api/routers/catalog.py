"""Rotas do catálogo do tenant: materiais, acabamentos e marcas.

## Quem pode escrever

Ler o catálogo é de qualquer usuário do tenant — o editor precisa da lista para
especificar um elemento. Criar e editar é do **owner**: o `docs/PLANO.md` dá ao
owner "tudo do tenant, inclusive aprovar versão e gerenciar catálogo". Um
editor que tente cadastrar material leva 403, e é a primeira vez que o
`require_role` da Fase 2 é realmente usado.

## Cor sai daqui, não do frontend

`color_hex` é campo do acabamento e sempre viaja junto do `color_name`. A tela
desenha a amostra com o que recebe; não existe paleta chumbada no cliente.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.api.deps import CurrentScope, require_role
from app.core import media
from app.core.clock import as_utc, utcnow
from app.core.config import get_settings
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import catalog as catalog_model
from app.schemas.catalog import (
    BrandCreate,
    BrandLogoOut,
    BrandOut,
    BrandUpdate,
    FinishCreate,
    FinishOut,
    FinishUpdate,
    MaterialCreate,
    MaterialOut,
    MaterialUpdate,
)

router = APIRouter()

# Só o owner administra catálogo; ler continua aberto ao tenant inteiro.
OwnerUser = Annotated[dict[str, Any], Depends(require_role("owner"))]

MATERIAL_NOT_FOUND = "Material não encontrado neste workspace."
FINISH_NOT_FOUND = "Acabamento não encontrado neste workspace."
BRAND_NOT_FOUND = "Marca não encontrada neste workspace."
LOGO_MISSING = "Esta marca ainda não tem logo."
LOGO_GONE = "O arquivo do logo não está acessível no storage."

MATERIAL_DUPLICATE = "Já existe um material com este nome neste workspace."
FINISH_DUPLICATE = "Este material já tem um acabamento com este nome."
BRAND_DUPLICATE = "Já existe uma marca com este nome neste workspace."


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _renamed(changes: dict[str, Any], detail: str) -> dict[str, Any]:
    """Normaliza `name` num PATCH e recalcula a chave de unicidade."""
    if "name" in changes:
        if changes["name"] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)
        changes["name"] = catalog_model.clean_name(changes["name"])
        changes["name_key"] = catalog_model.name_key(changes["name"])
    return changes


# --------------------------------------------------------------------- materiais


def material_out(doc: dict[str, Any], finish_count: int = 0) -> MaterialOut:
    return MaterialOut(
        id=str(doc["_id"]),
        tenant_id=doc["tenant_id"],
        name=doc["name"],
        description=doc.get("description"),
        finish_count=finish_count,
        created_at=as_utc(doc["created_at"]),
        updated_at=as_utc(doc["updated_at"]),
    )


async def get_material_doc(scope: TenantScope, material_id: str) -> dict[str, Any]:
    oid = parse_object_id(material_id, detail=MATERIAL_NOT_FOUND)
    doc = await get_db()[catalog_model.MATERIALS].find_one(scope.filter(_id=oid))
    if doc is None:
        raise _not_found(MATERIAL_NOT_FOUND)
    return doc


async def _finish_counts(scope: TenantScope, material_ids: list[str]) -> dict[str, int]:
    """Acabamentos por material, numa agregação só — a tela mostra o número na lista."""
    if not material_ids:
        return {}
    pipeline = [
        {"$match": scope.filter(material_id={"$in": material_ids})},
        {"$group": {"_id": "$material_id", "total": {"$sum": 1}}},
    ]
    cursor = get_db()[catalog_model.FINISHES].aggregate(pipeline)
    return {doc["_id"]: doc["total"] async for doc in cursor}


@router.get("/materials", response_model=list[MaterialOut])
async def list_materials(scope: CurrentScope) -> list[MaterialOut]:
    cursor = get_db()[catalog_model.MATERIALS].find(scope.filter()).sort("name", 1)
    docs = [doc async for doc in cursor]
    counts = await _finish_counts(scope, [str(doc["_id"]) for doc in docs])
    return [material_out(doc, counts.get(str(doc["_id"]), 0)) for doc in docs]


@router.post("/materials", response_model=MaterialOut, status_code=status.HTTP_201_CREATED)
async def create_material(
    payload: MaterialCreate, scope: CurrentScope, user: OwnerUser
) -> MaterialOut:
    doc = scope.stamp(
        catalog_model.new_material_doc(
            name=payload.name,
            description=payload.description,
            created_by=str(user["_id"]),
        )
    )
    try:
        result = await get_db()[catalog_model.MATERIALS].insert_one(doc)
    except DuplicateKeyError:
        raise _conflict(MATERIAL_DUPLICATE) from None
    return material_out({**doc, "_id": result.inserted_id})


@router.patch("/materials/{material_id}", response_model=MaterialOut)
async def update_material(
    material_id: str, payload: MaterialUpdate, scope: CurrentScope, user: OwnerUser
) -> MaterialOut:
    oid = parse_object_id(material_id, detail=MATERIAL_NOT_FOUND)
    changes = _renamed(
        payload.model_dump(exclude_unset=True), "O nome do material não pode ficar vazio."
    )
    if not changes:
        return material_out(await get_material_doc(scope, material_id))

    changes["updated_at"] = utcnow()
    try:
        doc = await get_db()[catalog_model.MATERIALS].find_one_and_update(
            scope.filter(_id=oid), {"$set": changes}, return_document=ReturnDocument.AFTER
        )
    except DuplicateKeyError:
        raise _conflict(MATERIAL_DUPLICATE) from None
    if doc is None:
        raise _not_found(MATERIAL_NOT_FOUND)
    counts = await _finish_counts(scope, [material_id])
    return material_out(doc, counts.get(material_id, 0))


# ------------------------------------------------------------------ acabamentos


def finish_out(doc: dict[str, Any], material_name: str) -> FinishOut:
    return FinishOut(
        id=str(doc["_id"]),
        tenant_id=doc["tenant_id"],
        material_id=doc["material_id"],
        material_name=material_name,
        name=doc["name"],
        color_name=doc["color_name"],
        color_hex=doc["color_hex"],
        description=doc.get("description"),
        created_at=as_utc(doc["created_at"]),
        updated_at=as_utc(doc["updated_at"]),
    )


async def get_finish_doc(scope: TenantScope, finish_id: str) -> dict[str, Any]:
    oid = parse_object_id(finish_id, detail=FINISH_NOT_FOUND)
    doc = await get_db()[catalog_model.FINISHES].find_one(scope.filter(_id=oid))
    if doc is None:
        raise _not_found(FINISH_NOT_FOUND)
    return doc


async def _material_names(scope: TenantScope, material_ids: list[str]) -> dict[str, str]:
    """Nome do material por id, para o acabamento sair da API já identificado."""
    if not material_ids:
        return {}
    oids = [parse_object_id(mid, detail=MATERIAL_NOT_FOUND) for mid in set(material_ids)]
    cursor = get_db()[catalog_model.MATERIALS].find(scope.filter(_id={"$in": oids}), {"name": 1})
    return {str(doc["_id"]): doc["name"] async for doc in cursor}


@router.get("/finishes", response_model=list[FinishOut])
async def list_finishes(
    scope: CurrentScope,
    material_id: Annotated[
        str | None, Query(description="Filtra os acabamentos de um material.")
    ] = None,
) -> list[FinishOut]:
    """Acabamentos do tenant, ou só os de um material quando o filtro vem na query."""
    criteria: dict[str, Any] = {}
    if material_id is not None:
        # Material inexistente devolve lista vazia, não erro: o filtro é da tela.
        criteria["material_id"] = material_id
    cursor = get_db()[catalog_model.FINISHES].find(scope.filter(**criteria)).sort("name", 1)
    docs = [doc async for doc in cursor]
    names = await _material_names(scope, [doc["material_id"] for doc in docs])
    return [finish_out(doc, names.get(doc["material_id"], "Material removido")) for doc in docs]


@router.post("/finishes", response_model=FinishOut, status_code=status.HTTP_201_CREATED)
async def create_finish(payload: FinishCreate, scope: CurrentScope, user: OwnerUser) -> FinishOut:
    """Cria a variante de um material, com a cor real dela."""
    material = await get_material_doc(scope, payload.material_id)

    doc = scope.stamp(
        catalog_model.new_finish_doc(
            material_id=payload.material_id,
            name=payload.name,
            color_name=payload.color_name,
            color_hex=payload.color_hex,
            description=payload.description,
            created_by=str(user["_id"]),
        )
    )
    try:
        result = await get_db()[catalog_model.FINISHES].insert_one(doc)
    except DuplicateKeyError:
        raise _conflict(FINISH_DUPLICATE) from None
    return finish_out({**doc, "_id": result.inserted_id}, material["name"])


@router.patch("/finishes/{finish_id}", response_model=FinishOut)
async def update_finish(
    finish_id: str, payload: FinishUpdate, scope: CurrentScope, user: OwnerUser
) -> FinishOut:
    finish = await get_finish_doc(scope, finish_id)
    changes = _renamed(
        payload.model_dump(exclude_unset=True), "O nome do acabamento não pode ficar vazio."
    )
    for field, message in (
        ("color_name", "O nome da cor não pode ficar vazio."),
        ("color_hex", "A cor não pode ficar vazia."),
    ):
        if field in changes and changes[field] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message
            )
    if "color_name" in changes:
        changes["color_name"] = catalog_model.clean_name(changes["color_name"])
    if "color_hex" in changes:
        changes["color_hex"] = catalog_model.normalize_hex(changes["color_hex"])

    names = await _material_names(scope, [finish["material_id"]])
    material_name = names.get(finish["material_id"], "Material removido")
    if not changes:
        return finish_out(finish, material_name)

    changes["updated_at"] = utcnow()
    try:
        doc = await get_db()[catalog_model.FINISHES].find_one_and_update(
            scope.filter(_id=finish["_id"]), {"$set": changes}, return_document=ReturnDocument.AFTER
        )
    except DuplicateKeyError:
        raise _conflict(FINISH_DUPLICATE) from None
    if doc is None:
        raise _not_found(FINISH_NOT_FOUND)
    return finish_out(doc, material_name)


# ----------------------------------------------------------------------- marcas


def _logo_out(brand_id: str, logo: dict[str, Any] | None) -> BrandLogoOut | None:
    if not logo:
        return None
    return BrandLogoOut(
        url=f"/api/brands/{brand_id}/logo",
        filename=logo["filename"],
        content_type=logo["content_type"],
        size_bytes=logo["size_bytes"],
        checksum_sha256=logo["checksum_sha256"],
        uploaded_at=as_utc(logo["uploaded_at"]),
    )


def brand_out(doc: dict[str, Any]) -> BrandOut:
    brand_id = str(doc["_id"])
    return BrandOut(
        id=brand_id,
        tenant_id=doc["tenant_id"],
        name=doc["name"],
        description=doc.get("description"),
        logo=_logo_out(brand_id, doc.get("logo")),
        created_at=as_utc(doc["created_at"]),
        updated_at=as_utc(doc["updated_at"]),
    )


async def get_brand_doc(scope: TenantScope, brand_id: str) -> dict[str, Any]:
    oid = parse_object_id(brand_id, detail=BRAND_NOT_FOUND)
    doc = await get_db()[catalog_model.BRANDS].find_one(scope.filter(_id=oid))
    if doc is None:
        raise _not_found(BRAND_NOT_FOUND)
    return doc


@router.get("/brands", response_model=list[BrandOut])
async def list_brands(scope: CurrentScope) -> list[BrandOut]:
    cursor = get_db()[catalog_model.BRANDS].find(scope.filter()).sort("name", 1)
    return [brand_out(doc) async for doc in cursor]


@router.post("/brands", response_model=BrandOut, status_code=status.HTTP_201_CREATED)
async def create_brand(payload: BrandCreate, scope: CurrentScope, user: OwnerUser) -> BrandOut:
    doc = scope.stamp(
        catalog_model.new_brand_doc(
            name=payload.name,
            description=payload.description,
            created_by=str(user["_id"]),
        )
    )
    try:
        result = await get_db()[catalog_model.BRANDS].insert_one(doc)
    except DuplicateKeyError:
        raise _conflict(BRAND_DUPLICATE) from None
    return brand_out({**doc, "_id": result.inserted_id})


@router.patch("/brands/{brand_id}", response_model=BrandOut)
async def update_brand(
    brand_id: str, payload: BrandUpdate, scope: CurrentScope, user: OwnerUser
) -> BrandOut:
    oid = parse_object_id(brand_id, detail=BRAND_NOT_FOUND)
    changes = _renamed(
        payload.model_dump(exclude_unset=True), "O nome da marca não pode ficar vazio."
    )
    if not changes:
        return brand_out(await get_brand_doc(scope, brand_id))

    changes["updated_at"] = utcnow()
    try:
        doc = await get_db()[catalog_model.BRANDS].find_one_and_update(
            scope.filter(_id=oid), {"$set": changes}, return_document=ReturnDocument.AFTER
        )
    except DuplicateKeyError:
        raise _conflict(BRAND_DUPLICATE) from None
    if doc is None:
        raise _not_found(BRAND_NOT_FOUND)
    return brand_out(doc)


@router.put("/brands/{brand_id}/logo", response_model=BrandOut)
async def upload_brand_logo(
    brand_id: str,
    scope: CurrentScope,
    user: OwnerUser,
    file: UploadFile = File(..., description="Imagem do logo (JPEG, PNG ou WebP)."),
) -> BrandOut:
    """Grava o logo da marca como arquivo novo e aponta a marca para ele.

    Trocar o logo não reescreve nada: o arquivo nasce num diretório próprio com
    `O_EXCL` e o anterior continua no disco, somente-leitura. O que muda é o
    ponteiro no documento.
    """
    settings = get_settings()
    brand = await get_brand_doc(scope, brand_id)

    header = await file.read(media.SNIFF_BYTES)
    try:
        content_type, extension = media.sniff_image(header)
    except media.UnsupportedMedia:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                "Formato não aceito para o logo. Envie uma imagem "
                f"{', '.join(settings.allowed_image_labels)}."
            ),
        ) from None

    try:
        stored = await media.write_once(
            key=media.build_brand_logo_key(
                tenant_id=scope.tenant_id,
                logo_uid=uuid.uuid4().hex,
                extension=extension,
            ),
            chunks=media.restream(file, header),
            max_bytes=settings.max_upload_mb * 1024 * 1024,
        )
    except media.MediaTooLarge:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Logo maior que o limite de {settings.max_upload_mb} MB.",
        ) from None

    logo = catalog_model.logo_fields(
        storage_key=stored.key,
        content_type=content_type,
        size_bytes=stored.size_bytes,
        checksum_sha256=stored.checksum_sha256,
        filename=(file.filename or "logo")[:200],
        uploaded_by=str(user["_id"]),
    )
    doc = await get_db()[catalog_model.BRANDS].find_one_and_update(
        scope.filter(_id=brand["_id"]),
        {"$set": {"logo": logo, "updated_at": utcnow()}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise _not_found(BRAND_NOT_FOUND)
    return brand_out(doc)


@router.get("/brands/{brand_id}/logo")
async def get_brand_logo(brand_id: str, scope: CurrentScope, request: Request) -> Response:
    """Binário do logo, com o SHA-256 do upload como ETag."""
    brand = await get_brand_doc(scope, brand_id)
    logo = brand.get("logo")
    if not logo:
        raise _not_found(LOGO_MISSING)

    try:
        path = media.resolve(logo["storage_key"])
    except ValueError:
        raise _not_found(LOGO_GONE) from None
    if not path.is_file():
        raise _not_found(LOGO_GONE)

    etag = '"' + logo["checksum_sha256"] + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})

    return FileResponse(
        path,
        media_type=logo["content_type"],
        filename=logo["filename"],
        content_disposition_type="inline",
        headers={"ETag": etag, "Cache-Control": "private, max-age=3600"},
    )
