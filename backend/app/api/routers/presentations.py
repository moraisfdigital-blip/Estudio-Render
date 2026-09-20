"""Rotas da apresentação — preview, PDF e link interno.

Uma apresentação por projeto. Ela reúne as **versões aprovadas** das fotos e é
o que vai para o cliente.

## A regra desta fase

Slide só aponta para versão aprovada. Salvar um slide com outra versão é 422 —
sem isso, a apresentação poderia levar uma proposta que ninguém escolheu, e o
trabalho de aprovar (Fase 10) perderia o sentido.

E como a aprovação mora na foto, trocar a versão aprovada **depois** de montar
a apresentação desatualiza o slide. A leitura marca esse slide como `outdated`
em vez de exibir em silêncio uma imagem que não é mais a escolha registrada.

## Começa montada

Sem nada salvo, o GET devolve um rascunho: as versões aprovadas do projeto na
ordem em que as fotos foram enviadas. Quem só quer exportar não precisa montar
nada; quem quer ordenar ou legendar, salva.

## O link é interno

`POST /presentation/share-link` cria um token e `GET /api/p/{token}` abre — mas
**exigindo login do tenant**. O token identifica a apresentação numa URL curta;
ele não é credencial. Um link vazado não serve para ninguém de fora da ARTELUX.
"""

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse, Response
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.adapters.pdf import PdfError, PdfRequest, PdfSlide, get_pdf_adapter
from app.api.deps import CurrentScope, CurrentUser
from app.api.routers.projects import get_project_doc
from app.core import media
from app.core.clock import as_utc, utcnow
from app.core.config import get_settings
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import client as client_model
from app.models import location as location_model
from app.models import photo as photo_model
from app.models import presentation as presentation_model
from app.models import proposal as proposal_model
from app.models import version as version_model
from app.schemas.presentation import (
    MAX_SLIDES,
    PdfOut,
    PresentationIn,
    PresentationOut,
    ShareLinkOut,
    SlideOut,
)

router = APIRouter()

NOT_FOUND = "Apresentação não encontrada neste workspace."
PDF_MISSING = "Esta apresentação ainda não foi exportada em PDF."
PDF_GONE = "O arquivo do PDF não está acessível no storage."


def _reject(detail: str) -> None:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


async def _photos_of(scope: TenantScope, project_id: str) -> list[dict[str, Any]]:
    """Fotos ativas do projeto, na ordem em que foram enviadas."""
    cursor = (
        get_db()[photo_model.COLLECTION]
        .find(scope.filter(project_id=project_id, deleted_at=None))
        .sort("created_at", 1)
        # Teto do rascunho: o schema já limita a apresentação a MAX_SLIDES, e
        # carregar mais fotos do que isso só para descartá-las seria trabalho
        # jogado fora.
        .limit(MAX_SLIDES)
    )
    return [doc async for doc in cursor]


async def _versions_by_id(scope: TenantScope, ids: list[str]) -> dict[str, dict[str, Any]]:
    """Versões dos slides numa query só."""
    if not ids:
        return {}
    oids = [parse_object_id(value, detail=NOT_FOUND) for value in set(ids)]
    cursor = get_db()[version_model.COLLECTION].find(scope.filter(_id={"$in": oids}))
    return {str(doc["_id"]): doc async for doc in cursor}


async def _images_by_id(scope: TenantScope, ids: list[str]) -> dict[str, dict[str, Any]]:
    """Imagens geradas dos slides numa query só."""
    if not ids:
        return {}
    oids = [parse_object_id(value, detail=NOT_FOUND) for value in set(ids)]
    cursor = get_db()[proposal_model.GENERATED_IMAGES].find(scope.filter(_id={"$in": oids}))
    return {str(doc["_id"]): doc async for doc in cursor}


