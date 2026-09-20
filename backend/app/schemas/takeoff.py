"""Contratos do quantitativo e das linhas de orçamento.

O preço **sempre** vem de quem digitou: não existe campo para o servidor
preencher valor, e o catálogo não guarda preço nenhum. Quando o preço é
informado, a linha registra isso explicitamente — quem lê o orçamento sabe que
aquele número é uma decisão humana, não uma tabela.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.models.takeoff import UNIT_AREA, UNITS
from app.schemas.common import LongText, Name

Unit = Annotated[str, Field(pattern=f"^({'|'.join(UNITS)})$")]

# Quantidade e preço positivos e finitos. Zero em preço é possível (brinde,
# cortesia), mas zero em quantidade é linha que não deveria existir.
Quantity = Annotated[float, Field(gt=0, lt=1e9)]
Price = Annotated[float, Field(ge=0, lt=1e9)]


class ManualItemIn(BaseModel):
    """Linha que não vem de elemento: instalação, frete, projeto."""

    model_config = ConfigDict(extra="forbid")

    description: Name
    quantity: Quantity
    unit: Unit = UNIT_AREA
    unit_price: Price | None = None
    notes: LongText = None


class BudgetItemUpdate(BaseModel):
    """Preço e quantidade da linha.

    Informar quantidade aqui marca a procedência como `user_informed` — o
    servidor não deixa um número digitado passar por medida de campo.
    """

    model_config = ConfigDict(extra="forbid")

    quantity: Quantity | None = None
    unit: Unit | None = None
    unit_price: Price | None = None
    notes: LongText = None


class TakeoffItemOut(BaseModel):
    id: str
    origin: str
    element_id: str | None = None
    photo_id: str | None = None
    description: str
    kind_label: str | None = None
    material_name: str | None = None
    finish_name: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    quantity: float | None = None
    unit: str
    quantity_source: str | None = None
    # Rótulo pronto do servidor: a tela é obrigada a mostrar estimativa como
    # estimativa, e não deve montar esse texto sozinha.
    quantity_source_label: str | None = None
    quantity_note: str | None = None
    unit_price: float | None = None
    # `None` enquanto faltar quantidade ou preço — nunca zero, que somaria como
    # se a linha não custasse nada.
    line_total: float | None = None
    notes: str | None = None


class TakeoffOut(BaseModel):
    project_id: str
    tenant_id: str
    items: list[TakeoffItemOut] = Field(default_factory=list)
    # `false` enquanto ninguém gerou: a leitura devolve o que está salvo, e a
    # tela mostra o estado vazio com o botão de gerar.
    generated: bool = False
    # Soma das linhas que têm quantidade E preço.
    total: float | None = None
    # Quantas linhas ainda não têm preço. Enquanto for maior que zero, o total
    # é parcial — e a tela diz isso.
    items_without_price: int = 0
    # Quantas linhas carregam quantidade estimada. É o aviso de que o orçamento
    # se apoia em número que ninguém mediu.
    items_with_estimate: int = 0
    # Elementos conferidos que não entraram por falta de medida.
    skipped_without_measurement: int = 0
    generated_at: datetime | None = None
    updated_at: datetime | None = None
