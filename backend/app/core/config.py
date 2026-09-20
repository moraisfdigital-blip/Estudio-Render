"""Configuração da aplicação. Tudo vem de env — nada chumbado no código."""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
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

    # Sem default de propósito: um fallback aqui seria um segredo conhecido,
    # publicado no repositório, assinando token de owner. Faltando a env, o app
    # não sobe — é o único jeito de um deploy distraído falhar alto em vez de
    # ficar aberto em silêncio.
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12

    # 32 bytes é o mínimo da RFC 7518 §3.2 para HS256; abaixo disso o próprio
    # PyJWT avisa. Validar aqui transforma o aviso em recusa de subir.
    @field_validator("jwt_secret")
    @classmethod
    def _secret_is_strong(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 32:
            raise ValueError(
                "JWT_SECRET precisa de pelo menos 32 caracteres. "
                "Gere um: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        return value

    image_gen_provider: str = "mock"
    pdf_provider: str = "mock"

    default_tenant_slug: str = "artelux"
    default_tenant_name: str = "ARTELUX"

    # Seed do owner de desenvolvimento. Sem senha em env, o seed não cria usuário
    # (e o app sobe igual) — nunca há credencial chumbada no código.
    seed_owner_email: str = ""
    seed_owner_password: str = ""
    seed_owner_name: str = "Owner ARTELUX"

    # Registro interno aberto (Fase 2 não tem convites). Desligue quando houver convite.
    allow_self_register: bool = True

    # Caminho do build do frontend, relativo à raiz do repo ou absoluto.
    frontend_dist: str = "frontend/dist"

    # Fase 4 — storage de mídia. Raiz onde os originais são gravados, relativa à
    # raiz do repo ou absoluta. Em produção aponta para um volume persistente
    # (ou, no futuro, é trocada por um adapter S3): nunca um caminho chumbado.
    media_root: str = "var/media"

    # Limite de tamanho por foto. Fotos de levantamento feitas com celular ficam
    # bem abaixo disso; o teto existe para não encher o volume por acidente.
    max_upload_mb: int = 25

    @property
    def frontend_dist_path(self) -> Path:
        path = Path(self.frontend_dist)
        return path if path.is_absolute() else REPO_ROOT / path

    @property
    def media_root_path(self) -> Path:
        path = Path(self.media_root)
        return path if path.is_absolute() else REPO_ROOT / path

    @property
    def allowed_image_labels(self) -> tuple[str, ...]:
        """Formatos aceitos, do jeito que a mensagem de erro fala com o usuário."""
        return ("JPEG", "PNG", "WebP")


@lru_cache
def get_settings() -> Settings:
    return Settings()
