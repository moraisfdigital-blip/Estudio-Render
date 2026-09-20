"""Render Artelux — single-service: FastAPI serve /api e o build do React com fallback SPA."""

import logging
import math
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.health import router as health_router
from app.api.routers.areas import router as areas_router
from app.api.routers.auth import router as auth_router
from app.api.routers.calibrations import router as calibrations_router
from app.api.routers.catalog import router as catalog_router
from app.api.routers.clients import router as clients_router
from app.api.routers.elements import router as elements_router
from app.api.routers.locations import router as locations_router
from app.api.routers.masks import router as masks_router
from app.api.routers.photos import router as photos_router
from app.api.routers.presentations import router as presentations_router
from app.api.routers.projects import router as projects_router
from app.api.routers.proposals import router as proposals_router
from app.api.routers.tenants import router as tenants_router
from app.api.routers.versions import router as versions_router
from app.core.config import get_settings
from app.core.db import close_client
from app.core.seed import run_seed

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Índices + tenant fixo na subida. Se o Mongo ainda não respondeu, o app sobe
    # mesmo assim: o seed é refeito sob demanda no primeiro register/login.
    try:
        await run_seed()
    except Exception:
        logger.exception("Seed inicial falhou; será refeito na primeira requisição de auth.")
    yield
    await close_client()


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)

# Toda a API vive sob /api — o resto do path é do frontend.
app.include_router(health_router, prefix="/api", tags=["health"])
app.include_router(auth_router, prefix="/api", tags=["auth"])
app.include_router(tenants_router, prefix="/api", tags=["tenants"])
app.include_router(clients_router, prefix="/api", tags=["clients"])
app.include_router(locations_router, prefix="/api", tags=["locations"])
app.include_router(projects_router, prefix="/api", tags=["projects"])
app.include_router(areas_router, prefix="/api", tags=["areas"])
app.include_router(photos_router, prefix="/api", tags=["photos"])
app.include_router(calibrations_router, prefix="/api", tags=["calibrations"])
app.include_router(elements_router, prefix="/api", tags=["elements"])
app.include_router(catalog_router, prefix="/api", tags=["catalog"])
app.include_router(masks_router, prefix="/api", tags=["masks"])
app.include_router(proposals_router, prefix="/api", tags=["proposals"])
app.include_router(versions_router, prefix="/api", tags=["versions"])
app.include_router(presentations_router, prefix="/api", tags=["presentations"])


def _json_safe_float(value: float) -> float | str:
    """`inf`/`NaN` não existem em JSON — viram texto no corpo de erro."""
    return value if math.isfinite(value) else repr(value)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 do Pydantic, com o valor recusado sempre serializável.

    O corpo padrão devolve o `input` que falhou. Se esse input for `inf` ou
    `NaN` — o que a validação recusa de propósito, por exemplo num campo de
    medida —, o encoder JSON estoura e o cliente recebe **500** no lugar do 422
    que a validação já tinha decidido. Aqui o valor vira texto e a resposta sai
    como o erro de validação que de fato é.
    """
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": jsonable_encoder(exc.errors(), custom_encoder={float: _json_safe_float})},
    )


@app.get("/api/{full_path:path}", include_in_schema=False)
async def api_not_found(full_path: str) -> JSONResponse:
    """Path desconhecido sob /api nunca cai no fallback do SPA."""
    raise HTTPException(status_code=404, detail="Endpoint não encontrado")


dist = settings.frontend_dist_path
assets = dist / "assets"
index_html = dist / "index.html"

if assets.is_dir():
    app.mount("/assets", StaticFiles(directory=assets), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str):
    """Serve o arquivo estático quando existe; senão devolve index.html (fallback SPA)."""
    if not index_html.is_file():
        raise HTTPException(
            status_code=503,
            detail=(
                "Build do frontend ausente. Rode `npm run build` em frontend/ "
                "ou use o dev server do Vite."
            ),
        )

    candidate = (dist / full_path).resolve()
    if full_path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
        return FileResponse(candidate)

    return FileResponse(index_html)
