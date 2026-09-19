"""Configuração da aplicação. Tudo vem de env — nada chumbado no código."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# .../backend/app/core/config.py -> raiz do repositório
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Render Artelux"

    mongo_url: str = "mongodb://localhost:27017"
    mongo_db: str = "estudio_render"

    jwt_secret: str = "dev-only-nao-usar-em-producao"

    image_gen_provider: str = "mock"
    pdf_provider: str = "mock"

    default_tenant_slug: str = "artelux"

    # Caminho do build do frontend, relativo à raiz do repo ou absoluto.
    frontend_dist: str = "frontend/dist"

    @property
    def frontend_dist_path(self) -> Path:
        path = Path(self.frontend_dist)
        return path if path.is_absolute() else REPO_ROOT / path


@lru_cache
def get_settings() -> Settings:
    return Settings()
