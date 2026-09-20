"""Rotas do quantitativo e do orçamento.

Fecha o fluxo do blueprint: levantamento → projeto visual → apresentação →
**quantitativo**. As linhas saem dos elementos conferidos, com o material e o
acabamento que o catálogo (Fase 7) registrou.

## As três regras desta fase

**Só elemento conferido entra.** Quantitativo é base de preço; peça marcada na
foto e nunca conferida ainda é hipótese, não item de orçamento.

**Estimativa continua estimativa.** A área vem de largura × altura, e se
qualquer uma das duas foi `estimated` a linha inteira sai rotulada assim. Quem
fecha preço vê de onde veio o número.

**Preço nunca é inventado.** O catálogo não guarda preço e não há tabela aqui.
Linha sem preço fica sem preço, e o total do orçamento é declarado parcial
enquanto isso — nunca somado como se a linha fosse de graça.

## Regerar preserva o trabalho

`POST` recalcula as linhas derivadas do estado atual do levantamento, mas
mantém preço, observações e quantidade digitada de cada elemento que continua
no quantitativo. Sem isso o botão seria inutilizável: cada regeração apagaria
os preços.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.api.deps import CurrentScope, CurrentUser
from app.api.routers.elements import catalog_index_for
from app.api.routers.projects import get_project_doc
from app.core.clock import as_utc, utcnow
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import element as element_model
from app.models import photo as photo_model
from app.models import takeoff as takeoff_model
from app.schemas.takeoff import (
    BudgetItemUpdate,
    ManualItemIn,
    TakeoffItemOut,
    TakeoffOut,
)

router = APIRouter()

NOT_FOUND = "Quantitativo não encontrado neste workspace."
ITEM_NOT_FOUND = "Linha de orçamento não encontrada neste quantitativo."


def _item_out(item: dict[str, Any]) -> TakeoffItemOut:
    origem = item.get("quantity_source")
    return TakeoffItemOut(
        id=item["id"],
        origin=item["origin"],
        element_id=item.get("element_id"),
        photo_id=item.get("photo_id"),
        description=item["description"],
        kind_label=item.get("kind_label"),
        material_name=item.get("material_name"),
        finish_name=item.get("finish_name"),
        color_name=item.get("color_name"),
        color_hex=item.get("color_hex"),
        quantity=item.get("quantity"),
        unit=item.get("unit", takeoff_model.UNIT_AREA),
        quantity_source=origem,
        quantity_source_label=takeoff_model.SOURCE_LABELS.get(origem) if origem else None,
        quantity_note=item.get("quantity_note"),
        unit_price=item.get("unit_price"),
        line_total=takeoff_model.line_total(item),
        notes=item.get("notes"),
    )


def _to_out(
    scope: TenantScope,
    project_id: str,
    doc: dict[str, Any] | None,
    pulados: int = 0,
) -> TakeoffOut:
    itens = (doc or {}).get("items", [])
    totais = [takeoff_model.line_total(item) for item in itens]
    com_total = [valor for valor in totais if valor is not None]

    return TakeoffOut(
        project_id=project_id,
        tenant_id=scope.tenant_id,
        items=[_item_out(item) for item in itens],
        generated=bool(doc),
        # Soma só do que tem quantidade e preço. `None` quando nada soma ainda,
        # para a tela não exibir "R$ 0,00" num orçamento que só não foi preenchido.
        total=round(sum(com_total), 2) if com_total else None,
        items_without_price=sum(1 for item in itens if item.get("unit_price") is None),
        items_with_estimate=sum(
            1
            for item in itens
            if item.get("quantity_source") == takeoff_model.SOURCE_ESTIMATED
        ),
        skipped_without_measurement=pulados
        if pulados
        else (doc or {}).get("skipped_without_measurement", 0),
        generated_at=as_utc(doc["generated_at"]) if doc and doc.get("generated_at") else None,
        updated_at=as_utc(doc["updated_at"]) if doc and doc.get("updated_at") else None,
    )


async def get_takeoff_doc(scope: TenantScope, project_id: str) -> dict[str, Any] | None:
    return await get_db()[takeoff_model.COLLECTION].find_one(
        scope.filter(project_id=project_id)
    )


async def _conferred_elements(
    scope: TenantScope, project_id: str
) -> list[dict[str, Any]]:
    """Elementos conferidos do projeto, na ordem em que foram marcados.

    Peça nunca conferida fica de fora: quantitativo é base de preço, e hipótese
    não vira linha de orçamento.
    """
    cursor = (
        get_db()[element_model.COLLECTION]
        .find(
            scope.filter(
                project_id=project_id,
                deleted_at=None,
                **{"conference.status": "conferido"},
            )
        )
        .sort("created_at", 1)
    )
    return [doc async for doc in cursor]


async def _photo_names(scope: TenantScope, photo_ids: list[str]) -> dict[str, str]:
    """Nome do arquivo por foto, para a linha dizer de onde a peça saiu."""
    if not photo_ids:
        return {}
    oids = [parse_object_id(value, detail=NOT_FOUND) for value in set(photo_ids)]
    cursor = get_db()[photo_model.COLLECTION].find(
        scope.filter(_id={"$in": oids}), {"original_filename": 1}
    )
    return {str(doc["_id"]): doc["original_filename"] async for doc in cursor}


def _linha_de(
    element: dict[str, Any], catalogo: dict[str, dict], foto_nome: str | None
) -> dict[str, Any]:
    """Converte um elemento conferido numa linha do quantitativo."""
    spec = element.get("spec") or {}
    material = catalogo.get("material_id", {}).get(spec.get("material_id"))
    acabamento = catalogo.get("finish_id", {}).get(spec.get("finish_id"))

    quantidade, procedencia = takeoff_model.area_from(element.get("measurements") or {})

    descricao = element["name"]
    if foto_nome:
        descricao = f"{element['name']} ({foto_nome})"

    return takeoff_model.new_item(
        origin=takeoff_model.ORIGIN_ELEMENT,
        element_id=str(element["_id"]),
        photo_id=element["photo_id"],
        area_id=element.get("area_id"),
        description=descricao,
        kind_label=element_model.KIND_LABELS.get(element.get("kind", "")),
        material_name=material["name"] if material else None,
        finish_name=acabamento["name"] if acabamento else None,
        color_name=acabamento["color_name"] if acabamento else None,
        color_hex=acabamento["color_hex"] if acabamento else None,
        quantity=quantidade,
        unit=takeoff_model.UNIT_AREA,
        quantity_source=procedencia,
        quantity_note=None if quantidade is not None else takeoff_model.NO_MEASUREMENT,
    )


@router.get("/projects/{project_id}/quantity-takeoff", response_model=TakeoffOut)
async def get_takeoff(project_id: str, scope: CurrentScope) -> TakeoffOut:
    """Quantitativo salvo, ou o estado vazio com `generated=false`."""
    await get_project_doc(scope, project_id)
    return _to_out(scope, project_id, await get_takeoff_doc(scope, project_id))


@router.post("/projects/{project_id}/quantity-takeoff", response_model=TakeoffOut)
async def generate_takeoff(
    project_id: str, scope: CurrentScope, user: CurrentUser
) -> TakeoffOut:
    """Gera (ou atualiza) o quantitativo a partir dos elementos conferidos.

    Preço, observações e quantidade digitada sobrevivem à regeração; o que é
    recalculado é o que vem do levantamento. Linhas manuais ficam intactas no
    fim da lista.
    """
    await get_project_doc(scope, project_id)
    anterior = await get_takeoff_doc(scope, project_id)
    por_elemento = {
        item["element_id"]: item
        for item in (anterior or {}).get("items", [])
        if item.get("origin") == takeoff_model.ORIGIN_ELEMENT and item.get("element_id")
    }

    elementos = await _conferred_elements(scope, project_id)
    catalogo = await catalog_index_for(scope, elementos)
    nomes = await _photo_names(scope, [e["photo_id"] for e in elementos])

    itens: list[dict[str, Any]] = []
    pulados = 0
    for element in elementos:
        linha = _linha_de(element, catalogo, nomes.get(element["photo_id"]))
        anterior_do_elemento = por_elemento.get(str(element["_id"]))
        if anterior_do_elemento:
            linha = takeoff_model.carry_over(linha, anterior_do_elemento)
        if linha.get("quantity") is None:
            # A linha entra assim mesmo, dizendo o que falta: some-la
            # esconderia do orçamento uma peça que existe e foi conferida.
            pulados += 1
        itens.append(linha)

    # Linhas manuais não são recalculáveis: elas vêm inteiras de quem digitou.
    itens.extend(
        item
        for item in (anterior or {}).get("items", [])
        if item.get("origin") == takeoff_model.ORIGIN_MANUAL
    )

    fields = takeoff_model.takeoff_fields(items=itens, generated_by=str(user["_id"]))
    fields["skipped_without_measurement"] = pulados
    update = {"$set": fields, "$setOnInsert": {"created_at": utcnow()}}

    collection = get_db()[takeoff_model.COLLECTION]
    try:
        doc = await collection.find_one_and_update(
            scope.filter(project_id=project_id),
            update,
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        doc = await collection.find_one_and_update(
            scope.filter(project_id=project_id), update, return_document=ReturnDocument.AFTER
        )
        if doc is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Não foi possível gerar o quantitativo. Tente de novo.",
            ) from None

    return _to_out(scope, project_id, doc, pulados)


@router.post(
    "/quantity-takeoff/{project_id}/items",
    response_model=TakeoffOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_manual_item(
    project_id: str, payload: ManualItemIn, scope: CurrentScope, user: CurrentUser
) -> TakeoffOut:
    """Adiciona uma linha que não vem de elemento: instalação, frete, projeto.

    A quantidade aqui é sempre `user_informed` — foi digitada, não medida. O
    rótulo diz isso na tela e no orçamento.
    """
    await get_project_doc(scope, project_id)

    item = takeoff_model.new_item(
        origin=takeoff_model.ORIGIN_MANUAL,
        description=payload.description,
        quantity=payload.quantity,
        unit=payload.unit,
        quantity_source=takeoff_model.SOURCE_INFORMED,
    )
    item["unit_price"] = payload.unit_price
    item["notes"] = payload.notes

    doc = await get_db()[takeoff_model.COLLECTION].find_one_and_update(
        scope.filter(project_id=project_id),
        {
            "$push": {"items": item},
            "$set": {"updated_at": utcnow(), "updated_by": str(user["_id"])},
            "$setOnInsert": {"created_at": utcnow(), "generated_at": utcnow()},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return _to_out(scope, project_id, doc)


@router.patch("/budget-items/{item_id}", response_model=TakeoffOut)
async def update_budget_item(
    item_id: str, payload: BudgetItemUpdate, scope: CurrentScope, user: CurrentUser
) -> TakeoffOut:
    """Preço, quantidade e observações de uma linha.

    Informar quantidade marca a procedência como `user_informed`: um número
    digitado não passa a valer como medida de campo, e não é sobrescrito na
    próxima regeração.
    """
    doc = await get_db()[takeoff_model.COLLECTION].find_one(
        scope.filter(**{"items.id": item_id})
    )
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ITEM_NOT_FOUND)

    mudancas = payload.model_dump(exclude_unset=True)
    if not mudancas:
        return _to_out(scope, doc["project_id"], doc)

    campos: dict[str, Any] = {}
    for campo in ("unit_price", "notes", "unit"):
        if campo in mudancas:
            campos[f"items.$.{campo}"] = mudancas[campo]
    if "quantity" in mudancas:
        campos["items.$.quantity"] = mudancas["quantity"]
        campos["items.$.quantity_source"] = takeoff_model.SOURCE_INFORMED
        # A explicação de "sem medida" perde sentido assim que alguém informa
        # a quantidade.
        campos["items.$.quantity_note"] = None

    atualizado = await get_db()[takeoff_model.COLLECTION].find_one_and_update(
        scope.filter(**{"items.id": item_id}),
        {"$set": {**campos, "updated_at": utcnow(), "updated_by": str(user["_id"])}},
        return_document=ReturnDocument.AFTER,
    )
    if atualizado is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ITEM_NOT_FOUND)
    return _to_out(scope, atualizado["project_id"], atualizado)
