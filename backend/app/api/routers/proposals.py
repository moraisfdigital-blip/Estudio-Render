"""Rotas de geração — Prompt Engine + adapter + Architecture Lock.

O caminho completo de um `POST /photos/{id}/proposals`:

1. carrega foto, projeto, máscaras, calibração e elementos **já persistidos**;
2. `mask_model.generation_block()` decide se pode gerar — sem máscara de
   intervenção ou com o lock desligado, responde **422** e para aqui;
3. `prompt_engine.build()` monta o pedido a partir desses dados;
4. o adapter gera (em modo mock, sem tocar a rede);
5. `imaging.compose_locked()` aplica o retorno **só** sob a máscara;
6. o resultado é gravado como arquivo novo e vira `GeneratedImage`.

O passo 5 é o que torna o Architecture Lock estrutural. Mesmo que o provedor
devolva uma imagem inteiramente diferente, só os pixels da área de intervenção
sobrevivem — a fachada do cliente não depende do comportamento de um serviço
externo.

## Sem corpo no POST

A rota não aceita payload. Não há campo para o cliente mandar prompt, escolher
área ou pedir "ignore a máscara": tudo vem do banco. É o que impede contornar
o lock por parâmetro.

## Falha do provedor vira registro

Erro do adapter não some: a proposta fica gravada com `status="falhou"` e o
motivo, e a rota responde 502. Uma tentativa que deu errado é história do
projeto, não um buraco.
"""

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse, Response
from pymongo import ReturnDocument

from app.adapters.image_gen import (
    GenerationRequest,
    ImageGenError,
    get_image_gen_adapter,
)
from app.api.pagination import PageDep
from app.api.deps import CurrentScope, CurrentUser
from app.api.routers.elements import catalog_index_for
from app.api.routers.masks import get_mask_doc
from app.api.routers.photos import get_photo_doc
from app.api.routers.projects import get_project_doc
from app.core import imaging, media, prompt_engine
from app.core.clock import as_utc
from app.core.config import get_settings
from app.core.db import get_db
from app.core.ids import parse_object_id
from app.core.tenancy import TenantScope
from app.models import calibration as calibration_model
from app.models import element as element_model
from app.models import mask as mask_model
from app.models import project as project_model
from app.models import proposal as proposal_model
from app.schemas.proposal import (
    CompareOut,
    GeneratedImageOut,
    PromptOut,
    ProposalOut,
)

router = APIRouter()

PROPOSAL_NOT_FOUND = "Proposta não encontrada neste workspace."
IMAGE_NOT_FOUND = "Imagem gerada não encontrada neste workspace."
FILE_GONE = "O arquivo desta imagem gerada não está acessível no storage."


def _generated_out(doc: dict[str, Any]) -> GeneratedImageOut:
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


def _prompt_out(prompt: dict[str, Any]) -> PromptOut:
    sections = prompt.get("sections", {})
    return PromptOut(
        text=prompt.get("text", ""),
        instrucao=sections.get("instrucao", ""),
        projeto=sections.get("projeto", ""),
        intervencao=sections.get("intervencao", []),
        protecao=sections.get("protecao", []),
        pecas=sections.get("pecas", []),
        escala=sections.get("escala"),
    )


def _proposal_out(doc: dict[str, Any], imagem: dict[str, Any] | None) -> ProposalOut:
    return ProposalOut(
        id=str(doc["_id"]),
        tenant_id=doc["tenant_id"],
        photo_id=doc["photo_id"],
        project_id=doc["project_id"],
        status=doc["status"],
        status_label=proposal_model.STATUS_LABELS.get(doc["status"], doc["status"]),
        provider=doc["provider"],
        prompt=_prompt_out(doc.get("prompt") or {}),
        generated_image=_generated_out(imagem) if imagem else None,
        error=doc.get("error"),
        created_at=as_utc(doc["created_at"]),
        completed_at=as_utc(doc["completed_at"]) if doc.get("completed_at") else None,
    )


async def _with_image(scope: TenantScope, doc: dict[str, Any]) -> ProposalOut:
    imagem = None
    if doc.get("generated_image_id"):
        imagem = await get_db()[proposal_model.GENERATED_IMAGES].find_one(
            scope.filter(_id=parse_object_id(doc["generated_image_id"], detail=IMAGE_NOT_FOUND))
        )
    return _proposal_out(doc, imagem)


