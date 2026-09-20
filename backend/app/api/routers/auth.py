"""Rotas de autenticação. Todo acesso a `users` é escopado pelo tenant da instalação."""

from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pymongo.errors import DuplicateKeyError

from app.api.deps import CurrentUser
from app.core import audit, ratelimit
from app.core.config import get_settings
from app.core.db import get_db
from app.core.seed import ensure_default_tenant
from app.core.security import create_access_token, hash_password, verify_password
from app.models import user as user_model
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserOut

router = APIRouter()

INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="E-mail ou senha inválidos",
    headers={"WWW-Authenticate": "Bearer"},
)


def to_user_out(doc: dict[str, Any]) -> UserOut:
    return UserOut(
        id=str(doc["_id"]),
        tenant_id=doc["tenant_id"],
        email=doc["email"],
        name=doc["name"],
        role=doc["role"],
    )


def token_response(doc: dict[str, Any]) -> TokenResponse:
    user = to_user_out(doc)
    return TokenResponse(
        access_token=create_access_token(
            user_id=user.id, tenant_id=user.tenant_id, role=user.role
        ),
        user=user,
    )


@router.post("/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, request: Request) -> TokenResponse:
    """Registro interno no tenant da instalação. `owner` só existe via seed.

    Fechado por padrão (`ALLOW_SELF_REGISTER=false`): aberto, qualquer um que
    alcance a URL vira editor e enxerga os levantamentos do workspace.
    """
    try:
        await ratelimit.enforce(request, scope="register")
    except HTTPException:
        audit.log(audit.REGISTRO_BLOQUEADO, ip=ratelimit.client_ip(request))
        raise
    settings = get_settings()
    if not settings.allow_self_register:
        # Conta como tentativa: varrer a rota fechada também é reconhecimento.
        await ratelimit.record_failure(request, scope="register")
        audit.log(
            audit.REGISTRO_FECHADO,
            ip=ratelimit.client_ip(request),
            email=payload.email,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registro fechado nesta instalação.",
        )

    tenant_id = await ensure_default_tenant()
    doc = user_model.new_user_doc(
        tenant_id=tenant_id,
        email=payload.email,
        password_hash=hash_password(payload.password),
        name=payload.name,
        role="editor",
    )

    try:
        result = await get_db()[user_model.COLLECTION].insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe um usuário com este e-mail.",
        ) from None

    criado = {**doc, "_id": result.inserted_id}
    audit.log(
        audit.REGISTRO_OK,
        ip=ratelimit.client_ip(request),
        email=doc["email"],
        tenant_id=tenant_id,
        user_id=str(result.inserted_id),
    )
    return token_response(criado)


@router.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request) -> TokenResponse:
    """Entra no workspace.

    O limite por IP é conferido **antes** da senha: quem já estourou não gasta
    bcrypt do servidor nem recebe qualquer sinal sobre a credencial tentada.
    """
    try:
        await ratelimit.enforce(request, scope="login")
    except HTTPException:
        audit.log(
            audit.LOGIN_BLOQUEADO, ip=ratelimit.client_ip(request), email=payload.email
        )
        raise

    tenant_id = await ensure_default_tenant()
    doc = await get_db()[user_model.COLLECTION].find_one(
        {"tenant_id": tenant_id, "email": user_model.normalize_email(payload.email)}
    )
    # Mesma resposta para usuário inexistente e senha errada: não revela quem existe.
    if doc is None or not verify_password(payload.password, doc["password_hash"]):
        await ratelimit.record_failure(request, scope="login")
        # Só o e-mail tentado. A senha chutada não entra no log: não ajuda em
        # nada e transformaria o arquivo de log num alvo.
        audit.log(
            audit.LOGIN_FALHOU, ip=ratelimit.client_ip(request), email=payload.email
        )
        raise INVALID_CREDENTIALS

    # Acertou: o histórico de erros de digitação deste IP não precisa mais
    # pesar contra ele.
    await ratelimit.clear(request, scope="login")
    audit.log(
        audit.LOGIN_OK,
        ip=ratelimit.client_ip(request),
        email=doc["email"],
        tenant_id=doc["tenant_id"],
        user_id=str(doc["_id"]),
    )
    return token_response(doc)


@router.get("/auth/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    """Hidrata a sessão do frontend. Sem token: 401 (ver app/api/deps.py)."""
    return to_user_out(user)