async def _name_of(scope: TenantScope, collection: str, doc_id: str | None) -> str | None:
    if not doc_id:
        return None
    doc = await get_db()[collection].find_one(
        scope.filter(_id=parse_object_id(doc_id, detail=NOT_FOUND)), {"name": 1}
    )
    return doc["name"] if doc else None


def _rascunho(fotos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Slides derivados das versões aprovadas, na ordem das fotos."""
    return [
        presentation_model.new_slide(
            photo_id=str(foto["_id"]), version_id=foto["approved_version_id"], caption=None
        )
        for foto in fotos
        if foto.get("approved_version_id")
    ]


async def _build_out(
    scope: TenantScope,
    project: dict[str, Any],
    doc: dict[str, Any] | None,
) -> PresentationOut:
    """Monta a resposta, resolvendo slides contra o estado atual da aprovação."""
    project_id = str(project["_id"])
    fotos = await _photos_of(scope, project_id)
    por_id = {str(foto["_id"]): foto for foto in fotos}
    aprovadas = sum(1 for foto in fotos if foto.get("approved_version_id"))

    slides_doc = (doc or {}).get("slides")
    # Sem nada salvo, o rascunho é a própria lista de aprovadas.
    slides_doc = slides_doc if slides_doc else _rascunho(fotos)

    versoes = await _versions_by_id(scope, [s["version_id"] for s in slides_doc])
    imagens = await _images_by_id(
        scope, [v["generated_image_id"] for v in versoes.values()]
    )

    slides: list[SlideOut] = []
    for posicao, slide in enumerate(slides_doc, start=1):
        foto = por_id.get(slide["photo_id"])
        versao = versoes.get(slide["version_id"])
        if foto is None or versao is None:
            # Foto removida ou versão descartada: o slide sai da apresentação
            # em vez de virar uma página quebrada no PDF do cliente.
            continue
        imagem = imagens.get(versao["generated_image_id"])
        slides.append(
            SlideOut(
                position=posicao,
                photo_id=slide["photo_id"],
                version_id=slide["version_id"],
                label=versao["label"],
                caption=slide.get("caption"),
                original_filename=foto["original_filename"],
                original_url=f"/api/photos/{slide['photo_id']}/original",
                image_url=(
                    f"/api/generated-images/{versao['generated_image_id']}" if imagem else None
                ),
                area_id=foto["area_id"],
                # A escolha pode ter mudado depois de a apresentação ser salva.
                outdated=foto.get("approved_version_id") != slide["version_id"],
            )
        )

    bloqueio = None if aprovadas else presentation_model.NO_APPROVED_VERSION
    pdf = (doc or {}).get("pdf")
    share_token = (doc or {}).get("share_token")

    return PresentationOut(
        project_id=project_id,
        tenant_id=scope.tenant_id,
        title=(doc or {}).get("title")
        or presentation_model.default_title(project.get("name", "")),
        notes=(doc or {}).get("notes"),
        slides=slides,
        saved=bool(doc and doc.get("slides")),
        approved_count=aprovadas,
        can_export=bool(slides) and bloqueio is None,
        blocked_reason=bloqueio,
        pdf=(
            PdfOut(
                url=f"/api/presentations/{project_id}/pdf",
                size_bytes=pdf["size_bytes"],
                checksum_sha256=pdf["checksum_sha256"],
                provider=pdf["provider"],
                page_count=pdf["page_count"],
                generated_at=as_utc(pdf["generated_at"]),
            )
            if pdf
            else None
        ),
        share=(
            ShareLinkOut(
                url=f"/api/p/{share_token}",
                token=share_token,
                created_at=as_utc(doc["share_created_at"]),
            )
            if share_token
            else None
        ),
        updated_at=as_utc(doc["updated_at"]) if doc and doc.get("updated_at") else None,
    )


async def get_presentation_doc(
    scope: TenantScope, project_id: str
) -> dict[str, Any] | None:
    return await get_db()[presentation_model.COLLECTION].find_one(
        scope.filter(project_id=project_id)
    )


@router.get("/projects/{project_id}/presentation", response_model=PresentationOut)
async def get_presentation(project_id: str, scope: CurrentScope) -> PresentationOut:
    """Apresentação do projeto, ou o rascunho montado das versões aprovadas."""
    project = await get_project_doc(scope, project_id)
    return await _build_out(scope, project, await get_presentation_doc(scope, project_id))


@router.put("/projects/{project_id}/presentation", response_model=PresentationOut)
async def save_presentation(
    project_id: str, payload: PresentationIn, scope: CurrentScope, user: CurrentUser
) -> PresentationOut:
    """Salva título, notas e a ordem dos slides.

    Cada slide é conferido contra a aprovação vigente: apontar para uma versão
    que não é a aprovada daquela foto é 422. É aqui que a regra da fase vive.
    """
    project = await get_project_doc(scope, project_id)
    fotos = {str(foto["_id"]): foto for foto in await _photos_of(scope, project_id)}

    slides = []
    for posicao, entrada in enumerate(payload.slides, start=1):
        foto = fotos.get(entrada.photo_id)
        if foto is None:
            _reject(f"O slide {posicao} aponta para uma foto que não é deste projeto.")
        if foto.get("approved_version_id") != entrada.version_id:
            _reject(presentation_model.SLIDE_NOT_APPROVED.format(posicao=posicao))
        slides.append(
            presentation_model.new_slide(
                photo_id=entrada.photo_id,
                version_id=entrada.version_id,
                caption=entrada.caption,
            )
        )

    fields = presentation_model.presentation_fields(
        title=payload.title or presentation_model.default_title(project.get("name", "")),
        notes=payload.notes,
        slides=slides,
        updated_by=str(user["_id"]),
    )
    update = {"$set": fields, "$setOnInsert": {"created_at": utcnow()}}
    collection = get_db()[presentation_model.COLLECTION]
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
                detail="Não foi possível salvar a apresentação. Tente de novo.",
            ) from None

    return await _build_out(scope, project, doc)


@router.post("/projects/{project_id}/presentation/export", response_model=PresentationOut)
async def export_presentation(
    project_id: str, scope: CurrentScope, user: CurrentUser
) -> PresentationOut:
    """Exporta o PDF da apresentação.

    Sem versão aprovada, recusa com 422 — não existe apresentação de uma
    escolha que ninguém fez. Exportar de novo grava arquivo novo; o anterior
    continua no disco.
    """
    project = await get_project_doc(scope, project_id)
    doc = await get_presentation_doc(scope, project_id)
    atual = await _build_out(scope, project, doc)

    if atual.blocked_reason:
        _reject(atual.blocked_reason)
    if not atual.slides:
        _reject("A apresentação não tem slides para exportar.")

    # As imagens vão em bytes para o adapter: um provedor externo receberia
    # exatamente isso, e o mock desenha a partir daí.
    slides_pdf = []
    for slide in atual.slides:
        conteudo = None
        if slide.image_url:
            image_id = slide.image_url.rsplit("/", 1)[-1]
            imagens = await _images_by_id(scope, [image_id])
            imagem = imagens.get(image_id)
            if imagem:
                caminho = media.resolve(imagem["storage_key"])
                if caminho.is_file():
                    conteudo = caminho.read_bytes()
        slides_pdf.append(
            PdfSlide(
                label=f"{slide.original_filename} — {slide.label}",
                caption=slide.caption,
                image_bytes=conteudo,
            )
        )

    adapter = get_pdf_adapter()
    try:
        resultado = await adapter.render(
            PdfRequest(
                title=atual.title,
                project_name=project.get("name", ""),
                client_name=await _name_of(
                    scope, client_model.COLLECTION, project.get("client_id")
                ),
                location_name=await _name_of(
                    scope, location_model.COLLECTION, project.get("location_id")
                ),
                notes=atual.notes,
                slides=slides_pdf,
            )
        )
    except PdfError as erro:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"O provedor de PDF falhou: {erro}",
        ) from None

    stored = await media.write_once(
        key=media.build_presentation_pdf_key(
            tenant_id=scope.tenant_id, project_id=project_id, pdf_uid=uuid.uuid4().hex
        ),
        chunks=media.single_chunk(resultado.pdf_bytes),
        max_bytes=get_settings().max_upload_mb * 1024 * 1024,
    )

    update = {
        "$set": {
            "pdf": presentation_model.pdf_fields(
                storage_key=stored.key,
                size_bytes=stored.size_bytes,
                checksum_sha256=stored.checksum_sha256,
                provider=resultado.provider,
                page_count=resultado.page_count,
                generated_by=str(user["_id"]),
            ),
            "updated_at": utcnow(),
        },
        # Exportar sem ter salvo grava o rascunho como o que foi exportado —
        # o PDF e a apresentação não podem contar histórias diferentes.
        "$setOnInsert": {
            "created_at": utcnow(),
            "title": atual.title,
            "notes": atual.notes,
            "slides": [
                presentation_model.new_slide(
                    photo_id=slide.photo_id,
                    version_id=slide.version_id,
                    caption=slide.caption,
                )
                for slide in atual.slides
            ],
        },
    }
    novo = await get_db()[presentation_model.COLLECTION].find_one_and_update(
        scope.filter(project_id=project_id),
        update,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return await _build_out(scope, project, novo)


@router.get("/presentations/{project_id}/pdf")
async def download_pdf(project_id: str, scope: CurrentScope, request: Request) -> Response:
    """Baixa o PDF exportado, com o SHA-256 como ETag."""
    await get_project_doc(scope, project_id)
    doc = await get_presentation_doc(scope, project_id)
    pdf = (doc or {}).get("pdf")
    if not pdf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=PDF_MISSING)

    try:
        caminho = media.resolve(pdf["storage_key"])
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=PDF_GONE) from None
    if not caminho.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=PDF_GONE)

    etag = '"' + pdf["checksum_sha256"] + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})

    return FileResponse(
        caminho,
        media_type="application/pdf",
        filename=f"{(doc or {}).get('title', 'apresentacao')}.pdf",
        content_disposition_type="inline",
        headers={"ETag": etag, "Cache-Control": "private, max-age=3600"},
    )


@router.post(
    "/projects/{project_id}/presentation/share-link", response_model=PresentationOut
)
async def create_share_link(
    project_id: str, scope: CurrentScope, user: CurrentUser
) -> PresentationOut:
    """Cria (ou renova) o link interno da apresentação.

    O token deixa a URL curta e estável; **quem autoriza é o login**. Chamar de
    novo gera um token novo, o que invalida o link anterior — é assim que se
    revoga um link que circulou demais.
    """
    project = await get_project_doc(scope, project_id)
    update = {
        "$set": {
            **presentation_model.share_fields(
                token=presentation_model.new_token(), created_by=str(user["_id"])
            ),
            "updated_at": utcnow(),
        },
        "$setOnInsert": {"created_at": utcnow()},
    }
    doc = await get_db()[presentation_model.COLLECTION].find_one_and_update(
        scope.filter(project_id=project_id),
        update,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return await _build_out(scope, project, doc)


@router.get("/p/{token}", response_model=PresentationOut)
async def open_shared(token: str, scope: CurrentScope) -> PresentationOut:
    """Abre a apresentação pelo link interno.

    Exige token JWT como qualquer outra rota, e o filtro é escopado por tenant:
    um link da ARTELUX aberto por outro workspace responde 404. O token da URL
    identifica; ele não autentica.
    """
    doc = await get_db()[presentation_model.COLLECTION].find_one(
        scope.filter(share_token=token)
    )
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)

    project = await get_project_doc(scope, doc["project_id"])
    return await _build_out(scope, project, doc)