async def get_proposal_doc(scope: TenantScope, proposal_id: str) -> dict[str, Any]:
    oid = parse_object_id(proposal_id, detail=PROPOSAL_NOT_FOUND)
    doc = await get_db()[proposal_model.PROPOSALS].find_one(scope.filter(_id=oid))
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=PROPOSAL_NOT_FOUND)
    return doc


async def _elements_of(scope: TenantScope, photo_id: str) -> list[dict[str, Any]]:
    """Elementos ativos da foto, na ordem em que foram marcados."""
    cursor = (
        get_db()[element_model.COLLECTION]
        .find(scope.filter(photo_id=photo_id, deleted_at=None))
        .sort("created_at", 1)
    )
    return [doc async for doc in cursor]


def _colors_of(elements: list[dict[str, Any]], catalogo: dict[str, dict]) -> list[str]:
    """Cores reais das peças, na ordem — é o que o mock pinta nos recortes.

    Sai do catálogo (Fase 7) e só de lá: elemento sem acabamento não entra na
    lista, e o mock cai no cinza de placeholder dele.
    """
    cores = []
    for element in elements:
        finish_id = (element.get("spec") or {}).get("finish_id")
        acabamento = catalogo.get("finish_id", {}).get(finish_id)
        if acabamento:
            cores.append(acabamento["color_hex"])
    return cores


@router.post(
    "/photos/{photo_id}/proposals",
    response_model=ProposalOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_proposal(
    photo_id: str, scope: CurrentScope, user: CurrentUser
) -> ProposalOut:
    """Gera a proposta visual desta foto.

    Sem corpo: o pedido é montado do que está no banco. Recusa com 422 quando
    o Architecture Lock não autoriza — e essa checagem acontece **antes** de
    qualquer trabalho, para uma foto bloqueada não custar chamada de provedor.
    """
    photo = await get_photo_doc(scope, photo_id)
    projeto = await get_project_doc(scope, photo["project_id"])
    mask_doc = await get_mask_doc(scope, photo_id)

    bloqueio = mask_model.generation_block(
        mask_doc=mask_doc,
        architecture_lock=project_model.architecture_lock_of(projeto),
    )
    if bloqueio:
        # Mesmo texto que a Fase 8 já mostrava na tela de máscaras: a regra
        # mora em `mask_model`, e as duas pontas leem de lá.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=bloqueio
        )

    elements = await _elements_of(scope, photo_id)
    catalogo = await catalog_index_for(scope, elements)
    calibration = await get_db()[calibration_model.COLLECTION].find_one(
        scope.filter(photo_id=photo_id)
    )

    prompt = prompt_engine.build(
        project=projeto,
        photo=photo,
        elements=elements,
        catalogo=catalogo,
        mask_doc=mask_doc,
        calibration=calibration,
    )

    adapter = get_image_gen_adapter()
    proposal_doc = scope.stamp(
        proposal_model.new_proposal_doc(
            photo_id=photo_id,
            area_id=photo["area_id"],
            project_id=photo["project_id"],
            prompt=prompt,
            provider=adapter.name,
            requested_by=str(user["_id"]),
        )
    )
    proposals = get_db()[proposal_model.PROPOSALS]
    proposal_id = (await proposals.insert_one(proposal_doc)).inserted_id

    original_path = media.resolve(photo["storage_key"])
    original_bytes = original_path.read_bytes()
    layers = (mask_doc or {}).get("layers", [])
    tamanho = imaging.size_of(original_bytes)

    try:
        resultado = await adapter.generate(
            GenerationRequest(
                original_bytes=original_bytes,
                mask_png=imaging.mask_png_bytes(layers, tamanho),
                prompt=prompt["text"],
                size=tamanho,
                layers=layers,
                colors=_colors_of(elements, catalogo),
            )
        )
    except ImageGenError as erro:
        await proposals.update_one(
            {"_id": proposal_id}, {"$set": proposal_model.failed_fields(error=str(erro))}
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"O provedor de geração falhou: {erro}",
        ) from None

    # O Architecture Lock aplicado: o que o provedor devolveu só entra sob a
    # máscara de intervenção. Qualquer pixel fora dela continua sendo o original.
    composta, alterados = imaging.compose_locked(
        original_bytes=original_bytes,
        candidate_bytes=resultado.image_bytes,
        layers=layers,
    )

    stored = await media.write_once(
        key=media.build_derived_key(
            original_key=photo["storage_key"],
            derived_uid=uuid.uuid4().hex,
            extension="png",
        ),
        chunks=media.single_chunk(composta),
        max_bytes=get_settings().max_upload_mb * 1024 * 1024,
    )

    largura, altura = imaging.size_of(composta)
    imagem_doc = scope.stamp(
        proposal_model.new_generated_image_doc(
            photo_id=photo_id,
            project_id=photo["project_id"],
            proposal_id=str(proposal_id),
            storage_key=stored.key,
            size_bytes=stored.size_bytes,
            checksum_sha256=stored.checksum_sha256,
            width=largura,
            height=altura,
            changed_pixels=alterados,
            provider=resultado.provider,
            created_by=str(user["_id"]),
        )
    )
    imagem_id = (
        await get_db()[proposal_model.GENERATED_IMAGES].insert_one(imagem_doc)
    ).inserted_id

    doc = await proposals.find_one_and_update(
        {"_id": proposal_id},
        {"$set": proposal_model.concluded_fields(generated_image_id=str(imagem_id))},
        return_document=ReturnDocument.AFTER,
    )
    return _proposal_out(doc, {**imagem_doc, "_id": imagem_id})


