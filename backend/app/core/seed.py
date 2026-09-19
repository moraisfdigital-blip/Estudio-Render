"""Seed idempotente: tenant fixo (ARTELUX) + owner de desenvolvimento.

Credenciais vêm só de env (`SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`).
Sem essas variáveis o app sobe normalmente e nenhum usuário é criado —
nunca existe credencial padrão embutida no código.
"""

import logging

from pymongo.errors import DuplicateKeyError

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import hash_password
from app.models import client as client_model
from app.models import area as area_model
from app.models import location as location_model
from app.models import photo as photo_model
from app.models import project as project_model
from app.models import tenant as tenant_model
from app.models import user as user_model

logger = logging.getLogger(__name__)


async def ensure_indexes() -> None:
    db = get_db()
    await db[tenant_model.COLLECTION].create_index("slug", unique=True)
    # E-mail é único *dentro* do tenant: dois tenants podem ter o mesmo e-mail.
    await db[user_model.COLLECTION].create_index(
        [("tenant_id", 1), ("email", 1)], unique=True, name="uniq_tenant_email"
    )
    # Fase 3: nome único por tenant evita dois cadastros idênticos no mesmo select.
    await db[client_model.COLLECTION].create_index(
        [("tenant_id", 1), ("name_key", 1)], unique=True, name="uniq_tenant_client_name"
    )
    await db[location_model.COLLECTION].create_index(
        [("tenant_id", 1), ("name_key", 1)], unique=True, name="uniq_tenant_location_name"
    )
    # Dashboard lê sempre escopado e ordenado por data de criação.
    await db[project_model.COLLECTION].create_index(
        [("tenant_id", 1), ("created_at", -1)], name="tenant_created_at"
    )
    # Fase 4: nome de área único dentro do projeto (não do tenant inteiro —
    # dois projetos podem ter uma "Fachada" cada um).
    await db[area_model.COLLECTION].create_index(
        [("tenant_id", 1), ("project_id", 1), ("name_key", 1)],
        unique=True,
        name="uniq_project_area_name",
    )
    await db[area_model.COLLECTION].create_index(
        [("tenant_id", 1), ("project_id", 1), ("created_at", 1)], name="tenant_project_area"
    )
    # Grid da área: só fotos ativas, mais recentes primeiro.
    await db[photo_model.COLLECTION].create_index(
        [("tenant_id", 1), ("area_id", 1), ("deleted_at", 1), ("created_at", -1)],
        name="tenant_area_photo",
    )


async def ensure_default_tenant() -> str:
    """Garante o tenant fixo da instalação e devolve seu id como string."""
    settings = get_settings()
    db = get_db()
    collection = db[tenant_model.COLLECTION]

    existing = await collection.find_one({"slug": settings.default_tenant_slug})
    if existing is not None:
        return str(existing["_id"])

    doc = tenant_model.new_tenant_doc(
        slug=settings.default_tenant_slug,
        name=settings.default_tenant_name,
    )
    try:
        result = await collection.insert_one(doc)
    except DuplicateKeyError:  # corrida entre workers na subida
        existing = await collection.find_one({"slug": settings.default_tenant_slug})
        return str(existing["_id"])

    logger.info("Tenant %r criado pelo seed.", settings.default_tenant_slug)
    return str(result.inserted_id)


async def ensure_seed_owner(tenant_id: str) -> None:
    settings = get_settings()
    if not settings.seed_owner_email or not settings.seed_owner_password:
        logger.info("SEED_OWNER_EMAIL/PASSWORD ausentes: nenhum usuário criado pelo seed.")
        return

    db = get_db()
    email = user_model.normalize_email(settings.seed_owner_email)
    # Query de user já nasce escopada por tenant_id.
    existing = await db[user_model.COLLECTION].find_one({"tenant_id": tenant_id, "email": email})
    if existing is not None:
        return

    doc = user_model.new_user_doc(
        tenant_id=tenant_id,
        email=email,
        password_hash=hash_password(settings.seed_owner_password),
        name=settings.seed_owner_name,
        role="owner",
    )
    try:
        await db[user_model.COLLECTION].insert_one(doc)
    except DuplicateKeyError:
        return
    logger.info("Owner do seed criado no tenant %s.", tenant_id)


async def run_seed() -> str:
    await ensure_indexes()
    tenant_id = await ensure_default_tenant()
    await ensure_seed_owner(tenant_id)
    return tenant_id
