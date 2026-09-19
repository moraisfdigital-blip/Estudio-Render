"""Rotas de `calibrations` — a escala da foto, medida por gente.

Duas rotas: carregar a calibração da foto e salvar/substituir a calibração da
foto. Uma calibração por foto (índice único em `tenant_id` + `photo_id`), então
o PUT é upsert — recalibrar é corrigir o mesmo registro, não empilhar versões.

## O que este módulo **não** faz

Não estima medida. Não deriva `real_length` de EXIF, de tamanho de arquivo, de
outra foto do projeto ou de qualquer heurística. O único caminho de entrada de
`real_length` é o corpo do PUT, preenchido pelo usuário na tela. Se algum dia
uma fase pedir "sugestão automática de medida", isso é decisão de produto e
muda a regra do blueprint — não se resolve aqui dentro.

## O original continua intocado

A calibração é um documento novo no Mongo. O arquivo da foto é aberto **só para
leitura**, e só para descobrir largura e altura (`app.core.imagesize`), o que
permite recusar ponto fora da imagem. Nenhum byte do original é reescrito.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.api.deps import CurrentScope, CurrentUser
from app.api.routers.photos import get_photo_doc
from app.core import imagesize, media
from app.core.clock import as_utc, utcnow
from app.core.db import get_db
from app.core.tenancy import TenantScope
from app.models import calibration as calibration_model
from app.schemas.calibration import CalibrationIn, CalibrationOut, Point

router = APIRouter()

FILE_GONE = "O arquivo original desta foto não está acessível no storage."
UNREADABLE = "Não foi possível ler as dimensões da foto original."


def _empty(photo_id: str, scope: TenantScope) -> CalibrationOut:
    """Estado "não calibrado": 200 com `calibrated=false`.

    Poderia ser 404, mas foto sem calibração é o estado inicial normal de toda
    foto — não é erro. A tela precisa distinguir "ainda não calibrada" de "essa
    foto não existe / não é sua", e com 404 nos dois casos ela não distingue.
    """
    return CalibrationOut(photo_id=photo_id, tenant_id=scope.tenant_id, calibrated=False)


def _to_out(doc: dict[str, Any]) -> CalibrationOut:
    return CalibrationOut(
        photo_id=doc["photo_id"],
        tenant_id=doc["tenant_id"],
        calibrated=True,
        point_a=Point(**doc["point_a"]),
        point_b=Point(**doc["point_b"]),
        real_length=doc["real_length"],
        unit=doc["unit"],
        pixel_distance=doc["pixel_distance"],
        pixels_per_unit=doc["pixels_per_unit"],
        pixels_per_meter=doc["pixels_per_meter"],
        source=doc["source"],
        image_width=doc["image_width"],
        image_height=doc["image_height"],
        updated_at=as_utc(doc["updated_at"]),
    )


def _original_dimensions(photo: dict[str, Any]) -> tuple[int, int]:
    """Largura e altura do original. Leitura pura — o arquivo não é tocado."""
    try:
        path = media.resolve(photo["storage_key"])
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=FILE_GONE) from None
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=FILE_GONE)

    try:
        return imagesize.read_dimensions(path)
    except imagesize.UnreadableImage:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=UNREADABLE
        ) from None


def _reject(detail: str) -> None:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


@router.get("/photos/{photo_id}/calibration", response_model=CalibrationOut)
async def get_calibration(photo_id: str, scope: CurrentScope) -> CalibrationOut:
    """Calibração da foto, ou o estado "não calibrado" (200, `calibrated=false`)."""
    await get_photo_doc(scope, photo_id)

    doc = await get_db()[calibration_model.COLLECTION].find_one(scope.filter(photo_id=photo_id))
    return _to_out(doc) if doc else _empty(photo_id, scope)


@router.put("/photos/{photo_id}/calibration", response_model=CalibrationOut)
async def save_calibration(
    photo_id: str,
    payload: CalibrationIn,
    scope: CurrentScope,
    user: CurrentUser,
) -> CalibrationOut:
    """Salva os dois pontos + a medida informada e devolve o fator calculado.

    `pixels_per_unit` sai daqui calculado a partir do que o usuário marcou e
    digitou — o cliente não consegue enviá-lo (o schema recusa campo extra).
    """
    photo = await get_photo_doc(scope, photo_id)
    width, height = _original_dimensions(photo)

    point_a = payload.point_a.as_tuple()
    point_b = payload.point_b.as_tuple()

    # Ponto fora da foto significaria escala calculada sobre coordenada que não
    # existe na imagem. Recusar é melhor do que gravar um fator impossível.
    for label, (x, y) in (("A", point_a), ("B", point_b)):
        if x > width or y > height:
            _reject(
                f"O ponto {label} está fora da foto "
                f"({x:.0f}, {y:.0f} em uma imagem de {width}×{height} px)."
            )

    distance = calibration_model.pixel_distance(point_a, point_b)
    if distance < calibration_model.MIN_PIXEL_DISTANCE:
        _reject(
            "Os dois pontos estão praticamente no mesmo lugar "
            f"({distance:.1f} px). Marque pontos mais afastados para a escala ter sentido."
        )

    fields = calibration_model.calibration_fields(
        point_a=point_a,
        point_b=point_b,
        real_length=payload.real_length,
        unit=payload.unit,
        image_width=width,
        image_height=height,
        measured_by=str(user["_id"]),
    )
    # Contexto da foto desnormalizado: as fases seguintes leem calibração por
    # projeto sem precisar de join com `photos`.
    fields["area_id"] = photo["area_id"]
    fields["project_id"] = photo["project_id"]

    collection = get_db()[calibration_model.COLLECTION]
    update = {"$set": fields, "$setOnInsert": {"created_at": utcnow()}}
    # `tenant_id` e `photo_id` vêm do filtro do upsert — repeti-los no
    # `$setOnInsert` criaria conflito de path no Mongo.
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
            scope.filter(photo_id=photo_id),
            update,
            return_document=ReturnDocument.AFTER,
        )
        if doc is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Não foi possível salvar a calibração. Tente de novo.",
            ) from None

    return _to_out(doc)
