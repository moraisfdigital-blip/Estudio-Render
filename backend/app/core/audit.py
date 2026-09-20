"""Log de eventos de segurança.

Sem isto, um ataque não deixa rastro: login falho, acesso negado e tentativa de
alcançar outro workspace passavam sem registro nenhum. Não dava para saber que
alguém tentou — nem depois, olhando para trás.

## O que NUNCA entra aqui

Senha (nem com hash), token, cabeçalho `Authorization`, corpo de requisição de
login. A função abaixo aceita campos nomeados justamente para não haver a
tentação de despejar o request inteiro: quem chamar precisa escolher o que
registra.

O e-mail entra porque é o que permite responder "tentaram entrar na conta de
quem?" — e ele já está no banco de qualquer forma. A senha tentada, não: saber
qual senha o atacante chutou não ajuda em nada e transforma o log num alvo.

## Formato

Uma linha por evento, com campos fixos, para dar `grep` quando precisar:

    SEGURANCA evento=login_falhou ip=1.2.3.4 email=fulano@x.com tenant=- detalhe=-
"""

import logging
from typing import Any

logger = logging.getLogger("render_artelux.seguranca")

# Eventos registrados. Lista fechada para o log ser previsível e pesquisável.
LOGIN_OK = "login_ok"
LOGIN_FALHOU = "login_falhou"
LOGIN_BLOQUEADO = "login_bloqueado"
REGISTRO_OK = "registro_ok"
REGISTRO_FECHADO = "registro_fechado"
REGISTRO_BLOQUEADO = "registro_bloqueado"
TOKEN_INVALIDO = "token_invalido"
PAPEL_NEGADO = "papel_negado"


def log(
    evento: str,
    *,
    ip: str | None = None,
    email: str | None = None,
    tenant_id: str | None = None,
    user_id: str | None = None,
    detalhe: str | None = None,
) -> None:
    """Registra um evento de segurança.

    Campos ausentes viram `-`, para a linha ter sempre o mesmo formato e a
    busca não depender de qual evento é.
    """
    partes = {
        "evento": evento,
        "ip": ip,
        "email": email,
        "tenant": tenant_id,
        "user": user_id,
        "detalhe": detalhe,
    }
    logger.info(
        "SEGURANCA " + " ".join(f"{chave}={valor or '-'}" for chave, valor in partes.items())
    )


def falha_de_autorizacao(*, user: dict[str, Any], papeis: tuple[str, ...]) -> None:
    """Papel insuficiente numa rota protegida.

    Registrar isto é o que diferencia "editor clicou onde não devia" de
    "alguém está varrendo as rotas de owner uma a uma".
    """
    log(
        PAPEL_NEGADO,
        tenant_id=user.get("tenant_id"),
        user_id=str(user.get("_id", "")),
        detalhe=f"papel={user.get('role')} exigido={'|'.join(papeis)}",
    )