@router.get("/proposals/{proposal_id}", response_model=ProposalOut)
async def get_proposal(proposal_id: str, scope: CurrentScope) -> ProposalOut:
    """Status e resultado de uma proposta, inclusive quando ela falhou."""
    return await _with_image(scope, await get_proposal_doc(scope, proposal_id))


@router.get("/photos/{photo_id}/proposals", response_model=list[ProposalOut])
async def list_proposals(
    photo_id: str, scope: CurrentScope, page: PageDep
) -> list[ProposalOut]:
    """Histórico da foto, mais recente primeiro — tentativas falhas inclusive."""
    await get_photo_doc(scope, photo_id)
    cursor = (
        get_db()[proposal_model.PROPOSALS]
        .find(scope.filter(photo_id=photo_id))
        .sort("created_at", -1)
        .skip(page.offset)
        .limit(page.limit)
    )
    return [await _with_image(scope, doc) async for doc in cursor]


@router.get("/photos/{photo_id}/compare", response_model=CompareOut)
async def compare(photo_id: str, scope: CurrentScope) -> CompareOut:
    """Original x última proposta concluída.

    Foto sem proposta devolve 200 com `generated=null`: é o estado inicial
    normal, e a tela mostra "ainda não gerada" em vez de erro.
    """
    photo = await get_photo_doc(scope, photo_id)
    proposals = get_db()[proposal_model.PROPOSALS]

    total = await proposals.count_documents(scope.filter(photo_id=photo_id))
    ultima = await proposals.find_one(
        scope.filter(photo_id=photo_id, status=proposal_model.CONCLUIDA),
        sort=[("created_at", -1)],
    )

    saida = CompareOut(
        photo_id=photo_id,
        original_url=f"/api/photos/{photo_id}/original",
        original_filename=photo["original_filename"],
        proposal_count=total,
    )
    if ultima:
        completa = await _with_image(scope, ultima)
        saida.proposal = completa
        saida.generated = completa.generated_image
    return saida


@router.get("/generated-images/{image_id}")
async def get_generated_image(
    image_id: str, scope: CurrentScope, request: Request
) -> Response:
    """Binário da imagem gerada, com o SHA-256 como ETag.

    Mesma rota de leitura do original em espírito: exige token, é escopada por
    tenant e não expõe caminho de disco.
    """
    oid = parse_object_id(image_id, detail=IMAGE_NOT_FOUND)
    doc = await get_db()[proposal_model.GENERATED_IMAGES].find_one(scope.filter(_id=oid))
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=IMAGE_NOT_FOUND)

    try:
        path = media.resolve(doc["storage_key"])
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=FILE_GONE
        ) from None
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=FILE_GONE)

    etag = '"' + doc["checksum_sha256"] + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})

    return FileResponse(
        path,
        media_type=doc["content_type"],
        content_disposition_type="inline",
        headers={"ETag": etag, "Cache-Control": "private, max-age=3600"},
    )
