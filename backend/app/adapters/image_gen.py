"""Adaptador de geração de imagem.

Fase 1 entrega só o gancho: interface + mock + fábrica por env.
A geração real (máscaras, Architecture Lock) entra na Fase 9.
"""

from abc import ABC, abstractmethod
from typing import Any

from app.core.config import get_settings


class ImageGenAdapter(ABC):
    name: str

    @abstractmethod
    async def generate(self, **kwargs: Any) -> Any:
        """Gera uma proposta visual a partir da foto original + máscaras."""


class MockImageGenAdapter(ImageGenAdapter):
    name = "mock"

    async def generate(self, **kwargs: Any) -> Any:
        raise NotImplementedError("Geração de imagem entra na Fase 9.")


def get_image_gen_adapter() -> ImageGenAdapter:
    provider = get_settings().image_gen_provider
    if provider == "mock":
        return MockImageGenAdapter()
    raise ValueError(f"IMAGE_GEN_PROVIDER desconhecido: {provider!r}")
