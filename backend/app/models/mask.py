"""Documento `masks` — onde a geração pode mexer, e onde ela não pode.

Uma máscara por foto, com N camadas. Cada camada é um polígono desenhado pelo
usuário sobre o **original**, em coordenada de pixel da própria imagem — a
mesma convenção da calibração (Fase 5) e do retângulo do elemento (Fase 6).

## As duas camadas e por que são opostas

* `intervention` — **aqui pode**. É o recorte da peça que vai mudar na
  proposta: a placa que será trocada, a faixa que será reimpressa.
* `protect` — **aqui não pode nunca**. É o que precisa sobreviver intacto:
  janela, telhado, poste, o prédio do vizinho.

Na Fase 9 o adapter de geração recebe estas duas listas e só tem permissão de
escrever pixel que esteja dentro de `intervention` e fora de `protect`. Por
isso `protect` vence o empate: se um polígono de proteção cruza um de
intervenção, a interseção é proteção. A regra é conservadora de propósito —
errar para o lado de não mexer na arquitetura do cliente.

## Architecture Lock

O lock vive no **projeto**, não aqui (`projects.architecture_lock`), porque é
uma decisão do trabalho inteiro e não de uma foto. Este módulo só sabe
responder se a foto tem máscara de intervenção; quem cruza isso com o lock para
liberar ou recusar a geração é `generation_block()`.

## O original continua intocado

Como a calibração, a máscara é documento novo no Mongo. O arquivo da foto é
aberto só para leitura, e só para saber largura e altura — o que permite
recusar polígono fora da imagem. Nenhum byte do original é reescrito.
"""

import uuid
from typing import Any

from app.core.clock import utcnow

COLLECTION = "masks"

INTERVENTION = "intervention"
PROTECT = "protect"

KINDS: tuple[str, ...] = (INTERVENTION, PROTECT)

KIND_LABELS = {
    INTERVENTION: "Intervenção",
    PROTECT: "Proteção",
}

# Um polígono precisa de três vértices para ter interior. Com dois, é um
# segmento de reta: não delimita área nenhuma para a geração escrever dentro.
MIN_POINTS = 3

# Tetos de payload. Uma máscara de fachada real tem dezenas de vértices, não
# milhares — o limite existe para um cliente com defeito (ou má-fé) não gravar
# um documento de megabytes que a Fase 9 teria que carregar a cada geração.
MAX_POINTS = 500
MAX_LAYERS = 50

# Área mínima do polígono, em pixels quadrados. Abaixo disso é sobra de clique
# (três toques quase no mesmo lugar), não recorte de peça — e uma máscara de
# intervenção com área ~0 deixaria a geração "liberada" sem ter onde escrever.
MIN_AREA_PX = 64.0


def polygon_area(points: list[tuple[float, float]]) -> float:
    """Área do polígono pela fórmula do shoelace, sempre positiva.

    Serve para recusar polígono degenerado. O sinal (orientação horária ou
    anti-horária) não interessa: o usuário desenha no sentido que quiser.
    """
    total = 0.0
    for index, (x, y) in enumerate(points):
        next_x, next_y = points[(index + 1) % len(points)]
        total += x * next_y - next_x * y
    return abs(total) / 2.0


def new_layer(
    *,
    kind: str,
    label: str,
    points: list[tuple[float, float]],
) -> dict[str, Any]:
    """Uma camada pronta para gravar.

    O `id` nasce no servidor: a tela precisa de chave estável para listar e
    remover camada, e deixar o cliente escolher o id abriria caminho para
    duas camadas com o mesmo identificador no mesmo documento.
    """
    return {
        "id": uuid.uuid4().hex,
        "kind": kind,
        "label": label,
        "points": [{"x": x, "y": y} for x, y in points],
        "area_px": round(polygon_area(points), 2),
    }


def mask_fields(
    *,
    layers: list[dict[str, Any]],
    image_width: int,
    image_height: int,
    updated_by: str,
) -> dict[str, Any]:
    """Campos do `$set` do upsert. O PUT substitui o conjunto inteiro de camadas.

    Substituir (em vez de acumular) é o que faz a tela de desenho ser honesta:
    o que está na tela ao salvar é exatamente o que fica no banco. As dimensões
    ficam gravadas junto para a Fase 9 saber contra qual tamanho de imagem
    aqueles pixels foram marcados.
    """
    return {
        "layers": layers,
        "image_width": image_width,
        "image_height": image_height,
        "updated_by": updated_by,
        "updated_at": utcnow(),
    }


def layers_of(doc: dict[str, Any] | None, kind: str) -> list[dict[str, Any]]:
    """Camadas de um tipo. Documento ausente é o mesmo que nenhuma camada."""
    if not doc:
        return []
    return [layer for layer in doc.get("layers", []) if layer.get("kind") == kind]


def has_intervention(doc: dict[str, Any] | None) -> bool:
    """Existe ao menos um recorte onde a geração poderia escrever?"""
    return bool(layers_of(doc, INTERVENTION))


# Motivos de recusa da geração. Ficam aqui, e não no router da Fase 9, para a
# tela da Fase 8 poder dizer *hoje* por que o botão de gerar ainda não liberou —
# com o mesmo texto que a API usará quando recusar de verdade.
NO_INTERVENTION = (
    "Esta foto não tem máscara de intervenção. Sem um recorte marcando onde a "
    "peça pode mudar, não há onde gerar — e gerar 'por fora' alteraria a "
    "arquitetura do cliente."
)
LOCK_OFF = (
    "O Architecture Lock está desligado neste projeto. Ligue o lock para gerar: "
    "ele é o que garante que a proposta preserva a arquitetura original."
)


def generation_block(
    *, mask_doc: dict[str, Any] | None, architecture_lock: bool
) -> str | None:
    """Por que a geração está bloqueada, ou `None` se está liberada.

    A Fase 9 chama isto antes de tocar no adapter e devolve 422 com este texto.
    A Fase 8 chama para a tela explicar o bloqueio antes de o botão existir.
    """
    if not architecture_lock:
        return LOCK_OFF
    if not has_intervention(mask_doc):
        return NO_INTERVENTION
    return None
