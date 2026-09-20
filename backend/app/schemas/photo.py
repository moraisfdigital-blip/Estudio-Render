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
    # Fase 5: o grid precisa mostrar "não calibrado" sem abrir foto por foto.
    # É só o estado (existe/não existe calibração) — o fator em si vem da rota
    # de calibração.
    calibrated: bool = False
    # Fase 6: quantos elementos já foram marcados nesta foto. Mesmo motivo do
    # `calibrated` — o grid mostra o andamento do levantamento sem abrir foto
    # por foto.
    element_count: int = 0
    # Fase 8: quantos recortes de intervenção esta foto já tem. Mesmo motivo do
    # `calibrated` — o grid mostra o andamento sem abrir foto por foto, e é o
    # número que diz se a Fase 9 terá onde escrever.
    intervention_count: int = 0


class MediaLimitsOut(BaseModel):
    """Limites de upload publicados para a UI. Valores vêm do env, não do código do cliente."""

    max_upload_mb: int
    # Para o atributo `accept` do input de arquivo.
    accepted_content_types: list[str]
    # Para o texto de ajuda e a mensagem de erro na tela.
    accepted_labels: list[str]
