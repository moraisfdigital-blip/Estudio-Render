"""Documentos `proposals` e `generated_images` — o pedido e o resultado.

São duas coleções de propósito. A **proposta** é o pedido: o prompt exato que
foi montado, quem pediu, quando, com qual provedor e o que aconteceu. A
**imagem gerada** é o arquivo: bytes, checksum, dimensões e quantos pixels
mudaram de verdade.

Separar deixa registrada a tentativa que falhou. Um provedor fora do ar vira
uma proposta com `status="falhou"` e o motivo — não um buraco no histórico,
não um retry silencioso que ninguém audita.

## A foto original nunca é substituída

A imagem gerada é arquivo novo, em `derived/` dentro da pasta da própria foto.
O documento da foto não é alterado: a proposta aponta para a foto, nunca o
contrário. Reverter uma proposta é ignorá-la, não restaurar nada.

## O que prova que a regra foi cumprida

`changed_pixels` é gravado junto da imagem. Ele vem da composição
(`imaging.compose_locked`), que aplicou o retorno do provedor só sob a máscara
de intervenção — então o número é o alcance real da geração naquela foto, e
não pode ser maior que a área permitida.
"""

from typing import Any

from app.core.clock import utcnow

PROPOSALS = "proposals"
GENERATED_IMAGES = "generated_images"

# Geração é síncrona nesta fase (sem worker, como o blueprint definiu), então a
# proposta nasce já resolvida. O campo existe para o dia em que houver fila:
# `pendente` passa a ser um estado real sem migrar documento nenhum.
CONCLUIDA = "concluida"
FALHOU = "falhou"
PENDENTE = "pendente"

STATUSES: tuple[str, ...] = (PENDENTE, CONCLUIDA, FALHOU)

STATUS_LABELS = {
    PENDENTE: "Gerando",
    CONCLUIDA: "Concluída",
    FALHOU: "Falhou",
}


def new_proposal_doc(
    *,
    photo_id: str,
    area_id: str,
    project_id: str,
    prompt: dict[str, Any],
    provider: str,
    requested_by: str,
) -> dict[str, Any]:
    """Proposta em `pendente`. O router a fecha em concluída ou falhou."""
    return {
        "photo_id": photo_id,
        "area_id": area_id,
        "project_id": project_id,
        # O prompt fica gravado inteiro: é a resposta para "por que a proposta
        # ficou assim?" daqui a seis meses.
        "prompt": prompt,
        "provider": provider,
        "status": PENDENTE,
        "generated_image_id": None,
        "error": None,
        "requested_by": requested_by,
        "created_at": utcnow(),
        "completed_at": None,
    }


def concluded_fields(*, generated_image_id: str) -> dict[str, Any]:
    return {
        "status": CONCLUIDA,
        "generated_image_id": generated_image_id,
        "error": None,
        "completed_at": utcnow(),
    }


def failed_fields(*, error: str) -> dict[str, Any]:
    """Falha do provedor vira registro, não exceção engolida."""
    return {
        "status": FALHOU,
        "generated_image_id": None,
        "error": error,
        "completed_at": utcnow(),
    }


def new_generated_image_doc(
    *,
    photo_id: str,
    project_id: str,
    proposal_id: str,
    storage_key: str,
    size_bytes: int,
    checksum_sha256: str,
    width: int,
    height: int,
    changed_pixels: int,
    provider: str,
    created_by: str,
) -> dict[str, Any]:
    return {
        "photo_id": photo_id,
        "project_id": project_id,
        "proposal_id": proposal_id,
        "storage_key": storage_key,
        # Sempre PNG: o derivado precisa ser sem perda para "o pixel fora da
        # máscara é idêntico ao original" continuar sendo verificável.
        "content_type": "image/png",
        "size_bytes": size_bytes,
        "checksum_sha256": checksum_sha256,
        "width": width,
        "height": height,
        "changed_pixels": changed_pixels,
        "provider": provider,
        "created_by": created_by,
        "created_at": utcnow(),
    }
