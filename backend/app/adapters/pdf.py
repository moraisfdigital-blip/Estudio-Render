"""Adaptador de geração de PDF.

Um contrato só, escolhido por `PDF_PROVIDER`. O mock monta um PDF de verdade
localmente, sem rede e sem credencial; um provedor real (serviço de
diagramação, template corporativo) entra pela mesma fábrica sem mudar a rota.

## O mock não é um arquivo de mentira

Ele produz um PDF válido, com capa e uma página por slide, usando as imagens
reais das versões aprovadas. É o suficiente para conferir a apresentação de
ponta a ponta — abrir, ler, mandar para a impressora — sem contratar nada.

O que ele **não** faz é diagramação de marca: tipografia, grid e cores da
ARTELUX são trabalho do provedor real. Por isso não há cor de marca nem logo
embutido aqui; o mock usa cinzas neutros declarados no próprio arquivo.
"""

import io
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from PIL import Image, ImageDraw, ImageFont

from app.core.config import get_settings


class PdfError(Exception):
    """Falha do provedor. A rota traduz em 502 com mensagem para a tela."""


@dataclass(frozen=True, slots=True)
class PdfSlide:
    """Um slide já resolvido: a imagem em bytes e o texto que a acompanha."""

    label: str
    caption: str | None
    image_bytes: bytes | None


@dataclass(frozen=True, slots=True)
class PdfRequest:
    title: str
    project_name: str
    client_name: str | None = None
    location_name: str | None = None
    notes: str | None = None
    slides: list[PdfSlide] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class PdfResult:
    pdf_bytes: bytes
    provider: str
    page_count: int


class PdfAdapter(ABC):
    name: str

    @abstractmethod
    async def render(self, request: PdfRequest) -> PdfResult:
        """Renderiza a apresentação em PDF."""


# A4 a 150 dpi. Resolução de leitura em tela e de impressão doméstica, que é o
# uso desta fase; o provedor real decide o formato dele.
_PAGE = (1240, 1754)
_DPI = 150.0

_MARGIN = 90
_BG = (255, 255, 255)
_INK = (26, 26, 28)
_MUTED = (120, 124, 130)
_RULE = (220, 222, 226)


def _fonte(tamanho: int) -> ImageFont.ImageFont:
    return ImageFont.load_default(size=tamanho)


def _quebra(texto: str, largura_max: int, fonte: ImageFont.ImageFont) -> list[str]:
    """Quebra o texto em linhas que cabem na largura dada."""
    linhas: list[str] = []
    atual = ""
    for palavra in texto.split():
        tentativa = f"{atual} {palavra}".strip()
        if fonte.getlength(tentativa) <= largura_max:
            atual = tentativa
        else:
            if atual:
                linhas.append(atual)
            atual = palavra
    if atual:
        linhas.append(atual)
    return linhas


def _capa(request: PdfRequest) -> Image.Image:
    pagina = Image.new("RGB", _PAGE, _BG)
    desenho = ImageDraw.Draw(pagina)

    y = 420
    for linha in _quebra(request.title, _PAGE[0] - 2 * _MARGIN, _fonte(54)):
        desenho.text((_MARGIN, y), linha, fill=_INK, font=_fonte(54))
        y += 70

    y += 30
    desenho.line([(_MARGIN, y), (_PAGE[0] - _MARGIN, y)], fill=_RULE, width=2)
    y += 40

    for rotulo, valor in (
        ("Projeto", request.project_name),
        ("Cliente", request.client_name),
        ("Local", request.location_name),
    ):
        if not valor:
            continue
        desenho.text((_MARGIN, y), f"{rotulo}: {valor}", fill=_MUTED, font=_fonte(28))
        y += 44

    if request.notes:
        y += 30
        for linha in _quebra(request.notes, _PAGE[0] - 2 * _MARGIN, _fonte(26)):
            desenho.text((_MARGIN, y), linha, fill=_MUTED, font=_fonte(26))
            y += 38

    return pagina


def _pagina_slide(slide: PdfSlide, numero: int, total: int) -> Image.Image:
    pagina = Image.new("RGB", _PAGE, _BG)
    desenho = ImageDraw.Draw(pagina)

    desenho.text((_MARGIN, _MARGIN), slide.label, fill=_INK, font=_fonte(36))

    topo = _MARGIN + 80
    if slide.image_bytes:
        imagem = Image.open(io.BytesIO(slide.image_bytes)).convert("RGB")
        largura_max = _PAGE[0] - 2 * _MARGIN
        altura_max = _PAGE[1] - topo - 220
        escala = min(largura_max / imagem.width, altura_max / imagem.height)
        if escala < 1:
            imagem = imagem.resize((int(imagem.width * escala), int(imagem.height * escala)))
        pagina.paste(imagem, (_MARGIN, topo))
        topo += imagem.height + 30
    else:
        # Slide sem imagem continua no PDF, dizendo o que houve. Sumir com a
        # página deixaria a numeração errada e esconderia o problema.
        desenho.text((_MARGIN, topo), "Imagem indisponível", fill=_MUTED, font=_fonte(28))
        topo += 60

    if slide.caption:
        for linha in _quebra(slide.caption, _PAGE[0] - 2 * _MARGIN, _fonte(26)):
            desenho.text((_MARGIN, topo), linha, fill=_MUTED, font=_fonte(26))
            topo += 38

    rodape = f"{numero} de {total}"
    desenho.text(
        (_PAGE[0] - _MARGIN - _fonte(22).getlength(rodape), _PAGE[1] - _MARGIN),
        rodape,
        fill=_MUTED,
        font=_fonte(22),
    )
    return pagina


class MockPdfAdapter(PdfAdapter):
    """Monta o PDF localmente. Sem rede, sem credencial, arquivo válido."""

    name = "mock"

    async def render(self, request: PdfRequest) -> PdfResult:
        if not request.slides:
            raise PdfError("A apresentação não tem slides para exportar.")

        paginas = [_capa(request)]
        total = len(request.slides)
        for numero, slide in enumerate(request.slides, start=1):
            paginas.append(_pagina_slide(slide, numero, total))

        buffer = io.BytesIO()
        paginas[0].save(
            buffer,
            format="PDF",
            save_all=True,
            append_images=paginas[1:],
            resolution=_DPI,
        )
        return PdfResult(
            pdf_bytes=buffer.getvalue(), provider=self.name, page_count=len(paginas)
        )


def get_pdf_adapter() -> PdfAdapter:
    """Fábrica por env. Provedor real entra aqui com credenciais só no ambiente."""
    provider = get_settings().pdf_provider
    if provider == "mock":
        return MockPdfAdapter()
    raise ValueError(f"PDF_PROVIDER desconhecido: {provider!r}")
