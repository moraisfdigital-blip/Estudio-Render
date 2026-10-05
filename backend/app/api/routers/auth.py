"""Rotas de autenticação. Todo acesso a `users` é escopado pelo tenant da instalação."""

import html
import logging
import time
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.adapters.email import EmailError, EmailMessage, envio_ligado, get_email_adapter
from app.core.clock import utcnow
from app.models import email_link as email_link_model

from app.api.deps import CurrentUser, TokenPayload
from app.core import audit, ratelimit, revocation
from app.core.config import get_settings
from app.core.db import get_db
from app.core.seed import ensure_default_tenant
from app.core.security import (
    burn_password_time,
    create_access_token,
    hash_password,
    verify_password,
)
from app.models import user as user_model
from app.schemas.auth import (
    AccountUpdateRequest,
    EmailChangeConfirm,
    EmailChangeRequest,
    LoginRequest,
    MessageResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    RegisterRequest,
    TokenResponse,
    UserOut,
)

logger = logging.getLogger("render_artelux.auth")

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
        # Mensagem genérica de propósito: "já existe um usuário com este
        # e-mail" confirma quem está cadastrado para qualquer um que teste
        # endereços. Quem tem a conta descobre pelo login, não por aqui.
        await ratelimit.record_failure(request, scope="register")
        audit.log(
            audit.REGISTRO_DUPLICADO,
            ip=ratelimit.client_ip(request),
            email=payload.email,
            tenant_id=tenant_id,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Não foi possível criar o acesso com estes dados.",
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
    if doc is None:
        # Gasta o tempo do bcrypt mesmo sem ter o que conferir: a diferença de
        # duração entre "não existe" e "senha errada" revelaria quem está
        # cadastrado, tornando a mensagem idêntica inútil.
        burn_password_time(payload.password)

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


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(user: CurrentUser, payload: TokenPayload) -> None:
    """Invalida **este** token.

    Revoga por `jti`, então sair num aparelho não derruba a sessão do outro. O
    registro é apagado sozinho quando o token expiraria — a lista não cresce.
    """
    jti = payload.get("jti")
    if jti:
        await revocation.revoke(
            jti=jti,
            expires_at=revocation.expiry_of(payload),
            user_id=str(user["_id"]),
        )
    audit.log(audit.LOGOUT, tenant_id=user["tenant_id"], user_id=str(user["_id"]))


@router.get("/auth/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    """Hidrata a sessão do frontend. Sem token: 401 (ver app/api/deps.py)."""
    return to_user_out(user)


@router.patch("/auth/me", response_model=UserOut)
async def update_me(payload: AccountUpdateRequest, user: CurrentUser) -> UserOut:
    """Minha conta: troca o nome. Senha e e-mail só mudam pelos links do e-mail."""
    atualizado = await get_db()[user_model.COLLECTION].find_one_and_update(
        {"_id": user["_id"], "tenant_id": user["tenant_id"]},
        {"$set": {"name": payload.name}},
        return_document=ReturnDocument.AFTER,
    )
    audit.log(audit.CONTA_ATUALIZADA, tenant_id=user["tenant_id"], user_id=str(user["_id"]))
    return to_user_out(atualizado)


# ------------------------------------------------- links por e-mail

ENVIO_DESLIGADO = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="O envio de e-mail ainda não está ligado nesta instalação, então o link não pode "
    "ser enviado agora. Fale com o administrador.",
)

LINK_INVALIDO = HTTPException(
    status_code=status.HTTP_400_BAD_REQUEST,
    detail="Este link não vale mais: já foi usado, venceu ou foi substituído. Peça um novo.",
)

# Mesma resposta exista ou não a conta: não revela quem está cadastrado.
RESPOSTA_PEDIDO_SENHA = MessageResponse(
    detail="Se este e-mail estiver cadastrado, enviamos um link para criar a senha nova. "
    "Confira a caixa de entrada e o spam."
)


def _link(caminho: str, codigo: str) -> str:
    base = get_settings().public_base
    if not base:
        # Sem endereço configurado não há link seguro para montar: o Host do
        # pedido não serve (envenenamento de link de redefinição).
        raise EmailError("PUBLIC_BASE_URL não configurado.")
    return f"{base}/{caminho}?token={codigo}"


def _carta(*, para: str, assunto: str, titulo: str, texto: str, botao: str, link: str) -> EmailMessage:
    minutos = get_settings().email_link_minutes
    rodape = (
        f"O link vale por {minutos} minutos e só pode ser usado uma vez. "
        "Se não foi você, ignore este e-mail."
    )
    corpo_texto = f"{titulo}\n\n{texto}\n\n{link}\n\n{rodape}\n\nENBY PRO"
    corpo_html = (
        '<div style="font-family:Arial,sans-serif;max-width:520px;color:#2d3438">'
        f'<h2 style="font-weight:600">{html.escape(titulo)}</h2>'
        f"<p>{html.escape(texto)}</p>"
        f'<p><a href="{html.escape(link)}" style="display:inline-block;background:#00bdb5;'
        f'color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">'
        f"{html.escape(botao)}</a></p>"
        f'<p style="font-size:12px;color:#727d80">{html.escape(rodape)}</p>'
        '<p style="font-size:12px;color:#727d80">ENBY PRO</p></div>'
    )
    return EmailMessage(to=para, subject=assunto, text=corpo_texto, html=corpo_html)


async def _novo_link(
    *, tipo: email_link_model.Tipo, user: dict[str, Any], email: str, new_email: str | None = None
) -> str:
    """Grava um link novo e anula os anteriores do mesmo tipo para esta conta."""
    db = get_db()[email_link_model.COLLECTION]
    await db.delete_many({"user_id": str(user["_id"]), "kind": tipo, "used_at": None})
    codigo = email_link_model.novo_codigo()
    await db.insert_one(
        email_link_model.new_link_doc(
            tipo=tipo,
            codigo=codigo,
            user_id=str(user["_id"]),
            tenant_id=user["tenant_id"],
            email=email,
            new_email=new_email,
            minutos=get_settings().email_link_minutes,
        )
    )
    return codigo


async def _consome_link(tipo: email_link_model.Tipo, codigo: str) -> dict[str, Any]:
    """Marca o link como usado numa operação só: dois cliques simultâneos não
    conseguem usar o mesmo código duas vezes."""
    doc = await get_db()[email_link_model.COLLECTION].find_one_and_update(
        {
            "token_hash": email_link_model.hash_do_codigo(codigo),
            "kind": tipo,
            "used_at": None,
            "expires_at": {"$gt": utcnow()},
        },
        {"$set": {"used_at": utcnow()}},
    )
    if doc is None:
        audit.log(audit.LINK_INVALIDO, detalhe=tipo)
        raise LINK_INVALIDO
    return doc


def _encerra_sessoes() -> dict[str, Any]:
    """Tokens emitidos até este milissegundo deixam de valer (ver deps)."""
    return {"tokens_valid_after_ms": int(time.time() * 1000)}


@router.post(
    "/auth/password-reset/request",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def password_reset_request(payload: PasswordResetRequest, request: Request) -> MessageResponse:
    """Trocar a senha: digite o e-mail, o link chega lá. Não existe outro caminho."""
    ip = ratelimit.client_ip(request)
    try:
        await ratelimit.enforce(request, scope="password_reset")
    except HTTPException:
        audit.log(audit.SENHA_LINK_BLOQUEADO, ip=ip, email=payload.email)
        raise
    # Todo pedido conta no limite, exista a conta ou não: é o que impede usar
    # a rota para encher a caixa de alguém.
    await ratelimit.record_failure(request, scope="password_reset")
    # Sem envio configurado, dizer "enviamos" seria mentir. O aviso é igual
    # para qualquer e-mail, então não revela quem está cadastrado.
    if not envio_ligado():
        raise ENVIO_DESLIGADO

    tenant_id = await ensure_default_tenant()
    email = user_model.normalize_email(payload.email)
    user = await get_db()[user_model.COLLECTION].find_one({"tenant_id": tenant_id, "email": email})
    audit.log(
        audit.SENHA_LINK_PEDIDO,
        ip=ip,
        email=email,
        tenant_id=tenant_id,
        user_id=str(user["_id"]) if user else None,
    )
    if user is None:
        return RESPOSTA_PEDIDO_SENHA

    codigo = await _novo_link(tipo="password", user=user, email=email)
    try:
        await get_email_adapter().send(
            _carta(
                para=email,
                assunto="ENBY PRO — criar uma senha nova",
                titulo="Criar uma senha nova",
                texto="Recebemos um pedido para trocar a senha da sua conta no ENBY PRO. "
                "Clique no botão para definir a senha nova.",
                botao="Criar senha nova",
                link=_link("redefinir-senha", codigo),
            )
        )
    except EmailError as erro:
        # A resposta continua a mesma (não revela a conta); o erro fica no log
        # do servidor para quem opera.
        logger.error("Falha ao enviar link de senha: %s", erro)
        audit.log(audit.EMAIL_FALHOU, email=email, tenant_id=tenant_id, detalhe=str(erro))
    return RESPOSTA_PEDIDO_SENHA


@router.post("/auth/password-reset/confirm", response_model=MessageResponse)
async def password_reset_confirm(payload: PasswordResetConfirm) -> MessageResponse:
    link = await _consome_link("password", payload.token)
    resultado = await get_db()[user_model.COLLECTION].update_one(
        {"_id": ObjectId(link["user_id"]), "tenant_id": link["tenant_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password), **_encerra_sessoes()}},
    )
    if resultado.matched_count == 0:
        raise LINK_INVALIDO
    audit.log(
        audit.SENHA_REDEFINIDA,
        email=link["email"],
        tenant_id=link["tenant_id"],
        user_id=link["user_id"],
    )
    return MessageResponse(detail="Senha nova salva. Entre com ela.")


@router.post(
    "/auth/email-change/request",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def email_change_request(
    payload: EmailChangeRequest, request: Request, user: CurrentUser
) -> MessageResponse:
    """Trocar o e-mail de login. Só vale depois que o dono do e-mail novo
    clicar no link: um endereço digitado errado não tranca a conta."""
    await ratelimit.enforce(request, scope="email_change")
    await ratelimit.record_failure(request, scope="email_change")
    if not envio_ligado():
        raise ENVIO_DESLIGADO

    novo = user_model.normalize_email(payload.new_email)
    if novo == user["email"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Este já é o seu e-mail."
        )
    if await get_db()[user_model.COLLECTION].find_one({"tenant_id": user["tenant_id"], "email": novo}):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Este e-mail já é usado por outra conta."
        )

    codigo = await _novo_link(tipo="email", user=user, email=user["email"], new_email=novo)
    try:
        await get_email_adapter().send(
            _carta(
                para=novo,
                assunto="ENBY PRO — confirme seu e-mail",
                titulo="Confirme seu e-mail",
                texto=f"Este endereço foi indicado como o novo e-mail de acesso de {user['name']} "
                "no ENBY PRO. Clique no botão para confirmar. A partir daí, o login passa a ser "
                "com este e-mail.",
                botao="Confirmar e-mail",
                link=_link("confirmar-email", codigo),
            )
        )
    except EmailError as erro:
        logger.error("Falha ao enviar confirmação de e-mail: %s", erro)
        audit.log(audit.EMAIL_FALHOU, email=novo, tenant_id=user["tenant_id"], detalhe=str(erro))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível enviar o e-mail de confirmação agora. "
            "Tente de novo em alguns minutos.",
        ) from None
    audit.log(audit.EMAIL_LINK_PEDIDO, email=novo, tenant_id=user["tenant_id"], user_id=str(user["_id"]))
    return MessageResponse(
        detail=f"Enviamos um link de confirmação para {novo}. O e-mail só muda depois do clique."
    )


@router.post("/auth/email-change/confirm", response_model=MessageResponse)
async def email_change_confirm(payload: EmailChangeConfirm) -> MessageResponse:
    link = await _consome_link("email", payload.token)
    try:
        resultado = await get_db()[user_model.COLLECTION].update_one(
            {"_id": ObjectId(link["user_id"]), "tenant_id": link["tenant_id"]},
            {"$set": {"email": link["new_email"], **_encerra_sessoes()}},
        )
    except DuplicateKeyError:
        # Alguém ficou com este e-mail entre o pedido e o clique.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Este e-mail já é usado por outra conta."
        ) from None
    if resultado.matched_count == 0:
        raise LINK_INVALIDO
    audit.log(
        audit.EMAIL_ALTERADO,
        email=link["new_email"],
        tenant_id=link["tenant_id"],
        user_id=link["user_id"],
        detalhe=f"antes: {link['email']}",
    )
    return MessageResponse(detail="E-mail confirmado. Entre com o e-mail novo.")
