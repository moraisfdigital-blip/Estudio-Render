"""Rotas de `elements` — as peças a intervir, com medida e conferência.

Todas as rotas passam por `get_photo_doc` / `get_element_doc`, que já filtram
por tenant: o `photo_id` ou `element_id` da URL é palpite do cliente até essa
checagem passar.

## O que este módulo não faz

Não preenche medida. `PUT /measurements` só grava número que veio no corpo, com
o `source` que o usuário declarou na tela. O `scale_estimate` da resposta é
calculado aqui, sim — mas sai sempre marcado como `estimated`, em campo
separado do que está salvo, e nenhum caminho deste arquivo copia esse valor
para dentro de `measurements`. Para virar medida do elemento, ele tem que
voltar num PUT explícito.

## O original continua intocado

Elemento é documento novo no Mongo. O arquivo da foto é aberto só para leitura,
e só para saber largura e altura — o que permite recusar retângulo fora da
imagem. Nenhum byte do original é reescrito.
"""

from typing import Any

from bson import ObjectId
from fastapi import APIRouter, HTTPException, status
from pymongo import ReturnDocument

from app.api.deps import CurrentScope, CurrentUser
from app.api.routers.catalog import get_brand_doc, get_finish_doc, get_material_doc
from app.api.routers.photos import get_photo_doc, original_dimensions
from app.core.clock import as_utc, utcnow
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import calibration as calibration_model
from app.models import catalog as catalog_model
from app.models import element as element_model
from app.schemas.catalog import (
    SpecBrandOut,
    SpecFinishOut,
    SpecIn,
    SpecMaterialOut,
    SpecOut,
)
from app.schemas.element import (
    Box,
    ConferenceIn,
    ConferenceOut,
    ElementCreate,
    ElementOut,
    ElementUpdate,
    MeasurementOut,
    MeasurementsIn,
    MeasurementsOut,
    ScaleEstimateOut,
)

router = APIRouter()

NOT_FOUND = "Elemento não encontrado neste workspace."
NOTHING_TO_CONFIRM = (
    "Este elemento ainda não tem medida. Salve ao menos uma medida antes de marcar "
    "como conferido."
)


def _reject(detail: str) -> None:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _check_box(box: Box, width: int, height: int) -> None:
    """Retângulo tem que caber na foto e ter tamanho de peça, não de clique."""
    if box.width < element_model.MIN_BOX_SIDE or box.height < element_model.MIN_BOX_SIDE:
        _reject(
            "O retângulo ficou pequeno demais "
            f"({box.width:.0f}×{box.height:.0f} px). Arraste sobre a peça inteira."
        )
    if box.x + box.width > width or box.y + box.height > height:
        _reject(
            "O retângulo passa da borda da foto "
            f"(imagem de {width}×{height} px). Marque a peça dentro da imagem."
        )


async def _calibration(scope: TenantScope, photo_id: str) -> dict[str, Any] | None:
    return await get_db()[calibration_model.COLLECTION].find_one(scope.filter(photo_id=photo_id))


def _measurement_out(entry: dict[str, Any] | None) -> MeasurementOut | None:
    if not entry:
        return None
    source = entry["source"]
    return MeasurementOut(
        value=entry["value"],
        source=source,
        # O rótulo sai do servidor junto com o valor: assim a tela não tem como
        # mostrar um número de estimativa sem a palavra "estimativa" do lado.
        source_label=element_model.SOURCE_LABELS[source],
    )


def _scale_estimate(
    box: dict[str, float], calibration: dict[str, Any] | None
) -> ScaleEstimateOut | None:
    """Sugestão pela escala, ou nada quando a foto não está calibrada."""
    if calibration is None:
        return None
    estimate = element_model.estimate_from_scale(
        box=box,
        pixels_per_unit=calibration["pixels_per_unit"],
        unit=calibration["unit"],
    )
    return ScaleEstimateOut(**estimate)


