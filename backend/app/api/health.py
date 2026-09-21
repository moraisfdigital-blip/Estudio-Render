"""Health check do serviço.

## Por que ele consulta o banco

Um health que só devolve 200 responde 200 com o Mongo fora do ar. O orquestrador
vê "saudável", mantém o container na rotação, e quem recebe o erro é o usuário —
a falha aparece na tela dele em vez de aparecer no deploy.

Então este endpoint faz um `ping` real. Se o banco não responde, o serviço
**não** está saudável e o 503 diz isso, que é o sinal que o orquestrador entende
para tirar o container da rotação ou reiniciá-lo.

## O contrato da Fase 1 continua

`{"status": "ok"}` segue sendo o corpo do caminho feliz; o campo `database` foi
somado a ele. Quem já dependia de `status` não quebra.
"""

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.core.db import get_client

router = APIRouter()


@router.get("/health")
async def health() -> JSONResponse:
    """Liveness + prontidão. 503 quando a dependência essencial está fora."""
    try:
        await get_client().admin.command("ping")
    except Exception as erro:  # noqa: BLE001 — qualquer falha aqui é "banco fora"
        # O tipo do erro entra na resposta, o endereço e a credencial não:
        # este endpoint costuma ficar acessível ao orquestrador e, às vezes,
        # sem autenticação nenhuma.
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "degradado", "database": f"indisponível ({type(erro).__name__})"},
        )

    return JSONResponse(content={"status": "ok", "database": "ok"})
