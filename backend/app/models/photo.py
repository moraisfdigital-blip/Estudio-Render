"""Documento `photos` — metadados do original imutável.

O documento guarda a **chave** do arquivo (`storage_key`), nunca um caminho
absoluto: trocar o `MEDIA_ROOT` (ou migrar para S3) não invalida o banco.

`checksum_sha256` é gravado no momento do upload e nunca recalculado por
escrita: ele é a prova de que o original é o mesmo byte a byte. A rota de
download confere o arquivo contra esse valor.

Remoção é **soft-delete**: `deleted_at` preenchido some da UI e das leituras,
mas o binário original continua no disco, intocado. O blueprint exige que o
original nunca seja editado; apagar o arquivo seria a forma mais definitiva de
perdê-lo, então o DELETE da API não encosta no disco.
"""

from typing import Any

from app.core.clock import utcnow

COLLECTION = "photos"


def new_photo_doc(
    *,
    area_id: str,
    project_id: str,
    original_filename: str,
    content_type: str,
    size_bytes: int,
    checksum_sha256: str,
    storage_key: str,
    uploaded_by: str,
) -> dict[str, Any]:
    now = utcnow()
    return {
        "area_id": area_id,
        # Desnormalizado de propósito: as fases seguintes buscam foto por projeto
        # sem precisar de join com `areas`.
        "project_id": project_id,
        "original_filename": original_filename,
        "content_type": content_type,
        "size_bytes": size_bytes,
        "checksum_sha256": checksum_sha256,
        "storage_key": storage_key,
        "uploaded_by": uploaded_by,
        "created_at": now,
        # Soft-delete: nulo = ativa. O arquivo original nunca é removido.
        "deleted_at": None,
    }