async def catalog_index_for(scope: TenantScope, docs: list[dict[str, Any]]) -> dict[str, dict]:
    """Catálogo citado por estes elementos, em três queries — não uma por elemento.

    A spec guarda só ids; nome e cor vivem no catálogo e são lidos aqui na hora
    de responder. É o que faz renomear um material aparecer em todo elemento na
    resposta seguinte, em vez de deixar cópias velhas espalhadas.
    """
    wanted: dict[str, set[str]] = {"material_id": set(), "finish_id": set(), "brand_id": set()}
    for doc in docs:
        spec = doc.get("spec") or {}
        for field, ids in wanted.items():
            if value := spec.get(field):
                ids.add(value)

    index: dict[str, dict] = {}
    for field, collection in (
        ("material_id", catalog_model.MATERIALS),
        ("finish_id", catalog_model.FINISHES),
        ("brand_id", catalog_model.BRANDS),
    ):
        ids = wanted[field]
        if not ids:
            index[field] = {}
            continue
        # Id gravado fora do formato (import, correção manual no banco) é
        # ignorado em vez de estourar: `_spec_out` já trata item ausente como
        # "sem spec", e um elemento sem material na tela é melhor do que a
        # lista inteira em 500.
        oids = [ObjectId(value) for value in ids if ObjectId.is_valid(value)]
        if not oids:
            index[field] = {}
            continue
        cursor = get_db()[collection].find(scope.filter(_id={"$in": oids}))
        index[field] = {str(entry["_id"]): entry async for entry in cursor}
    return index


def _spec_out(doc: dict[str, Any], index: dict[str, dict]) -> SpecOut:
    """Spec resolvida. Item apagado do catálogo simplesmente some da resposta."""
    spec = doc.get("spec") or catalog_model.empty_spec()
    material = index.get("material_id", {}).get(spec.get("material_id"))
    finish = index.get("finish_id", {}).get(spec.get("finish_id"))
    brand = index.get("brand_id", {}).get(spec.get("brand_id"))

    return SpecOut(
        material=(
            SpecMaterialOut(id=str(material["_id"]), name=material["name"]) if material else None
        ),
        finish=(
            SpecFinishOut(
                id=str(finish["_id"]),
                name=finish["name"],
                # Cor sai daqui pronta: a tela não tem paleta própria.
                color_name=finish["color_name"],
                color_hex=finish["color_hex"],
            )
            if finish
            else None
        ),
        brand=(
            SpecBrandOut(
                id=str(brand["_id"]),
                name=brand["name"],
                logo_url=f"/api/brands/{brand['_id']}/logo" if brand.get("logo") else None,
            )
            if brand
            else None
        ),
        applied_at=as_utc(spec["applied_at"]) if spec.get("applied_at") else None,
        is_empty=not any((material, finish, brand)),
    )


def _to_out(
    doc: dict[str, Any],
    calibration: dict[str, Any] | None,
    catalog_index: dict[str, dict] | None = None,
) -> ElementOut:
    measurements = doc.get("measurements") or element_model.empty_measurements()
    measured_at = measurements.get("measured_at")
    return ElementOut(
        id=str(doc["_id"]),
        tenant_id=doc["tenant_id"],
        photo_id=doc["photo_id"],
        area_id=doc["area_id"],
        project_id=doc["project_id"],
        name=doc["name"],
        kind=doc["kind"],
        kind_label=element_model.KIND_LABELS[doc["kind"]],
        box=Box(**doc["box"]),
        notes=doc.get("notes"),
        measurements=MeasurementsOut(
            unit=measurements.get("unit"),
            width=_measurement_out(measurements.get("width")),
            height=_measurement_out(measurements.get("height")),
            depth=_measurement_out(measurements.get("depth")),
            measured_at=as_utc(measured_at) if measured_at else None,
            has_estimate=element_model.has_estimate(measurements),
        ),
        conference=ConferenceOut(
            status=doc["conference"]["status"],
            at=as_utc(doc["conference"]["at"]) if doc["conference"].get("at") else None,
        ),
        spec=_spec_out(doc, catalog_index or {}),
        scale_estimate=_scale_estimate(doc["box"], calibration),
        created_at=as_utc(doc["created_at"]),
        updated_at=as_utc(doc["updated_at"]),
    )


async def get_element_doc(scope: TenantScope, element_id: str) -> dict[str, Any]:
    """Elemento ativo do tenant ou 404. Removido responde 404 como se não existisse."""
    oid = parse_object_id(element_id, detail=NOT_FOUND)
    doc = await get_db()[element_model.COLLECTION].find_one(scope.filter(_id=oid, deleted_at=None))
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return doc


async def _out_for(scope: TenantScope, doc: dict[str, Any]) -> ElementOut:
    """Resposta de um elemento só: calibração da foto + catálogo da spec dele."""
    return _to_out(
        doc,
        await _calibration(scope, doc["photo_id"]),
        await catalog_index_for(scope, [doc]),
    )


