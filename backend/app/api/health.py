from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness do serviço. Contrato da Fase 1: {"status": "ok"}."""
    return {"status": "ok"}
