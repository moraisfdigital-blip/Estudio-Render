"""Contratos de `photos` — só metadados. O binário sai pela rota `/original`."""

from datetime import datetime

from pydantic import BaseModel


class PhotoOut(BaseModel):
    id: str
    tenant_id: str
    area_id: str
    project_id: str
    original_filename: str
    content_type: str
    size_bytes: int
    # Hash do original no momento do upload. Serve de prova de integridade: a
    # mesma foto baixada mais tarde tem que bater com este valor.
    checksum_sha256: str
    created_at: datetime
    # URL relativa do original, para o `<img>` do grid não montar path na mão.
    original_url: str


class MediaLimitsOut(BaseModel):
    """Limites de upload publicados para a UI. Valores vêm do env, não do código do cliente."""

    max_upload_mb: int
    # Para o atributo `accept` do input de arquivo.
    accepted_content_types: list[str]
    # Para o texto de ajuda e a mensagem de erro na tela.
    accepted_labels: list[str]
