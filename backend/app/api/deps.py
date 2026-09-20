"""Dependencies de autenticação.

`get_current_user` é o único lugar que lê o token. Ele devolve o usuário já
carregado e o `TenantScope`, que é o que as rotas usam para escopar query —
a partir da Fase 3 basta declarar `scope: CurrentScope` no handler.
"""

from typing import Annotated, Any

import jwt
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core import audit
from app.core.db import get_db
from app.core.security import decode_access_token
from app.core.tenancy import TenantScope
from app.models import user as user_model

# auto_error=False para responder 401 com nosso próprio corpo (e não 403 do Starlette).
bearer_scheme = HTTPBearer(auto_error=False)

UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Não autenticado",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> dict[str, Any]:
    if credentials is None or not credentials.credentials:
        raise UNAUTHORIZED

    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.PyJWTError:
        raise UNAUTHORIZED from None

    user_id = payload.get("sub")
    tenant_id = payload.get("tid")
    if not user_id or not tenant_id:
        raise UNAUTHORIZED

    try:
        oid = ObjectId(user_id)
    except (InvalidId, TypeError):
        raise UNAUTHORIZED from None

    # Busca escopada: o tenant do token precisa bater com o do documento.
    user = await get_db()[user_model.COLLECTION].find_one({"_id": oid, "tenant_id": tenant_id})
    if user is None:
        raise UNAUTHORIZED
    return user


CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]


async def get_tenant_scope(user: CurrentUser) -> TenantScope:
    return TenantScope(tenant_id=user["tenant_id"])


CurrentScope = Annotated[TenantScope, Depends(get_tenant_scope)]


def require_role(*roles: str):
    """Guarda de papel para as fases seguintes (ex.: aprovar versão é do owner)."""

    async def dependency(user: CurrentUser) -> dict[str, Any]:
        if user.get("role") not in roles:
            audit.falha_de_autorizacao(user=user, papeis=roles)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Seu papel não permite esta ação.",
            )
        return user

    return dependency