@router.get("/photos/{photo_id}/elements", response_model=list[ElementOut])
async def list_elements(photo_id: str, scope: CurrentScope) -> list[ElementOut]:
    """Elementos marcados nesta foto, na ordem em que foram marcados."""
    await get_photo_doc(scope, photo_id)

    cursor = (
        get_db()[element_model.COLLECTION]
        .find(scope.filter(photo_id=photo_id, deleted_at=None))
        .sort("created_at", 1)
    )
    docs = [doc async for doc in cursor]
    # Uma consulta de calibração para a lista inteira: todos os elementos desta
    # rota são da mesma foto, então a escala é a mesma.
    calibration = await _calibration(scope, photo_id)
    catalog_index = await catalog_index_for(scope, docs)
    return [_to_out(doc, calibration, catalog_index) for doc in docs]


@router.post(
    "/photos/{photo_id}/elements", response_model=ElementOut, status_code=status.HTTP_201_CREATED
)
async def create_element(
    photo_id: str,
    payload: ElementCreate,
    scope: CurrentScope,
    user: CurrentUser,
) -> ElementOut:
    """Marca uma peça na foto. Sem medida: medir é o passo seguinte."""
    photo = await get_photo_doc(scope, photo_id)
    width, height = original_dimensions(photo)
    _check_box(payload.box, width, height)

    doc = scope.stamp(
        element_model.new_element_doc(
            photo_id=photo_id,
            area_id=photo["area_id"],
            project_id=photo["project_id"],
            name=payload.name,
            kind=payload.kind,
            box=element_model.normalized_box(**payload.box.model_dump()),
            notes=payload.notes,
            created_by=str(user["_id"]),
        )
    )
    result = await get_db()[element_model.COLLECTION].insert_one(doc)
    return await _out_for(scope, {**doc, "_id": result.inserted_id})


