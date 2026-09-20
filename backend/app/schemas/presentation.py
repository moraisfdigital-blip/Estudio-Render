"""Contratos da apresentação.

O cliente decide título, ordem e legendas. **Não decide qual versão aparece**:
o slide aponta para uma versão, e o servidor recusa qualquer uma que não seja a
aprovada daquela foto. `extra="forbid"` fecha o resto — mandar `pdf` ou
`share_token` no corpo é 422, não um campo gravado por fora da regra.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import LongText, Name

ObjectIdStr = Annotated[str, Field(pattern=r"^[0-9a-fA-F]{24}$")]

# Teto de slides por apresentação. Um levantamento grande tem dezenas de fotos,
# não milhares — e o PDF é montado em memória na exportação.
MAX_SLIDES = 60


class SlideIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    photo_id: ObjectIdStr
    version_id: ObjectIdStr
    caption: LongText = None


class PresentationIn(BaseModel):
    """PUT substitui título, notas e a lista inteira de slides."""

    model_config = ConfigDict(extra="forbid")

    title: Name | None = None
    notes: LongText = None
    slides: list[SlideIn] = Field(default_factory=list, max_length=MAX_SLIDES)


class SlideOut(BaseModel):
    position: int
    photo_id: str
    version_id: str
    label: str
    caption: str | None = None
    original_filename: str
    original_url: str
    # Ausente se a imagem gerada sumiu do banco — a tela mostra o slide como
    # incompleto em vez de quebrar a apresentação inteira.
    image_url: str | None = None
    area_id: str
    # `true` quando a foto passou a ter outra versão aprovada depois de o slide
    # ter sido salvo. O servidor avisa em vez de exibir em silêncio algo que
    # não é mais a escolha registrada.
    outdated: bool = False


class PdfOut(BaseModel):
    url: str
    size_bytes: int
    checksum_sha256: str
    provider: str
    page_count: int
    generated_at: datetime


class ShareLinkOut(BaseModel):
    """Link interno. Exige login do tenant — não é portal público."""

    url: str
    token: str
    created_at: datetime


class PresentationOut(BaseModel):
    project_id: str
    tenant_id: str
    title: str
    notes: str | None = None
    slides: list[SlideOut] = Field(default_factory=list)
    # `false` enquanto ninguém salvou: a leitura devolve um rascunho montado
    # das versões aprovadas, e a tela deixa claro que ainda não foi salvo.
    saved: bool = False
    # Quantas fotos do projeto têm versão aprovada. Zero é o estado vazio desta
    # fatia — e o motivo pelo qual a exportação recusa.
    approved_count: int = 0
    can_export: bool = False
    blocked_reason: str | None = None
    pdf: PdfOut | None = None
    share: ShareLinkOut | None = None
    updated_at: datetime | None = None
