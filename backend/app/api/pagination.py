"""Paginação das listagens.

Toda rota de lista devolvia a coleção inteira. Num levantamento pequeno isso
não incomoda; num projeto com centenas de fotos, ou num catálogo com todas as
cores de todos os vinis, cada chamada carrega tudo para a memória do servidor e
manda tudo pela rede — e o custo cresce sem teto junto com o uso.

## Compatível com quem já chama

`limit` e `offset` são opcionais e têm padrão. Quem não passa nada continua
recebendo uma lista, agora com teto — nenhuma tela existente precisou mudar.

## O teto não é negociável pelo cliente

`limit` tem máximo. Sem isso a paginação seria decorativa: bastaria pedir
`?limit=999999` para reproduzir exatamente o problema que ela resolve.
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query

# Cobre com folga o uso real (uma área raramente passa de algumas dezenas de
# fotos) sem deixar a porta aberta.
DEFAULT_LIMIT = 100

# Teto absoluto. Nem o cliente mais bem-intencionado passa disto.
MAX_LIMIT = 500


@dataclass(frozen=True, slots=True)
class Page:
    limit: int
    offset: int


def page_params(
    limit: Annotated[
        int,
        Query(ge=1, le=MAX_LIMIT, description=f"Itens por página (máximo {MAX_LIMIT})."),
    ] = DEFAULT_LIMIT,
    offset: Annotated[int, Query(ge=0, description="Itens a pular.")] = 0,
) -> Page:
    return Page(limit=limit, offset=offset)


PageDep = Annotated[Page, Depends(page_params)]
