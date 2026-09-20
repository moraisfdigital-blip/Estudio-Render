"""Rotas de `photos` — upload, metadados, download do original e remoção.

Regra inegociável do blueprint: **a foto original nunca é sobrescrita nem
editada**. Este router só sabe *criar* e *ler* binário; não existe aqui nenhum
caminho que escreva por cima de um original, e o DELETE não encosta no disco.

Fases seguintes (calibração, máscaras, geração) leem o original por
`app.core.media.resolve(storage_key)` e gravam seus resultados como arquivos
novos em `<uid>/derived/`, jamais no lugar do original.
"""

import uuid
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response

from app.api.deps import CurrentScope, CurrentUser
from app.api.routers.areas import get_area_doc
from app.core import imagesize, media
from app.core.clock import as_utc, utcnow
from app.core.config import get_settings
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import calibration as calibration_model
from app.models import element as element_model
from app.models import mask as mask_model
from app.models import photo as photo_model
from app.schemas.photo import MediaLimitsOut, PhotoOut

router = APIRouter()

NOT_FOUND = "Foto não encontrada neste workspace."
FILE_GONE = "O arquivo original desta foto não está acessível no storage."
UNREADABLE = "Não foi possível ler as dimensões da foto original."


def _to_out(
    doc: dict[str, Any],
    calibrated: bool = False,
    element_count: int = 0,
    intervention_count: int = 0,
) -> PhotoOut:
    photo_id = str(doc["_id"])
    return PhotoOut(
        id=photo_id,
        tenant_id=doc["tenant_id"],
        area_id=doc["area_id"],
        project_id=doc["project_id"],
        original_filename=doc["original_filename"],
        content_type=doc["content_type"],
        size_bytes=doc["size_bytes"],
        checksum_sha256=doc["checksum_sha256"],
        created_at=as_utc(doc["created_at"]),
        original_url=f"/api/photos/{photo_id}/original",
        calibrated=calibrated,
        element_count=element_count,
        intervention_count=intervention_count,
    )


async def _calibrated_ids(scope: TenantScope, photo_ids: list[str]) -> set[str]:
    """Quais dessas fotos já têm escala — numa query só, em vez de uma por foto."""
    if not photo_ids:
        return set()
    cursor = get_db()[calibration_model.COLLECTION].find(
        scope.filter(photo_id={"$in": photo_ids}), {"photo_id": 1}
    )
    return {doc["photo_id"] async for doc in cursor}


async def _intervention_counts(scope: TenantScope, photo_ids: list[str]) -> dict[str, int]:
    """Recortes de intervenção por foto, numa agregação só.

    Conta só a camada `intervention`: é ela que diz se a Fase 9 tem onde
    escrever. Camada de proteção não libera geração nenhuma — sozinha, ela só
    diz onde *não* mexer.
    """
    if not photo_ids:
        return {}
    pipeline = [
        {"$match": scope.filter(photo_id={"$in": photo_ids})},
        {"$project": {
            "photo_id": 1,
            "total": {
                "$size": {
                    "$filter": {
                        "input": {"$ifNull": ["$layers", []]},
                        "cond": {"$eq": ["$$this.kind", mask_model.INTERVENTION]},
                    }
                }
            },
        }},
    ]
    cursor = get_db()[mask_model.COLLECTION].aggregate(pipeline)
    return {doc["photo_id"]: doc["total"] async for doc in cursor}


async def _element_counts(scope: TenantScope, photo_ids: list[str]) -> dict[str, int]:
    """Elementos ativos por foto, numa agregação só (não um count por foto)."""
    if not photo_ids:
        return {}
    pipeline = [
        {"$match": scope.filter(photo_id={"$in": photo_ids}, deleted_at=None)},
        {"$group": {"_id": "$photo_id", "total": {"$sum": 1}}},
    ]
    cursor = get_db()[element_model.COLLECTION].aggregate(pipeline)
    return {doc["_id"]: doc["total"] async for doc in cursor}


async def get_photo_doc(scope: TenantScope, photo_id: str) -> dict[str, Any]:
    """Foto ativa do tenant ou 404. Soft-deleted responde 404 como se não existisse."""
    oid = parse_object_id(photo_id, detail=NOT_FOUND)
    doc = await get_db()[photo_model.COLLECTION].find_one(scope.filter(_id=oid, deleted_at=None))
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return doc


def original_dimensions(photo: dict[str, Any]) -> tuple[int, int]:
    """Largura e altura do original, em pixels. Leitura pura: o arquivo não é tocado.

    Quem marca coisa sobre a foto (calibração, elemento, e as máscaras da Fase
    8) precisa recusar coordenada fora da imagem, e para isso precisa do
    tamanho real do arquivo — não do que o cliente disse que ele tem.
    """
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
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=UNREADABLE
        ) from None


