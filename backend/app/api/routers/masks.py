"""Rotas de `masks` — o Architecture Lock em forma de dado.

Duas rotas por foto: carregar e salvar as camadas. Nenhuma delas gera imagem —
a Fase 8 só estabelece **onde** a Fase 9 poderá escrever, e a resposta já
carrega o motivo do bloqueio enquanto a geração ainda não pode acontecer.

## Uma máscara por foto, PUT que substitui

Índice único em `tenant_id` + `photo_id`, como na calibração. O PUT troca o
conjunto inteiro de camadas: o que está na tela ao salvar é exatamente o que
fica no banco, sem acumular sobras de desenhos anteriores. Lista vazia apaga
tudo — é como a tela desfaz um desenho sem precisar de uma rota de DELETE.

## Quem pode

Desenhar máscara é trabalho de levantamento, então o editor faz. Ligar e
desligar o Architecture Lock é decisão do projeto inteiro e ficou com o owner,
na rota de `projects`.

## O original continua intocado

A máscara é documento novo no Mongo. O arquivo da foto é aberto só para
leitura, e só para saber largura e altura — o que permite recusar vértice fora
da imagem. Nenhum byte do original é reescrito.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.api.deps import CurrentScope, CurrentUser
from app.api.routers.photos import get_photo_doc, original_dimensions
from app.api.routers.projects import get_project_doc
from app.core.clock import as_utc, utcnow
from app.core.db import get_db
from app.core.tenancy import TenantScope
from app.models import mask as mask_model
from app.models import project as project_model
from app.schemas.mask import MaskLayerOut, MaskPoint, MasksIn, MasksOut

router = APIRouter()


def _reject(detail: str) -> None:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


async def get_mask_doc(scope: TenantScope, photo_id: str) -> dict[str, Any] | None:
    """Máscara da foto, ou `None`. Ausência é estado normal, não erro."""
    return await get_db()[mask_model.COLLECTION].find_one(scope.filter(photo_id=photo_id))


def _layer_out(layer: dict[str, Any]) -> MaskLayerOut:
    return MaskLayerOut(
        id=layer["id"],
        kind=layer["kind"],
        kind_label=mask_model.KIND_LABELS[layer["kind"]],
        label=layer["label"],
        points=[MaskPoint(**point) for point in layer["points"]],
        area_px=layer["area_px"],
    )


def _to_out(
    *,
    photo_id: str,
    scope: TenantScope,
    doc: dict[str, Any] | None,
    architecture_lock: bool,
) -> MasksOut:
    """Estado das máscaras + o veredito da geração, resolvido no servidor.

    O motivo do bloqueio sai daqui pronto, com o mesmo texto que a Fase 9 usará
    no 422. A tela não escreve motivo por conta própria: se um dia a regra
    mudar, muda em `mask_model.generation_block` e a tela acompanha sozinha.
    """
    layers = doc.get("layers", []) if doc else []
    bloqueio = mask_model.generation_block(mask_doc=doc, architecture_lock=architecture_lock)

    return MasksOut(
        photo_id=photo_id,
        tenant_id=scope.tenant_id,
        masked=bool(layers),
        layers=[_layer_out(layer) for layer in layers],
        intervention_count=len(mask_model.layers_of(doc, mask_model.INTERVENTION)),
        protect_count=len(mask_model.layers_of(doc, mask_model.PROTECT)),
        image_width=doc.get("image_width") if doc else None,
        image_height=doc.get("image_height") if doc else None,
        architecture_lock=architecture_lock,
        generation_ready=bloqueio is None,
        blocked_reason=bloqueio,
        updated_at=as_utc(doc["updated_at"]) if doc and doc.get("updated_at") else None,
    )


async def _lock_of(scope: TenantScope, project_id: str) -> bool:
    projeto = await get_project_doc(scope, project_id)
    return project_model.architecture_lock_of(projeto)


@router.get("/photos/{photo_id}/masks", response_model=MasksOut)
async def get_masks(photo_id: str, scope: CurrentScope) -> MasksOut:
    """Camadas da foto, ou o estado "sem máscara" (200, `masked=false`).

    Foto sem máscara é o estado inicial de toda foto, não erro. A tela precisa
    distinguir isso de "essa foto não é sua", e 404 nos dois casos não distingue.
    """
    photo = await get_photo_doc(scope, photo_id)
    doc = await get_mask_doc(scope, photo_id)
    return _to_out(
        photo_id=photo_id,
        scope=scope,
        doc=doc,
        architecture_lock=await _lock_of(scope, photo["project_id"]),
    )


@router.put("/photos/{photo_id}/masks", response_model=MasksOut)
async def save_masks(
    photo_id: str,
    payload: MasksIn,
    scope: CurrentScope,
    user: CurrentUser,
) -> MasksOut:
    """Substitui as camadas da foto pelo que está na tela.

    Cada polígono é conferido contra as dimensões reais do original: vértice
    fora da imagem viraria área de intervenção que não existe na foto, e a
    Fase 9 receberia permissão para escrever onde não há pixel.
    """
    photo = await get_photo_doc(scope, photo_id)
    width, height = original_dimensions(photo)

    layers: list[dict[str, Any]] = []
    for ordem, entrada in enumerate(payload.layers, start=1):
        pontos = [ponto.as_tuple() for ponto in entrada.points]

        for x, y in pontos:
            if x > width or y > height:
                _reject(
                    f"A camada {ordem} tem um vértice fora da foto "
                    f"({x:.0f}, {y:.0f} em uma imagem de {width}x{height} px)."
                )

        area = mask_model.polygon_area(pontos)
        if area < mask_model.MIN_AREA_PX:
            _reject(
                f"A camada {ordem} não delimita área ({area:.1f} px²). "
                "Desenhe o recorte com mais folga."
            )

        layers.append(
            mask_model.new_layer(
                kind=entrada.kind,
                # Sem nome digitado, o rótulo do tipo já identifica a camada na
                # lista — melhor do que um item em branco na tela.
                label=entrada.label or mask_model.KIND_LABELS[entrada.kind],
                points=pontos,
            )
        )

    fields = mask_model.mask_fields(
        layers=layers,
        image_width=width,
        image_height=height,
        updated_by=str(user["_id"]),
    )
    # Contexto da foto desnormalizado: a Fase 9 lê máscara por projeto sem join.
    fields["area_id"] = photo["area_id"]
    fields["project_id"] = photo["project_id"]

    collection = get_db()[mask_model.COLLECTION]
    update = {"$set": fields, "$setOnInsert": {"created_at": utcnow()}}
    try:
        doc = await collection.find_one_and_update(
            scope.filter(photo_id=photo_id),
            update,
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        # Corrida entre dois saves da mesma foto: o documento já existe agora,
        # então a segunda tentativa cai no caminho de update.
        doc = await collection.find_one_and_update(
            scope.filter(photo_id=photo_id), update, return_document=ReturnDocument.AFTER
        )
        if doc is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Não foi possível salvar as máscaras. Tente de novo.",
            ) from None

    return _to_out(
        photo_id=photo_id,
        scope=scope,
        doc=doc,
        architecture_lock=await _lock_of(scope, photo["project_id"]),
    )
