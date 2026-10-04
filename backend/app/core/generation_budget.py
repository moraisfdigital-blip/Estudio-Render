"""Atomic hourly tenant budget for paid image generation, shared by workers."""
from datetime import timedelta

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.db import get_db


async def reserve(tenant_id: str) -> None:
    now = utcnow()
    hour = now.replace(minute=0, second=0, microsecond=0)
    key = f"{tenant_id}:{hour.isoformat()}"
    try:
        await get_db()["generation_usage"].find_one_and_update(
            {"_id": key, "tenant_id": tenant_id,
             "count": {"$lt": get_settings().generation_limit_per_hour}},
            {"$inc": {"count": 1}, "$setOnInsert": {
                "tenant_id": tenant_id, "expires_at": hour + timedelta(hours=2)}},
            upsert=True,
        )
    except DuplicateKeyError:
        wait = max(1, int((hour + timedelta(hours=1) - now).total_seconds()))
        raise HTTPException(429, "Limite de gerações por hora atingido neste workspace.",
                            headers={"Retry-After": str(wait)}) from None
