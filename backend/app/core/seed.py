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
from app.models import calibration as calibration_model
from app.models import catalog as catalog_model
from app.models import client as client_model
from app.models import area as area_model
from app.models import element as element_model
from app.models import location as location_model
from app.models import mask as mask_model
from app.models import photo as photo_model
from app.models import presentation as presentation_model
from app.models import project as project_model
from app.models import proposal as proposal_model
from app.models import version as version_model
from app.models import takeoff as takeoff_model
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
    # Fase 5: uma calibração por foto. O índice único é o que torna o PUT um
    # upsert seguro — recalibrar corrige o mesmo registro em vez de empilhar
    # escalas concorrentes para a mesma foto.
    await db[calibration_model.COLLECTION].create_index(
        [("tenant_id", 1), ("photo_id", 1)], unique=True, name="uniq_tenant_photo_calibration"
    )
    # Fase 6: a lista de elementos é sempre por foto, só os ativos, na ordem em
    # que foram marcados.
    await db[element_model.COLLECTION].create_index(
        [("tenant_id", 1), ("photo_id", 1), ("deleted_at", 1), ("created_at", 1)],
        name="tenant_photo_element",
    )
    # A Fase 12 (quantitativo) varre elemento por projeto; o índice já nasce aqui
    # para essa leitura não virar varredura de coleção.
    await db[element_model.COLLECTION].create_index(
        [("tenant_id", 1), ("project_id", 1), ("deleted_at", 1)], name="tenant_project_element"
    )
    # Fase 7: catálogo do tenant. Nome único por tenant no material e na marca
    # — dois cadastros iguais no mesmo select é erro de digitação, não escolha.
    await db[catalog_model.MATERIALS].create_index(
        [("tenant_id", 1), ("name_key", 1)], unique=True, name="uniq_tenant_material_name"
    )
    await db[catalog_model.BRANDS].create_index(
        [("tenant_id", 1), ("name_key", 1)], unique=True, name="uniq_tenant_brand_name"
    )
    # Acabamento é único dentro do material, não do tenant: "Branco fosco" pode
    # existir em ACM e em vinil ao mesmo tempo.
    await db[catalog_model.FINISHES].create_index(
        [("tenant_id", 1), ("material_id", 1), ("name_key", 1)],
        unique=True,
        name="uniq_material_finish_name",
    )
    # Fase 8: uma máscara por foto. O índice único é o que torna o PUT um
    # upsert seguro — redesenhar corrige o mesmo documento em vez de empilhar
    # conjuntos de camadas concorrentes para a mesma foto.
    await db[mask_model.COLLECTION].create_index(
        [("tenant_id", 1), ("photo_id", 1)], unique=True, name="uniq_tenant_photo_mask"
    )
    # A Fase 9 varre máscara por projeto ao montar a geração.
    await db[mask_model.COLLECTION].create_index(
        [("tenant_id", 1), ("project_id", 1)], name="tenant_project_mask"
    )
    # Fase 9: histórico de geração por foto, mais recente primeiro — é como a
    # comparação acha a última proposta concluída sem varrer a coleção.
    await db[proposal_model.PROPOSALS].create_index(
        [("tenant_id", 1), ("photo_id", 1), ("created_at", -1)], name="tenant_photo_proposal"
    )
    await db[proposal_model.GENERATED_IMAGES].create_index(
        [("tenant_id", 1), ("photo_id", 1), ("created_at", -1)], name="tenant_photo_generated"
    )
    # Fase 10: o limite de 3 versões por foto vive NESTE índice, não num count
    # antes do insert — que perderia a corrida entre dois cliques simultâneos.
    # Parcial de propósito: versão descartada sai do índice e devolve a vaga.
    await db[version_model.COLLECTION].create_index(
        [("tenant_id", 1), ("photo_id", 1), ("position", 1)],
        unique=True,
        partialFilterExpression={"deleted_at": None},
        name="uniq_photo_version_position",
    )
    # Fase 11: uma apresentação por projeto — o índice único é o que torna o
    # PUT um upsert seguro em vez de empilhar montagens concorrentes.
    await db[presentation_model.COLLECTION].create_index(
        [("tenant_id", 1), ("project_id", 1)], unique=True, name="uniq_tenant_project_presentation"
    )
    # O link interno é resolvido por token; sem índice isso varreria a coleção.
    await db[presentation_model.COLLECTION].create_index(
        [("tenant_id", 1), ("share_token", 1)], name="tenant_share_token"
    )
    # Fase 12: um quantitativo por projeto — o índice único é o que torna o
    # POST de geração um upsert seguro em vez de empilhar quantitativos.
    await db[takeoff_model.COLLECTION].create_index(
        [("tenant_id", 1), ("project_id", 1)], unique=True, name="uniq_tenant_project_takeoff"
    )
    # O PATCH de linha acha o documento pelo id do item.
    await db[takeoff_model.COLLECTION].create_index(
        [("tenant_id", 1), ("items.id", 1)], name="tenant_takeoff_item"
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
