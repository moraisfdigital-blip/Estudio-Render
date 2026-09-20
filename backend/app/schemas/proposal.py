"""Contratos da geração.

O `POST` não tem corpo: **não existe campo para o cliente influenciar o
prompt**. O pedido é montado inteiramente a partir do que está persistido
(elementos, specs do catálogo, máscaras), e é isso que impede alguém de
contornar o Architecture Lock pedindo "ignore a máscara" por parâmetro.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class PromptPieceOut(BaseModel):
    """Uma peça como ela entrou no prompt, já em texto auditável."""

    name: str
    kind: str | None = None
    # Vem com a procedência junto ("medido em campo" / "estimativa") ou
    # "medida não informada". Nunca um número solto.
    dimensions: str
    spec: str


class PromptOut(BaseModel):
    """O pedido exato que foi enviado ao provedor."""

    text: str
    instrucao: str
    projeto: str
    intervencao: list[str] = Field(default_factory=list)
    protecao: list[str] = Field(default_factory=list)
    pecas: list[PromptPieceOut] = Field(default_factory=list)
    escala: str | None = None


class GeneratedImageOut(BaseModel):
    id: str
    photo_id: str
    proposal_id: str
    url: str
    content_type: str
    size_bytes: int
    checksum_sha256: str
    width: int
    height: int
    # Alcance real da geração: quantos pixels a composição alterou. Nunca pode
    # ser maior que a área da máscara de intervenção.
    changed_pixels: int
    provider: str
    created_at: datetime


class ProposalOut(BaseModel):
    id: str
    tenant_id: str
    photo_id: str
    project_id: str
    status: str
    status_label: str
    provider: str
    prompt: PromptOut
    # Ausente quando a geração falhou — a proposta continua registrada.
    generated_image: GeneratedImageOut | None = None
    error: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


class CompareOut(BaseModel):
    """Original x gerado, lado a lado.

    As duas URLs saem montadas pelo servidor. A tela não concatena caminho de
    mídia na mão, e a foto original continua sendo servida pela rota de sempre
    — comparar não cria uma segunda via de acesso ao arquivo.
    """

    photo_id: str
    original_url: str
    original_filename: str
    # Nulo quando a foto ainda não tem proposta concluída: é o estado inicial
    # normal, e a tela mostra "ainda não gerada" em vez de erro.
    generated: GeneratedImageOut | None = None
    proposal: ProposalOut | None = None
    proposal_count: int = 0
