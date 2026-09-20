"""Imagens de teste e checksum.

As suítes sobem imagem de verdade porque a app decide pelo **conteúdo**: o
upload reconhece o formato pelos bytes iniciais (não pelo `Content-Type` que o
cliente mandou) e a validação do retângulo do elemento depende das dimensões
reais da foto. Um `b"fake"` não passaria por nenhum dos dois — e não deveria.
"""

import hashlib
import io

from PIL import Image


def imagem_jpeg(cor: tuple[int, int, int], tamanho: tuple[int, int]) -> bytes:
    """JPEG sólido. Formato das fotos de levantamento (celular)."""
    buffer = io.BytesIO()
    Image.new("RGB", tamanho, cor).save(buffer, format="JPEG", quality=88)
    return buffer.getvalue()


def imagem_png(cor: tuple[int, int, int], tamanho: tuple[int, int] = (120, 60)) -> bytes:
    """PNG sólido. Formato típico de logo de marca."""
    buffer = io.BytesIO()
    Image.new("RGB", tamanho, cor).save(buffer, format="PNG")
    return buffer.getvalue()


def sha256(conteudo: bytes) -> str:
    return hashlib.sha256(conteudo).hexdigest()
