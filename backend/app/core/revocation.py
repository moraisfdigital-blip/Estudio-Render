"""Revogação de token.

JWT é autocontido: uma vez assinado, ele vale até expirar. Sem uma lista de
revogação, "sair" é só apagar o token do navegador — quem tiver uma cópia
continua entrando pelas próximas 12 horas.

## Por que não trocar o segredo

Trocar `JWT_SECRET` invalida tudo de todo mundo. Serve para um incidente, não
para alguém clicar em "sair" no fim do expediente.

## Por que no Mongo, com TTL

A lista precisa valer entre processos e sobreviver a restart — os mesmos
motivos do limite de tentativas. E ela não cresce para sempre: cada registro é
apagado pelo índice TTL quando o token que ele bloqueia já teria expirado
sozinho. Guardar mais tempo do que isso não protegeria nada.
"""

from datetime import datetime, timezone

from app.core.clock import utcnow
from app.core.db import get_db

COLLECTION = "revoked_tokens"


async def revoke(*, jti: str, expires_at: datetime, user_id: str) -> None:
    """Marca um token como inválido até o momento em que ele expiraria."""
    await get_db()[COLLECTION].update_one(
        {"jti": jti},
        {
            "$set": {
                "jti": jti,
                "user_id": user_id,
                # O TTL usa este campo: passado o `exp`, o registro some porque
                # o próprio token já não vale mais.
                "expires_at": expires_at,
                "revoked_at": utcnow(),
            }
        },
        upsert=True,
    )


async def is_revoked(jti: str | None) -> bool:
    """Token sem `jti` é de antes desta mudança e continua valendo até expirar.

    Tratar a ausência como revogado deslogaria todo mundo no deploy; tratá-la
    como válida é seguro porque esses tokens expiram sozinhos em horas.
    """
    if not jti:
        return False
    return await get_db()[COLLECTION].find_one({"jti": jti}) is not None


def expiry_of(payload: dict) -> datetime:
    """`exp` do token como datetime com fuso — é o que o índice TTL precisa."""
    return datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