def _safe_filename(raw: str | None) -> str:
    """Nome só para exibir e para o `Content-Disposition` do download.

    Não é usado para montar caminho nenhum — o caminho no disco vem de um UUID
    do servidor —, mas mesmo assim tiramos diretório e caracteres de controle
    para não devolver lixo no header nem na tela.
    """
    name = (raw or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(character for character in name if character.isprintable()).strip()
    return name[:200] or "foto"


@router.get("/media/limits", response_model=MediaLimitsOut)
async def get_media_limits(scope: CurrentScope) -> MediaLimitsOut:
    """Limites de upload para a tela conferir o arquivo **antes** de subir.

    Existe para o frontend não repetir número nenhum: tipo aceito e tamanho
    máximo vivem só no env do servidor. O cliente valida por gentileza (erro
    imediato, sem gastar upload); quem realmente decide continua sendo a API.
    """
    settings = get_settings()
    return MediaLimitsOut(
        max_upload_mb=settings.max_upload_mb,
        accepted_content_types=list(media.accepted_content_types()),
        accepted_labels=list(settings.allowed_image_labels),
    )


@router.post(
    "/areas/{area_id}/photos", response_model=PhotoOut, status_code=status.HTTP_201_CREATED
)
async def upload_photo(
    area_id: str,
    scope: CurrentScope,
    user: CurrentUser,
    file: UploadFile = File(..., description="Arquivo de imagem (JPEG, PNG ou WebP)."),
) -> PhotoOut:
    """Grava o original **uma vez** e cria o registro de metadados.

    Ordem importa: o arquivo é escrito antes do insert. Se o insert falhar,
    sobra um arquivo órfão no disco — inofensivo — em vez de um documento
    apontando para um binário que não existe, que quebraria a calibração depois.
    """
    settings = get_settings()
    area = await get_area_doc(scope, area_id)

    header = await file.read(media.SNIFF_BYTES)
    try:
        content_type, extension = media.sniff_image(header)
    except media.UnsupportedMedia:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                "Formato não aceito. Envie uma imagem "
                f"{', '.join(settings.allowed_image_labels)}."
            ),
        ) from None

    max_bytes = settings.max_upload_mb * 1024 * 1024
    try:
        stored = await media.write_once(
            key=media.build_original_key(
                tenant_id=scope.tenant_id,
                photo_uid=uuid.uuid4().hex,
                extension=extension,
            ),
            chunks=media.restream(file, header),
            max_bytes=max_bytes,
        )
    except media.MediaTooLarge:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Arquivo maior que o limite de {settings.max_upload_mb} MB por foto.",
        ) from None

    doc = scope.stamp(
        photo_model.new_photo_doc(
            area_id=area_id,
            project_id=area["project_id"],
            original_filename=_safe_filename(file.filename),
            content_type=content_type,
            size_bytes=stored.size_bytes,
            checksum_sha256=stored.checksum_sha256,
            storage_key=stored.key,
            uploaded_by=str(user["_id"]),
        )
    )
    result = await get_db()[photo_model.COLLECTION].insert_one(doc)
    return _to_out({**doc, "_id": result.inserted_id})


@router.get("/areas/{area_id}/photos", response_model=list[PhotoOut])
async def list_area_photos(area_id: str, scope: CurrentScope) -> list[PhotoOut]:
    """Grid da área: só as fotos ativas, mais recentes primeiro."""
    await get_area_doc(scope, area_id)

    cursor = (
        get_db()[photo_model.COLLECTION]
        .find(scope.filter(area_id=area_id, deleted_at=None))
        .sort("created_at", -1)
    )
    docs = [doc async for doc in cursor]
    photo_ids = [str(doc["_id"]) for doc in docs]
    calibrated = await _calibrated_ids(scope, photo_ids)
    counts = await _element_counts(scope, photo_ids)
    mascaras = await _intervention_counts(scope, photo_ids)
    return [
        _to_out(
            doc,
            str(doc["_id"]) in calibrated,
            counts.get(str(doc["_id"]), 0),
            mascaras.get(str(doc["_id"]), 0),
        )
        for doc in docs
    ]


@router.get("/photos/{photo_id}", response_model=PhotoOut)
async def get_photo(photo_id: str, scope: CurrentScope) -> PhotoOut:
    doc = await get_photo_doc(scope, photo_id)
    calibrated = await _calibrated_ids(scope, [photo_id])
    counts = await _element_counts(scope, [photo_id])
    mascaras = await _intervention_counts(scope, [photo_id])
    return _to_out(
        doc, photo_id in calibrated, counts.get(photo_id, 0), mascaras.get(photo_id, 0)
    )


@router.get("/photos/{photo_id}/original")
async def get_photo_original(photo_id: str, scope: CurrentScope, request: Request) -> Response:
    """Devolve o binário original, byte a byte, como foi gravado no upload.

    O `ETag` é o próprio SHA-256 do upload: o cliente que já tem esse hash
    recebe 304 e o navegador nunca serve uma versão diferente sob o mesmo id.
    """
    doc = await get_photo_doc(scope, photo_id)

    try:
        path = media.resolve(doc["storage_key"])
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=FILE_GONE) from None
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=FILE_GONE)

    etag = '"' + doc["checksum_sha256"] + '"'
    if request.headers.get("if-none-match") == etag:
        # 304 não leva corpo — devolver um FileResponse aqui reabriria o arquivo à toa.
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})

    return FileResponse(
        path,
        media_type=doc["content_type"],
        filename=doc["original_filename"],
        # inline: o grid e o visualizador abrem a foto; o usuário ainda pode
        # salvar pelo navegador.
        content_disposition_type="inline",
        headers={"ETag": etag, "Cache-Control": "private, max-age=3600"},
    )


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(photo_id: str, scope: CurrentScope, user: CurrentUser) -> None:
    """Remove a foto do levantamento — **só o registro**.

    Soft-delete: marca `deleted_at` e quem removeu. O binário original continua
    no disco, intocado e somente-leitura. O blueprint proíbe editar o original;
    apagar o arquivo seria a forma definitiva de perdê-lo, então a API não faz
    isso. Expurgo de arquivo, se um dia existir, é rotina administrativa
    explícita e fora do fluxo do usuário.
    """
    oid = parse_object_id(photo_id, detail=NOT_FOUND)
    result = await get_db()[photo_model.COLLECTION].update_one(
        scope.filter(_id=oid, deleted_at=None),
        {"$set": {"deleted_at": utcnow(), "deleted_by": str(user["_id"])}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
