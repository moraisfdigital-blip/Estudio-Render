import asyncio
import uuid

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.generation_budget import reserve
from pydantic import SecretStr


async def test_generation_config_requires_auth_and_never_exposes_key(api, owner, monkeypatch):
    assert (await api.get("/api/generation/config")).status_code == 401
    settings = get_settings()
    monkeypatch.setattr(settings, "image_gen_provider", "openrouter")
    monkeypatch.setattr(settings, "openrouter_api_key", SecretStr(""))
    response = await api.get("/api/generation/config", headers=owner.auth)
    assert response.json() == {"provider": "openrouter", "ready": False, "simulation": False}
    monkeypatch.setattr(settings, "openrouter_api_key", SecretStr("test-only-not-a-real-key"))
    response = await api.get("/api/generation/config", headers=owner.auth)
    assert response.json() == {"provider": "openrouter", "ready": True, "simulation": False}
    assert "test-only" not in response.text


async def test_paid_generation_budget_is_atomic_and_tenant_scoped(monkeypatch, banco):
    monkeypatch.setattr(get_settings(), "generation_limit_per_hour", 2)
    tenant = "budget-test-" + uuid.uuid4().hex
    results = await asyncio.gather(*(reserve(tenant) for _ in range(8)), return_exceptions=True)
    assert sum(result is None for result in results) == 2
    assert all(isinstance(result, HTTPException) and result.status_code == 429
               for result in results if result is not None)
    assert (await banco.generation_usage.find_one({"tenant_id": tenant}))["count"] == 2
    await reserve(tenant + "-other")
