"""Rotas de `versions` — promover, comparar, aprovar.

A Fase 9 gera quantas propostas alguém quiser. Aqui acontece a **decisão**:
promover uma geração a versão é dizer "esta é candidata a ir para o cliente", e
aprovar é escolher a que vai.

## O limite de três aguenta corrida

Não há `count` antes do insert. Cada versão ocupa uma posição de 1 a 3 e o
índice único parcial recusa a segunda promoção que tentar a mesma vaga — dois
cliques simultâneos não viram quatro versões.

## Quem aprova

Aprovar é do **owner**, como o plano definiu. É a decisão que a apresentação da
Fase 11 vai carregar para o cliente; promover e descartar candidatas continua
sendo trabalho de projeto visual, que o editor faz.

## Descartar

O plano não lista um DELETE, mas sem ele o limite vira beco sem saída: três
versões promovidas e nunca mais é possível testar uma quarta ideia. O descarte
é soft-delete (o histórico fica) e a vaga volta. A versão **aprovada** não pode
ser descartada — aprove outra antes, senão a Fase 11 fica sem escolha
registrada.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.api.deps import CurrentScope, CurrentUser, require_role
from app.api.routers.photos import get_photo_doc
from app.api.routers.proposals import get_proposal_doc
from app.core.clock import as_utc, utcnow
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import photo as photo_model
from app.models import proposal as proposal_model
from app.models import version as version_model
from app.schemas.proposal import GeneratedImageOut
from app.schemas.version import (
    VersionCompareOut,
    VersionCreate,
    VersionListOut,
    VersionOut,
)

router = APIRouter()

NOT_FOUND = "Versão não encontrada neste workspace."
PROPOSAL_NOT_READY = (
    "Esta proposta não tem imagem gerada, então não há o que promover a versão."
)
PROPOSAL_OTHER_PHOTO = "Esta proposta é de outra foto."

# Aprovar é decisão de owner; o resto do fluxo é do editor.
OwnerUser = Annotated[dict[str, Any], Depends(require_role("owner"))]


def _reject(detail: str) -> None:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _generated_out(doc: dict[str, Any] | None) -> GeneratedImageOut | None:
    if not doc:
        return None
    image_id = str(doc["_id"])
    return GeneratedImageOut(
        id=image_id,
        photo_id=doc["photo_id"],
        proposal_id=doc["proposal_id"],
        url=f"/api/generated-images/{image_id}",
        content_type=doc["content_type"],
        size_bytes=doc["size_bytes"],
        checksum_sha256=doc["checksum_sha256"],
        width=doc["width"],
        height=doc["height"],
        changed_pixels=doc["changed_pixels"],
        provider=doc["provider"],
        created_at=as_utc(doc["created_at"]),
    )


def _to_out(
    doc: dict[str, Any], imagem: dict[str, Any] | None, approved_id: str | None
) -> VersionOut:
    version_id = str(doc["_id"])
    return VersionOut(
        id=version_id,
        tenant_id=doc["tenant_id"],
        photo_id=doc["photo_id"],
        project_id=doc["project_id"],
        proposal_id=doc["proposal_id"],
        position=doc["position"],
        label=doc["label"],
        notes=doc.get("notes"),
        generated_image=_generated_out(imagem),
        # Derivado da foto, nunca gravado na versão: com dois lugares guardando
        # "é a aprovada", eles divergiriam no primeiro erro de atualização.
        approved=version_id == approved_id,
        created_at=as_utc(doc["created_at"]),
    )


async def _images_by_id(
    scope: TenantScope, ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Imagens das versões numa query só — não uma por card."""
    if not ids:
        return {}
    oids = [parse_object_id(value, detail=NOT_FOUND) for value in set(ids)]
    cursor = get_db()[proposal_model.GENERATED_IMAGES].find(scope.filter(_id={"$in": oids}))
    return {str(doc["_id"]): doc async for doc in cursor}


async def _active_versions(scope: TenantScope, photo_id: str) -> list[dict[str, Any]]:
    cursor = (
        get_db()[version_model.COLLECTION]
        .find(scope.filter(photo_id=photo_id, deleted_at=None))
        .sort("position", 1)
    )
    return [doc async for doc in cursor]


async def get_version_doc(scope: TenantScope, version_id: str) -> dict[str, Any]:
    oid = parse_object_id(version_id, detail=NOT_FOUND)
    doc = await get_db()[version_model.COLLECTION].find_one(
        scope.filter(_id=oid, deleted_at=None)
    )
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return doc


async def _list_out(
    scope: TenantScope, photo: dict[str, Any], photo_id: str
) -> VersionListOut:
    docs = await _active_versions(scope, photo_id)
    imagens = await _images_by_id(scope, [doc["generated_image_id"] for doc in docs])
    aprovada = photo.get("approved_version_id")

    return VersionListOut(
        photo_id=photo_id,
        versions=[
            _to_out(doc, imagens.get(doc["generated_image_id"]), aprovada) for doc in docs
        ],
        slots_left=max(0, version_model.MAX_VERSIONS - len(docs)),
        limit_reached=len(docs) >= version_model.MAX_VERSIONS,
        approved_version_id=aprovada,
    )


@router.get("/photos/{photo_id}/versions", response_model=VersionListOut)
async def list_versions(photo_id: str, scope: CurrentScope) -> VersionListOut:
    """Versões ativas da foto, com o estado do limite já resolvido."""
    photo = await get_photo_doc(scope, photo_id)
    return await _list_out(scope, photo, photo_id)


