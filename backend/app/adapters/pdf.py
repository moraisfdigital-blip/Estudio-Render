"""Adaptador de geração de PDF.

Fase 1 entrega só o gancho: interface + mock + fábrica por env.
O export real da apresentação entra na Fase 11.
"""

from abc import ABC, abstractmethod
from typing import Any

from app.core.config import get_settings


class PdfAdapter(ABC):
    name: str

    @abstractmethod
    async def render(self, presentation: Any) -> Any:
        """Renderiza a apresentação em PDF."""


class MockPdfAdapter(PdfAdapter):
    name = "mock"

    async def render(self, presentation: Any) -> Any:
        raise NotImplementedError("Export de PDF entra na Fase 11.")


def get_pdf_adapter() -> PdfAdapter:
    provider = get_settings().pdf_provider
    if provider == "mock":
        return MockPdfAdapter()
    raise ValueError(f"PDF_PROVIDER desconhecido: {provider!r}")
