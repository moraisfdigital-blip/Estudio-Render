"""Relógio da aplicação. Um só ponto para timestamps — sempre UTC, sempre aware."""

from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    """Datetime lido do Mongo volta sem tzinfo. Remarcamos como UTC para o cliente
    não interpretar o horário como local."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