@router.post(
    "/photos/{photo_id}/versions",
    response_model=VersionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_version(
    photo_id: str, payload: VersionCreate, scope: CurrentScope, user: CurrentUser
) -> VersionOut:
    """Promove uma proposta concluída a versão candidata.

    A imagem não é copiada: a versão aponta para a geração que já existe. Duas
    versões nunca duplicam o mesmo arquivo no disco.
    """
    photo = await get_photo_doc(scope, photo_id)
    proposta = await get_proposal_doc(scope, payload.proposal_id)

    if proposta["photo_id"] != photo_id:
        _reject(PROPOSAL_OTHER_PHOTO)
    if proposta["status"] != proposal_model.CONCLUIDA or not proposta.get(
        "generated_image_id"
    ):
        # Proposta que falhou fica registrada como tentativa, mas não tem
        # imagem — não há o que promover.
        _reject(PROPOSAL_NOT_READY)

    ativas = await _active_versions(scope, photo_id)
    if any(doc["proposal_id"] == payload.proposal_id for doc in ativas):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=version_model.ALREADY_VERSION
        )

    posicao = version_model.next_position({doc["position"] for doc in ativas})
    if posicao is None:
        _reject(version_model.LIMIT_REACHED)

    doc = scope.stamp(
        version_model.new_version_doc(
            photo_id=photo_id,
            area_id=photo["area_id"],
            project_id=photo["project_id"],
            proposal_id=payload.proposal_id,
            generated_image_id=proposta["generated_image_id"],
            position=posicao,
            label=payload.label,
            notes=payload.notes,
            created_by=str(user["_id"]),
        )
    )
    try:
        result = await get_db()[version_model.COLLECTION].insert_one(doc)
    except DuplicateKeyError:
        # Duas promoções simultâneas disputaram a mesma vaga. O índice parcial
        # recusou esta — é o limite de três valendo sob corrida, não uma
        # contagem que se perdeu entre a leitura e a escrita.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Outra versão ocupou esta vaga agora. Recarregue e tente de novo.",
        ) from None

    imagens = await _images_by_id(scope, [proposta["generated_image_id"]])
    return _to_out(
        {**doc, "_id": result.inserted_id},
        imagens.get(proposta["generated_image_id"]),
        photo.get("approved_version_id"),
    )


@router.get("/photos/{photo_id}/versions/compare", response_model=VersionCompareOut)
async def compare_versions(
    photo_id: str,
    scope: CurrentScope,
    ids: Annotated[
        str, Query(description="Ids das versões separados por vírgula: `?ids=a,b`.")
    ],
) -> VersionCompareOut:
    """Versões lado a lado, na ordem em que foram pedidas.

    Comparar é leitura: id que não é desta foto (ou de outro tenant) some com
    404, e não com uma lista silenciosamente menor do que o pedido.
    """
    photo = await get_photo_doc(scope, photo_id)

    pedidos = [valor.strip() for valor in ids.split(",") if valor.strip()]
    if not pedidos:
        _reject("Informe ao menos uma versão para comparar.")
    if len(pedidos) > version_model.MAX_VERSIONS:
        _reject(
            f"Dá para comparar no máximo {version_model.MAX_VERSIONS} versões — "
            "é o limite de versões por foto."
        )

    docs = []
    for version_id in pedidos:
        doc = await get_version_doc(scope, version_id)
        if doc["photo_id"] != photo_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
        docs.append(doc)

    imagens = await _images_by_id(scope, [doc["generated_image_id"] for doc in docs])
    aprovada = photo.get("approved_version_id")

    return VersionCompareOut(
        photo_id=photo_id,
        original_url=f"/api/photos/{photo_id}/original",
        versions=[
            _to_out(doc, imagens.get(doc["generated_image_id"]), aprovada) for doc in docs
        ],
    )


@router.post("/versions/{version_id}/approve", response_model=VersionListOut)
async def approve_version(
    version_id: str, scope: CurrentScope, user: OwnerUser
) -> VersionListOut:
    """Aprova esta versão como a escolha da foto.

    Aprovar outra substitui a anterior num `$set` só — a foto guarda um id, e
    não existe o estado impossível de duas versões aprovadas ao mesmo tempo.
    """
    version = await get_version_doc(scope, version_id)
    photo = await get_photo_doc(scope, version["photo_id"])

    atualizada = await get_db()[photo_model.COLLECTION].find_one_and_update(
        scope.filter(_id=photo["_id"], deleted_at=None),
        {
            "$set": {
                "approved_version_id": version_id,
                "approved_by": str(user["_id"]),
                "approved_at": utcnow(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if atualizada is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Foto não encontrada neste workspace."
        )
    return await _list_out(scope, atualizada, version["photo_id"])


@router.delete("/versions/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def discard_version(
    version_id: str, scope: CurrentScope, user: CurrentUser
) -> None:
    """Descarta uma versão e devolve a vaga.

    Soft-delete: a versão sai da disputa, mas fica no histórico de que existiu e
    foi considerada. O índice de posição é parcial, então a vaga volta a ser
    ocupável na hora.
    """
    version = await get_version_doc(scope, version_id)
    photo = await get_photo_doc(scope, version["photo_id"])

    if photo.get("approved_version_id") == version_id:
        _reject(version_model.APPROVED_CANNOT_BE_DISCARDED)

    await get_db()[version_model.COLLECTION].update_one(
        scope.filter(_id=version["_id"]),
        {"$set": version_model.discarded_fields(discarded_by=str(user["_id"]))},
    )
