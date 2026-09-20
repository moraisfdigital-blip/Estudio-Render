"""Documento `versions` — as propostas que entraram na disputa.

A Fase 9 gera quantas propostas alguém quiser: cada clique em "gerar" vira uma
tentativa registrada. A Fase 10 é o passo seguinte, e é um passo de **decisão**:
promover uma geração a versão significa "esta é candidata a ir para o cliente".

## Por que no máximo três

O limite é de produto, não técnico. Três opções é o que um cliente compara sem
paralisar; a quarta transforma escolha em indecisão. Por isso a quarta promoção
é recusada com 422 e a tela mostra "limite atingido" — com a saída de descartar
uma versão para abrir espaço.

## O limite é estrutural, não uma contagem

Um `count` antes do insert perderia a corrida entre dois cliques simultâneos e
gravaria uma quarta versão. Cada versão ocupa uma `position` de 1 a 3, e existe
índice único **parcial** (só entre as versões ativas) em
`tenant_id + photo_id + position`. Duas promoções concorrentes disputam a mesma
posição e o Mongo recusa a segunda — o limite vale mesmo sob corrida.

O índice ser parcial é o que faz o soft-delete devolver a vaga: versão
descartada mantém sua posição no documento, mas sai do índice.

## A aprovação não mora aqui

Quem guarda a versão aprovada é a **foto** (`photos.approved_version_id`).
Fonte única: aprovar outra versão é um `$set` só, e não existe o estado
impossível de duas versões marcadas como aprovadas na mesma foto.
"""

from typing import Any

from app.core.clock import utcnow

COLLECTION = "versions"

# Três é decisão de produto (ver docstring). Mudar este número muda o contrato
# com o cliente, então ele vive aqui e não espalhado pelas rotas.
MAX_VERSIONS = 3

POSITIONS: tuple[int, ...] = tuple(range(1, MAX_VERSIONS + 1))

LIMIT_REACHED = (
    f"Esta foto já tem {MAX_VERSIONS} versões, que é o limite. "
    "Descarte uma versão para abrir espaço — três opções é o que um cliente "
    "compara sem travar na escolha."
)

ALREADY_VERSION = (
    "Esta geração já está entre as versões desta foto. "
    "Gere uma proposta nova para ter outra opção."
)

APPROVED_CANNOT_BE_DISCARDED = (
    "Esta é a versão aprovada da foto. Aprove outra versão antes de descartá-la "
    "— a apresentação da próxima fase depende de haver uma escolha registrada."
)


def next_position(ocupadas: set[int]) -> int | None:
    """Menor vaga livre de 1 a 3, ou `None` quando não há.

    Devolver a menor vaga (em vez de contar+1) é o que faz uma versão
    descartada liberar o lugar dela para a próxima promoção.
    """
    for posicao in POSITIONS:
        if posicao not in ocupadas:
            return posicao
    return None


def default_label(position: int) -> str:
    return f"Versão {position}"


def new_version_doc(
    *,
    photo_id: str,
    area_id: str,
    project_id: str,
    proposal_id: str,
    generated_image_id: str,
    position: int,
    label: str | None,
    notes: str | None,
    created_by: str,
) -> dict[str, Any]:
    now = utcnow()
    return {
        "photo_id": photo_id,
        "area_id": area_id,
        "project_id": project_id,
        # Aponta para a geração que a originou: a versão não copia a imagem,
        # ela elege uma que já existe. O arquivo continua sendo um só.
        "proposal_id": proposal_id,
        "generated_image_id": generated_image_id,
        "position": position,
        "label": label or default_label(position),
        "notes": notes,
        # Soft-delete: descartar uma versão tira ela da disputa sem apagar o
        # histórico de que ela existiu e foi considerada.
        "deleted_at": None,
        "deleted_by": None,
        "created_by": created_by,
        "created_at": now,
    }


def discarded_fields(*, discarded_by: str) -> dict[str, Any]:
    return {"deleted_at": utcnow(), "deleted_by": discarded_by}
