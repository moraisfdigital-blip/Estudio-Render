"""Dimensões em pixel da foto original, lidas do cabeçalho do arquivo.

A calibração é feita em **coordenadas de pixel do original**: sem saber a
largura e a altura reais, o servidor não teria como recusar um ponto fora da
foto — aceitaria qualquer par de coordenadas que o cliente mandasse e gravaria
uma escala impossível.

O arquivo é aberto em modo leitura e só o cabeçalho é percorrido: nada aqui
escreve, move ou reprocessa o original. É um leitor, no mesmo espírito do
`media.resolve`.

Não usamos Pillow de propósito. Só precisamos de largura e altura dos três
formatos que o upload aceita (JPEG, PNG e WebP, conferidos por assinatura em
`app.core.media`), e isso são poucas dezenas de linhas — não vale arrastar uma
dependência de processamento de imagem inteira para a instalação.
"""

from pathlib import Path

# Marcadores JPEG que carregam o frame header (largura/altura). A faixa C0..CF
# é de SOF, tirando DHT (C4), JPG (C8) e DAC (CC), que não são frame headers.
_JPEG_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
# Marcadores sem payload: não têm campo de tamanho para pular.
_JPEG_STANDALONE = {0x01, *range(0xD0, 0xD8)}


class UnreadableImage(Exception):
    """Cabeçalho que não permite descobrir largura e altura."""


def _jpeg_size(handle) -> tuple[int, int]:
    """Anda de marcador em marcador até o frame header.

    O SOF não fica num offset fixo: EXIF, miniatura embutida e tabelas de
    quantização vêm antes e têm tamanho variável, então é preciso pular segmento
    por segmento em vez de ler um prefixo de tamanho arbitrário.
    """
    handle.seek(2)  # já sabemos que começa com SOI (FF D8)
    while True:
        byte = handle.read(1)
        if not byte:
            raise UnreadableImage("JPEG terminou antes do frame header.")
        if byte != b"\xff":
            continue  # byte de preenchimento entre segmentos

        marker = handle.read(1)
        while marker == b"\xff":  # sequência de FF de padding
            marker = handle.read(1)
        if not marker:
            raise UnreadableImage("JPEG terminou antes do frame header.")

        code = marker[0]
        if code in _JPEG_STANDALONE:
            continue
        if code == 0xD9 or code == 0xDA:
            # EOI ou início dos dados comprimidos: não há mais cabeçalho a ler.
            raise UnreadableImage("JPEG sem frame header antes dos dados.")

        length = handle.read(2)
        if len(length) < 2:
            raise UnreadableImage("Segmento JPEG truncado.")
        size = int.from_bytes(length, "big")
        if size < 2:
            raise UnreadableImage("Segmento JPEG com tamanho inválido.")

        if code not in _JPEG_SOF:
            handle.seek(size - 2, 1)
            continue

        frame = handle.read(5)  # precisão (1) + altura (2) + largura (2)
        if len(frame) < 5:
            raise UnreadableImage("Frame header JPEG truncado.")
        height = int.from_bytes(frame[1:3], "big")
        width = int.from_bytes(frame[3:5], "big")
        return width, height


def _png_size(header: bytes) -> tuple[int, int]:
    # IHDR é sempre o primeiro chunk: 8 (assinatura) + 8 (tamanho + tipo).
    if len(header) < 24 or header[12:16] != b"IHDR":
        raise UnreadableImage("PNG sem chunk IHDR no início.")
    return int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")


def _webp_size(header: bytes) -> tuple[int, int]:
    """WebP tem três formatos de chunk; cada um guarda o tamanho num lugar."""
    if len(header) < 30:
        raise UnreadableImage("Cabeçalho WebP truncado.")
    chunk = header[12:16]

    if chunk == b"VP8 ":  # lossy
        if header[23:26] != b"\x9d\x01\x2a":
            raise UnreadableImage("Quadro VP8 sem start code.")
        width = int.from_bytes(header[26:28], "little") & 0x3FFF
        height = int.from_bytes(header[28:30], "little") & 0x3FFF
        return width, height

    if chunk == b"VP8L":  # lossless
        if header[20] != 0x2F:
            raise UnreadableImage("Quadro VP8L sem assinatura.")
        bits = int.from_bytes(header[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1

    if chunk == b"VP8X":  # extended: o tamanho do canvas está no próprio chunk
        return (
            int.from_bytes(header[24:27], "little") + 1,
            int.from_bytes(header[27:30], "little") + 1,
        )

    raise UnreadableImage("Variante WebP não reconhecida.")


def read_dimensions(path: Path) -> tuple[int, int]:
    """Largura e altura em pixels, ou `UnreadableImage`.

    Abre somente para leitura — o original continua intocado.
    """
    try:
        with open(path, "rb") as handle:
            header = handle.read(32)
            if header.startswith(b"\x89PNG\r\n\x1a\n"):
                width, height = _png_size(header)
            elif header.startswith(b"RIFF") and header[8:12] == b"WEBP":
                width, height = _webp_size(header)
            elif header.startswith(b"\xff\xd8"):
                width, height = _jpeg_size(handle)
            else:
                raise UnreadableImage("Formato de imagem não reconhecido.")
    except OSError as error:
        raise UnreadableImage(str(error)) from error

    if width <= 0 or height <= 0:
        raise UnreadableImage("Dimensões inválidas no cabeçalho.")
    return width, height
