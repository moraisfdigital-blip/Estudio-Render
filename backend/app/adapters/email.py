"""Adaptador de envio de e-mail.

Um contrato só, escolhido por `EMAIL_PROVIDER`:

* `mock` — não sai para a rede. Guarda a mensagem em `CAIXA_DE_SAIDA`, que é
  o que os testes leem. Serve para desenvolver sem conta em provedor nenhum.
* `resend` — API HTTP do Resend. Chave só em `RESEND_API_KEY`; remetente em
  `EMAIL_FROM`, de um domínio verificado lá.

O corpo do e-mail carrega um link com código de uso único. Por isso nada aqui
registra o conteúdo da mensagem em log — só destinatário e assunto.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

logger = logging.getLogger("render_artelux.email")


class EmailError(Exception):
    """Falha do provedor. Quem chama decide o que mostrar."""


@dataclass(frozen=True, slots=True)
class EmailMessage:
    to: str
    subject: str
    text: str
    html: str


class EmailAdapter(ABC):
    name: str

    @abstractmethod
    async def send(self, message: EmailMessage) -> None:
        """Entrega a mensagem ou levanta `EmailError`."""


# Caixa de saída do mock. Limitada para um processo de desenvolvimento longo
# não acumular mensagem sem fim.
CAIXA_DE_SAIDA: list[EmailMessage] = []
_LIMITE_CAIXA = 500


class MockEmailAdapter(EmailAdapter):
    name = "mock"

    async def send(self, message: EmailMessage) -> None:
        CAIXA_DE_SAIDA.append(message)
        del CAIXA_DE_SAIDA[:-_LIMITE_CAIXA]
        logger.info("e-mail (mock) para %s: %s", message.to, message.subject)


class ResendEmailAdapter(EmailAdapter):
    name = "resend"
    _URL = "https://api.resend.com/emails"

    async def send(self, message: EmailMessage) -> None:
        settings = get_settings()
        chave = settings.resend_api_key.get_secret_value()
        if not chave or not settings.email_from:
            raise EmailError("Envio de e-mail não configurado (RESEND_API_KEY/EMAIL_FROM).")
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as cliente:
                resposta = await cliente.post(
                    self._URL,
                    headers={"Authorization": f"Bearer {chave}"},
                    json={
                        "from": settings.email_from,
                        "to": [message.to],
                        "subject": message.subject,
                        "text": message.text,
                        "html": message.html,
                    },
                )
        except httpx.HTTPError as erro:
            raise EmailError(f"Falha de rede ao enviar e-mail: {type(erro).__name__}") from None
        if resposta.status_code >= 300:
            # Só o código: o corpo de erro do provedor pode ecoar o conteúdo.
            raise EmailError(f"Provedor de e-mail respondeu {resposta.status_code}")
        logger.info("e-mail (resend) para %s: %s", message.to, message.subject)


def envio_ligado() -> bool:
    """Há para onde mandar? Com `none`, quem pede link recebe um aviso honesto."""
    return get_settings().email_provider != "none"


def get_email_adapter() -> EmailAdapter:
    """Fábrica por env. Provedor real entra aqui com credencial só no ambiente."""
    provider = get_settings().email_provider
    if provider == "none":
        raise EmailError("Envio de e-mail desligado (EMAIL_PROVIDER=none).")
    if provider == "mock":
        return MockEmailAdapter()
    if provider == "resend":
        return ResendEmailAdapter()
    raise ValueError(f"EMAIL_PROVIDER desconhecido: {provider!r}")
