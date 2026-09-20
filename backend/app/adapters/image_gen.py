"""Adaptador de geração de imagem.

Um contrato só, duas implementações possíveis: o mock (que não toca a rede) e
o provedor real, escolhido por `IMAGE_GEN_PROVIDER`. Trocar de um para o outro
é trocar a variável de ambiente — a rota, o Prompt Engine e a composição do
Architecture Lock não mudam.

## O que o adapter NÃO decide

Ele não decide o que pode ser alterado. Seja qual for a imagem que ele devolva,
ela passa por `imaging.compose_locked` antes de virar arquivo, e só os pixels
sob a máscara de intervenção sobrevivem. Um provedor que ignore a máscara não
consegue alterar a arquitetura do cliente — a garantia é da composição, não da
boa vontade do serviço.

## O mock

Pinta cada área de intervenção com a **cor real do acabamento** especificado na
Fase 7, quando existe. Não é enfeite: é o que faz a fatia inteira ser
verificável de ponta a ponta sem credencial nenhuma — o hex que o usuário
cadastrou no catálogo aparece no pixel da proposta.

Sem spec, pinta um cinza neutro declarado aqui como placeholder de mock. Esse
valor não é cor de marca e não vaza para o catálogo: ele existe só para o mock
ter o que desenhar quando ninguém especificou material.
"""

import io
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from PIL import Image, ImageDraw

from app.core.config import get_settings
from app.models import mask as mask_model


class ImageGenError(Exception):
    """Falha do provedor. A rota traduz em 502 com mensagem para a tela."""


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    """Tudo que um provedor precisa — nada que ele não precise.

    A foto e a máscara vão como bytes porque é o que um serviço externo recebe;
    `layers` acompanha para o mock poder desenhar sem reinterpretar o PNG.
    """

    original_bytes: bytes
    mask_png: bytes
    prompt: str
    size: tuple[int, int]
    layers: list[dict[str, Any]] = field(default_factory=list)
    # Cores vindas do catálogo (Fase 7), na ordem em que as peças aparecem.
    colors: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class GenerationResult:
    image_bytes: bytes
    provider: str
    model: str | None = None


class ImageGenAdapter(ABC):
    name: str

    @abstractmethod
    async def generate(self, request: GenerationRequest) -> GenerationResult:
        """Gera a proposta a partir da foto original + máscara + prompt."""


# Cinza neutro do mock. Não é cor de marca, não é padrão de catálogo: é o que o
# mock desenha quando a peça não tem acabamento especificado.
_PLACEHOLDER = (120, 124, 130)


class MockImageGenAdapter(ImageGenAdapter):
    """Geração local, sem rede e sem credencial.

    Pinta as áreas de intervenção com a cor do acabamento especificado. É
    determinístico: a mesma entrada produz a mesma imagem, o que deixa o teste
    afirmar cor de pixel em vez de "parece ter mudado".
    """

    name = "mock"

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        imagem = Image.open(io.BytesIO(request.original_bytes)).convert("RGB")
        desenho = ImageDraw.Draw(imagem)

        intervencoes = [
            layer
            for layer in request.layers
            if layer.get("kind") == mask_model.INTERVENTION
        ]

        for indice, layer in enumerate(intervencoes):
            cor = _cor_para(request.colors, indice)
            desenho.polygon(
                [(ponto["x"], ponto["y"]) for ponto in layer["points"]], fill=cor
            )

        buffer = io.BytesIO()
        imagem.save(buffer, format="PNG")
        return GenerationResult(image_bytes=buffer.getvalue(), provider=self.name)


def _cor_para(colors: list[str], indice: int) -> tuple[int, int, int]:
    """Cor do catálogo para a enésima área, ou o cinza de placeholder."""
    if indice < len(colors):
        return _hex_para_rgb(colors[indice])
    if colors:
        # Mais áreas do que peças especificadas: repete a última cor real em vez
        # de cair no cinza, que daria a impressão de que a spec sumiu.
        return _hex_para_rgb(colors[-1])
    return _PLACEHOLDER


def _hex_para_rgb(valor: str) -> tuple[int, int, int]:
    limpo = valor.lstrip("#")
    return (int(limpo[0:2], 16), int(limpo[2:4], 16), int(limpo[4:6], 16))


def get_image_gen_adapter() -> ImageGenAdapter:
    """Fábrica por env. Provedor real entra aqui com as credenciais só no ambiente."""
    provider = get_settings().image_gen_provider
    if provider == "mock":
        return MockImageGenAdapter()
    raise ValueError(f"IMAGE_GEN_PROVIDER desconhecido: {provider!r}")
