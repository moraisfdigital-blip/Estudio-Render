"""Tipos compartilhados pelos contratos de entrada.

Campo de texto opcional vindo de formulário chega como `""` quando o usuário não
preencheu. Normalizamos para `None` na borda para o banco não guardar string
vazia em uns documentos e ausência em outros.
"""

from typing import Annotated, Any

from pydantic import BeforeValidator, Field


def _blank_to_none(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return value


def _strip(value: Any) -> Any:
    return value.strip() if isinstance(value, str) else value


BlankToNone = BeforeValidator(_blank_to_none)
Strip = BeforeValidator(_strip)

# Constraint dentro do ramo `str`: aplicar `max_length` sobre o union `str | None`
# quebra na hora que o valor chega nulo.
Name = Annotated[str, Strip, Field(min_length=1, max_length=160)]
ShortText = Annotated[Annotated[str, Field(max_length=160)] | None, BlankToNone]
Phone = Annotated[Annotated[str, Field(max_length=40)] | None, BlankToNone]
StateText = Annotated[Annotated[str, Field(max_length=40)] | None, BlankToNone]
Address = Annotated[Annotated[str, Field(max_length=300)] | None, BlankToNone]
LongText = Annotated[Annotated[str, Field(max_length=2000)] | None, BlankToNone]
