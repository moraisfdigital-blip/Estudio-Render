"""Catálogo do tenant: material, acabamento e marca.

As três coleções vivem no mesmo módulo porque são o mesmo assunto — o que a
ARTELUX realmente usa para fabricar — e porque acabamento só existe pendurado
num material.

## Por que a cor mora no acabamento

O blueprint define acabamento como "variante do material", e o plano exige que
a cor venha do catálogo persistido, nunca de hex chumbado no frontend. Um
material ("ACM", "Vinil") não tem cor sozinho: quem tem cor é a variante
("ACM branco brilho", "Vinil preto fosco"). Então `color_name` e `color_hex`
são campos do acabamento, e escolher o acabamento é escolher a cor real.

Guardamos o nome da cor junto do hex de propósito. O hex é para desenhar a
amostra na tela; o nome é o que vai na proposta e no chão de fábrica, onde
`#1C1C1E` não quer dizer nada e "Preto fosco" quer.

## O que não fica desnormalizado

O elemento guarda só os ids do que foi aplicado. Nome e cor são resolvidos do
catálogo na hora de responder, então renomear um material corrige todos os
elementos de uma vez em vez de deixar cópias velhas espalhadas.
"""

import re
from typing import Any

from app.core.clock import utcnow

MATERIALS = "materials"
FINISHES = "finishes"
BRANDS = "brands"

# Hex de 6 dígitos, com #. Forma curta (#fff) fica de fora para o banco ter um
# formato só — a tela recebe sempre algo que dá para comparar como string.
HEX_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def name_key(name: str) -> str:
    """Chave de unicidade do nome (case/espaço-insensível), como em `clients`."""
    return " ".join(name.split()).casefold()


def clean_name(name: str) -> str:
    return " ".join(name.split())


def normalize_hex(value: str) -> str:
    """Hex sempre minúsculo no banco: `#FFF000` e `#fff000` são a mesma cor."""
    return value.lower()


def new_material_doc(*, name: str, description: str | None, created_by: str) -> dict[str, Any]:
    now = utcnow()
    clean = clean_name(name)
    return {
        "name": clean,
        "name_key": name_key(clean),
        "description": description,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }


def new_finish_doc(
    *,
    material_id: str,
    name: str,
    color_name: str,
    color_hex: str,
    description: str | None,
    created_by: str,
) -> dict[str, Any]:
    now = utcnow()
    clean = clean_name(name)
    return {
        # Acabamento sem material não existe: é variante de alguma coisa.
        "material_id": material_id,
        "name": clean,
        "name_key": name_key(clean),
        "color_name": clean_name(color_name),
        "color_hex": normalize_hex(color_hex),
        "description": description,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }


def new_brand_doc(*, name: str, description: str | None, created_by: str) -> dict[str, Any]:
    now = utcnow()
    clean = clean_name(name)
    return {
        "name": clean,
        "name_key": name_key(clean),
        "description": description,
        # Preenchido pelo upload de logo; marca sem arquivo é normal.
        "logo": None,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }


def logo_fields(
    *,
    storage_key: str,
    content_type: str,
    size_bytes: int,
    checksum_sha256: str,
    filename: str,
    uploaded_by: str,
) -> dict[str, Any]:
    """Ponteiro para o arquivo do logo.

    Trocar o logo grava um arquivo novo e substitui este bloco; o arquivo
    anterior continua no disco, somente-leitura, como acontece com as fotos.
    """
    return {
        "storage_key": storage_key,
        "content_type": content_type,
        "size_bytes": size_bytes,
        "checksum_sha256": checksum_sha256,
        "filename": filename,
        "uploaded_by": uploaded_by,
        "uploaded_at": utcnow(),
    }


def empty_spec() -> dict[str, Any]:
    """Elemento sem especificação: marcado e medido, mas ninguém decidiu o material."""
    return {"material_id": None, "finish_id": None, "brand_id": None}


def spec_fields(
    *,
    material_id: str | None,
    finish_id: str | None,
    brand_id: str | None,
    applied_by: str,
) -> dict[str, Any]:
    """Bloco `spec` do elemento — só ids, validados pelo router contra o catálogo."""
    applied = any((material_id, finish_id, brand_id))
    return {
        "material_id": material_id,
        "finish_id": finish_id,
        "brand_id": brand_id,
        # Limpar a spec inteira não deixa carimbo de quem aplicou o que não existe mais.
        "applied_by": applied_by if applied else None,
        "applied_at": utcnow() if applied else None,
    }
