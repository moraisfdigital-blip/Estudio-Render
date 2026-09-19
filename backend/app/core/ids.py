"""Conversão de id de URL para ObjectId.

Um id malformado nunca poderia pertencer ao tenant do usuário, então vira 404 —
a mesma resposta de "existe, mas é de outro tenant". O cliente não descobre
pela diferença de status se um documento existe fora do seu workspace.
"""

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status


def parse_object_id(value: str, *, detail: str) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from None
