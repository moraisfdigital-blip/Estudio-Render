"""Limite de tentativas nas rotas de autenticação.

Sem isto, `POST /auth/login` aceita quantas tentativas o atacante quiser: uma
lista de senhas comuns contra um e-mail conhecido roda em minutos, e o bcrypt
só deixa isso mais lento — não impossível.

## Por que no Mongo e não em memória

Um contador em memória vale por processo. Dois workers do uvicorn dobram o
limite real, e um restart zera tudo. O Mongo já está aqui, é compartilhado, e
um índice TTL apaga os registros velhos sozinho — sem tarefa de limpeza.

## Por que só por IP

Contar falhas **por e-mail** parece mais preciso, mas cria uma porta de negação
de serviço: qualquer um erra a senha do e-mail de alguém da ARTELUX de
propósito até a conta travar. O que se ganha (barrar força bruta contra uma
conta específica vinda de muitos IPs) é menor do que o que se perde.

Ataque distribuído de muitos IPs não é resolvido aqui — isso é trabalho de
borda (proxy, WAF, Cloudflare). O que esta camada resolve é o caso real e
comum: alguém martelando de um lugar só.

## IP atrás de proxy

`request.client.host` é o IP de quem abriu a conexão. Se a app estiver atrás de
um proxy, isso vira o IP do proxy e o limite passaria a valer para todo mundo
junto. `X-Forwarded-For` resolve, mas é um cabeçalho que **qualquer cliente
pode forjar** — confiar nele sem proxy na frente daria ao atacante um limite
novo a cada requisição.

Por isso a leitura do cabeçalho só acontece com `TRUST_PROXY_HEADERS=true`,
que deve ser ligado **apenas** quando existe de fato um proxy confiável
reescrevendo esse valor.
"""

from datetime import timedelta
from typing import Any

from fastapi import HTTPException, Request, status

from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.db import get_db

COLLECTION = "auth_attempts"

TOO_MANY = (
    "Muitas tentativas de acesso deste endereço. "
    "Espere alguns minutos antes de tentar de novo."
)


def client_ip(request: Request) -> str:
    """IP do cliente, honrando o proxy só quando isso foi declarado seguro."""
    settings = get_settings()
    if settings.trust_proxy_headers:
        encaminhado = request.headers.get("x-forwarded-for")
        if encaminhado:
            # O primeiro da lista é o cliente original; o resto são os proxies.
            return encaminhado.split(",")[0].strip()
    return request.client.host if request.client else "desconhecido"


def _janela_inicio() -> Any:
    return utcnow() - timedelta(minutes=get_settings().auth_rate_limit_window_minutes)


async def enforce(request: Request, *, scope: str) -> None:
    """Recusa com 429 quando o IP já estourou o limite da janela.

    Chamada **antes** de verificar a senha: o objetivo é não gastar bcrypt (nem
    dar sinal de acerto) para quem já passou do limite.
    """
    settings = get_settings()
    limite = settings.auth_rate_limit_attempts
    if limite <= 0:
        return

    tentativas = await get_db()[COLLECTION].count_documents(
        {"ip": client_ip(request), "scope": scope, "at": {"$gte": _janela_inicio()}}
    )
    if tentativas >= limite:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=TOO_MANY,
            # Dá ao cliente legítimo uma instrução clara de quando voltar.
            headers={"Retry-After": str(settings.auth_rate_limit_window_minutes * 60)},
        )


async def record_failure(request: Request, *, scope: str) -> None:
    """Registra uma tentativa fracassada. O TTL do índice apaga sozinho."""
    await get_db()[COLLECTION].insert_one(
        {"ip": client_ip(request), "scope": scope, "at": utcnow()}
    )


async def clear(request: Request, *, scope: str) -> None:
    """Limpa as falhas deste IP depois de um acesso bem-sucedido.

    Quem acertou a senha não deve continuar carregando o histórico de erros de
    digitação — senão o usuário legítimo que errou três vezes e acertou na
    quarta ficaria perto do limite sem motivo.
    """
    await get_db()[COLLECTION].delete_many({"ip": client_ip(request), "scope": scope})