@router.patch("/elements/{element_id}", response_model=ElementOut)
async def update_element(
    element_id: str, payload: ElementUpdate, scope: CurrentScope
) -> ElementOut:
    """Renomeia, muda o tipo, corrige o retângulo ou a observação.

    Não mexe em medida nem em conferência: cada uma tem sua rota. Corrigir o
    retângulo muda a sugestão pela escala, mas não invalida uma medida tomada
    com trena — por isso a conferência fica como está.
    """
    element = await get_element_doc(scope, element_id)

    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        if changes["name"] is None:
            _reject("O nome do elemento não pode ficar vazio.")
        changes["name"] = " ".join(changes["name"].split())
    if "kind" in changes and changes["kind"] is None:
        del changes["kind"]
    if changes.get("box") is not None:
        box = Box(**changes["box"])
        photo = await get_photo_doc(scope, element["photo_id"])
        width, height = original_dimensions(photo)
        _check_box(box, width, height)
        changes["box"] = element_model.normalized_box(**box.model_dump())
    elif "box" in changes:
        # `box: null` não é "apagar a posição": elemento sem retângulo não
        # existe no levantamento.
        del changes["box"]

    if not changes:
        return await _out_for(scope, element)

    changes["updated_at"] = utcnow()
    doc = await get_db()[element_model.COLLECTION].find_one_and_update(
        scope.filter(_id=element["_id"], deleted_at=None),
        {"$set": changes},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return await _out_for(scope, doc)


@router.delete("/elements/{element_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_element(element_id: str, scope: CurrentScope, user: CurrentUser) -> None:
    """Tira o elemento do levantamento (soft-delete, como nas fotos)."""
    oid = parse_object_id(element_id, detail=NOT_FOUND)
    result = await get_db()[element_model.COLLECTION].update_one(
        scope.filter(_id=oid, deleted_at=None),
        {"$set": {"deleted_at": utcnow(), "deleted_by": str(user["_id"]), "updated_at": utcnow()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)


@router.put("/elements/{element_id}/measurements", response_model=ElementOut)
async def save_measurements(
    element_id: str,
    payload: MeasurementsIn,
    scope: CurrentScope,
    user: CurrentUser,
) -> ElementOut:
    """Substitui as medidas do elemento pelo que o usuário informou.

    Cada dimensão chega com `value` e `source` — quem declara a origem é a
    pessoa na tela, não este código. Salvar medida devolve a conferência para
    `pendente`: o selo valia para os números anteriores.
    """
    element = await get_element_doc(scope, element_id)

    values = {
        dimension: (entry.value, entry.source)
        for dimension in element_model.DIMENSIONS
        if (entry := getattr(payload, dimension)) is not None
    }
    measurements = element_model.measurement_fields(
        unit=payload.unit,
        values=values,
        measured_by=str(user["_id"]),
    )

    doc = await get_db()[element_model.COLLECTION].find_one_and_update(
        scope.filter(_id=element["_id"], deleted_at=None),
        {
            "$set": {
                "measurements": measurements,
                "conference": element_model.new_conference(),
                "updated_at": utcnow(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return await _out_for(scope, doc)


@router.patch("/elements/{element_id}/spec", response_model=ElementOut)
async def apply_spec(
    element_id: str,
    payload: SpecIn,
    scope: CurrentScope,
    user: CurrentUser,
) -> ElementOut:
    """Aplica material, acabamento e marca do catálogo no elemento.

    PATCH parcial pelo campo *enviado*, não pelo valor: mandar `finish_id:
    null` limpa o acabamento, e omitir o campo deixa como estava. Por isso a
    leitura é de `model_fields_set`.

    Só ids são gravados. Nome e cor continuam morando no catálogo e são
    resolvidos na resposta — assim o elemento nunca guarda uma cor que o
    cadastro já corrigiu.

    Aplicar spec é trabalho de levantamento, então o editor pode. Quem não pode
    é criar item de catálogo: isso é do owner, no router de catálogo.
    """
    element = await get_element_doc(scope, element_id)
    current = element.get("spec") or catalog_model.empty_spec()
    sent = payload.model_fields_set

    material_id = payload.material_id if "material_id" in sent else current.get("material_id")
    finish_id = payload.finish_id if "finish_id" in sent else current.get("finish_id")
    brand_id = payload.brand_id if "brand_id" in sent else current.get("brand_id")

    # Cada id precisa existir neste tenant: 404 do próprio catálogo se não existir.
    material = await get_material_doc(scope, material_id) if material_id else None
    finish = await get_finish_doc(scope, finish_id) if finish_id else None
    if brand_id:
        await get_brand_doc(scope, brand_id)

    if finish is not None:
        # Acabamento é variante de um material: sem material escolhido não há o
        # que variar, e de outro material seria uma combinação que não existe.
        if material is None:
            _reject(
                f"O acabamento {finish['name']!r} é variante de um material, e nenhum material "
                "ficou escolhido. Escolha o material ou limpe o acabamento junto."
            )
        if finish["material_id"] != str(material["_id"]):
            _reject(
                f"O acabamento {finish['name']!r} não é do material {material['name']!r}. "
                "Escolha um acabamento desse material."
            )

    doc = await get_db()[element_model.COLLECTION].find_one_and_update(
        scope.filter(_id=element["_id"], deleted_at=None),
        {
            "$set": {
                "spec": catalog_model.spec_fields(
                    material_id=material_id,
                    finish_id=finish_id,
                    brand_id=brand_id,
                    applied_by=str(user["_id"]),
                ),
                "updated_at": utcnow(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return await _out_for(scope, doc)


@router.post("/elements/{element_id}/conference", response_model=ElementOut)
async def set_conference(
    element_id: str,
    payload: ConferenceIn,
    scope: CurrentScope,
    user: CurrentUser,
) -> ElementOut:
    """Marca o elemento como conferido ou devolve para pendente.

    Conferir é dizer "olhei esses números e eles estão certos". Sem número
    nenhum salvo não há o que conferir, então a API recusa (422) em vez de
    gravar um selo vazio. Medida estimada pode ser conferida — o que se confere
    é que a estimativa é aceitável —, e ela continua rotulada como estimativa
    na tela e nos dados.
    """
    element = await get_element_doc(scope, element_id)

    confirming = payload.status == element_model.CONFERENCE_CONFIRMED
    if confirming and not element_model.has_any_measurement(element.get("measurements")):
        _reject(NOTHING_TO_CONFIRM)

    doc = await get_db()[element_model.COLLECTION].find_one_and_update(
        scope.filter(_id=element["_id"], deleted_at=None),
        {
            "$set": {
                "conference": element_model.new_conference(
                    payload.status, by=str(user["_id"])
                ),
                "updated_at": utcnow(),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return await _out_for(scope, doc)
