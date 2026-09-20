"""Documento `presentations` — o que vai para o cliente.

Uma apresentação por projeto. Ela reúne as **versões aprovadas** das fotos do
projeto, na ordem que o usuário decidir, e é a partir dela que o PDF é gerado.

## Só versão aprovada entra

É a regra central desta fase. Um slide aponta para uma versão específica, e o
router recusa qualquer versão que não seja a aprovada daquela foto. Sem isso, a
apresentação poderia levar ao cliente uma proposta que ninguém escolheu — e o
trabalho de aprovar (Fase 10) perderia o sentido.

Como a aprovação mora na foto (`photos.approved_version_id`), trocar a versão
aprovada depois de montar a apresentação **desatualiza o slide**. O router
detecta isso na leitura e marca o slide como obsoleto, em vez de mostrar em
silêncio uma imagem que não é mais a escolhida.

## A apresentação começa montada

Sem nada salvo, a leitura devolve um rascunho: as versões aprovadas do projeto
na ordem em que as fotos foram enviadas. Quem só quer exportar não precisa
arrastar nada; quem quer ordenar, salva.

## O link é interno

`share_token` identifica a apresentação numa URL curta, mas **não é
credencial**: abrir exige token JWT válido do mesmo tenant. Um link vazado não
dá acesso a ninguém de fora da ARTELUX — é atalho para quem já tem login, não
portal de cliente.
"""

import secrets
from typing import Any

from app.core.clock import utcnow

COLLECTION = "presentations"

# Bytes de entropia do token do link interno. 32 bytes é muito acima do
# necessário para um identificador que nem sozinho dá acesso — mas o custo de
# ser generoso aqui é zero.
TOKEN_BYTES = 32

NO_APPROVED_VERSION = (
    "Este projeto ainda não tem nenhuma versão aprovada. A apresentação leva ao "
    "cliente a proposta escolhida — aprove uma versão antes de exportar."
)

SLIDE_NOT_APPROVED = (
    "O slide {posicao} aponta para uma versão que não é a aprovada desta foto. "
    "A apresentação só leva ao cliente o que foi aprovado."
)


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def new_slide(*, photo_id: str, version_id: str, caption: str | None) -> dict[str, Any]:
    return {"photo_id": photo_id, "version_id": version_id, "caption": caption}


def presentation_fields(
    *,
    title: str,
    notes: str | None,
    slides: list[dict[str, Any]],
    updated_by: str,
) -> dict[str, Any]:
    """Campos do `$set` do upsert. O PUT substitui os slides inteiros.

    Substituir (em vez de mesclar) é o que faz a ordem na tela ser a ordem
    salva, sem sobras de uma montagem anterior.
    """
    return {
        "title": title,
        "notes": notes,
        "slides": slides,
        "updated_by": updated_by,
        "updated_at": utcnow(),
    }


def pdf_fields(
    *,
    storage_key: str,
    size_bytes: int,
    checksum_sha256: str,
    provider: str,
    page_count: int,
    generated_by: str,
) -> dict[str, Any]:
    """Ponteiro para o PDF exportado.

    Exportar de novo grava um arquivo novo e substitui este bloco; o anterior
    continua no disco, somente-leitura, como acontece com toda mídia do projeto.
    """
    return {
        "storage_key": storage_key,
        "size_bytes": size_bytes,
        "checksum_sha256": checksum_sha256,
        "provider": provider,
        "page_count": page_count,
        "generated_by": generated_by,
        "generated_at": utcnow(),
    }


def share_fields(*, token: str, created_by: str) -> dict[str, Any]:
    return {
        "share_token": token,
        "share_created_by": created_by,
        "share_created_at": utcnow(),
    }


def default_title(project_name: str) -> str:
    return f"Proposta visual — {project_name}"
