"""Hash de senha (bcrypt) e emissão/verificação de JWT. Segredo e TTL vêm de env."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import get_settings

# bcrypt trunca em 72 bytes; recusamos antes para não aceitar senha "silenciosamente cortada".
MAX_PASSWORD_BYTES = 72


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# Hash descartável usado quando o e-mail não existe. Sem ele, o login responde
# na hora para usuário inexistente e depois do bcrypt para usuário existente —
# e essa diferença de tempo denuncia quem está cadastrado, mesmo com a
# mensagem de erro sendo idêntica.
_DUMMY_HASH = bcrypt.hashpw(b"hash-descartavel-para-igualar-o-tempo", bcrypt.gensalt())


def burn_password_time(plain: str) -> None:
    """Gasta o mesmo tempo de um `verify_password` que falha.

    Chamado quando o usuário não existe, para o custo do login não revelar a
    existência da conta.
    """
    bcrypt.checkpw(plain.encode("utf-8")[:MAX_PASSWORD_BYTES], _DUMMY_HASH)


def verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Hash malformado no banco: trata como credencial inválida, não como 500.
        return False


def create_access_token(*, user_id: str, tenant_id: str, role: str) -> str:
    """Token de acesso. `tid` (tenant) viaja no token e é a base do escopo de toda query."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "tid": tenant_id,
        "role": role,
        # Identificador único do token. É o que permite revogar ESTE token no
        # logout sem derrubar as outras sessões da mesma pessoa — e sem trocar
        # o segredo, que derrubaria o workspace inteiro.
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decodifica e valida assinatura/expiração. Lança jwt.PyJWTError se inválido."""
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
