"""Storage de mídia em disco — o lugar onde a regra de original imutável é cumprida.

Contrato do blueprint: **a foto original nunca é sobrescrita nem editada**. Aqui
isso é estrutural, não uma promessa de code review:

* o arquivo é escrito **uma vez**, num diretório novo por foto, com `O_EXCL` —
  se o caminho já existir, a escrita falha em vez de sobrescrever;
* depois de fechado, o arquivo recebe permissão somente-leitura (no Windows,
  o atributo read-only), então um `open(..., "wb")` distraído numa fase futura
  estoura `PermissionError` em vez de corromper o levantamento;
* qualquer derivado (calibração, máscara, imagem gerada) nasce em `derived/`,
  **ao lado** do original, nunca no lugar dele;
* `delete` remove só o registro — este módulo não expõe nenhuma função que
  apague ou reescreva o binário do original.

A raiz vem de env (`MEDIA_ROOT`). Nada de caminho de produção no código.
"""

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings

# Assinaturas de arquivo aceitas. Confiar no `Content-Type` do navegador deixaria
# entrar qualquer coisa renomeada para .jpg — o tipo real vem dos bytes.
_SIGNATURES: tuple[tuple[str, str, bytes], ...] = (
    ("image/jpeg", "jpg", b"\xff\xd8\xff"),
    ("image/png", "png", b"\x89PNG\r\n\x1a\n"),
    ("image/webp", "webp", b"RIFF"),  # + "WEBP" no offset 8, conferido abaixo
)

# Cabeçalho suficiente para reconhecer qualquer assinatura acima.
SNIFF_BYTES = 16


class UnsupportedMedia(Exception):
    """Bytes que não são de um formato de imagem aceito."""


class MediaTooLarge(Exception):
    """Arquivo acima do limite configurado."""


def sniff_image(header: bytes) -> tuple[str, str]:
    """Devolve `(content_type, extensão)` a partir dos primeiros bytes."""
    for content_type, extension, magic in _SIGNATURES:
        if not header.startswith(magic):
            continue
        if content_type == "image/webp" and header[8:12] != b"WEBP":
            continue
        return content_type, extension
    raise UnsupportedMedia


def accepted_content_types() -> tuple[str, ...]:
    """Tipos que o `sniff_image` reconhece — a UI usa isto no `accept` do input."""
    return tuple(content_type for content_type, _, _ in _SIGNATURES)


@dataclass(frozen=True, slots=True)
class StoredFile:
    """Resultado de uma gravação. `key` é o que vai para o banco."""

    key: str
    size_bytes: int
    checksum_sha256: str


def _root() -> Path:
    return get_settings().media_root_path


def build_original_key(*, tenant_id: str, photo_uid: str, extension: str) -> str:
    """Caminho relativo do original dentro do MEDIA_ROOT.

    Formato: `<tenant>/photos/<uid>/original.<ext>`. O tenant no topo mantém o
    isolamento visível também no disco; a pasta por foto é o que dá um lugar
    natural para os derivados das fases seguintes (`<uid>/derived/...`).
    """
    return f"{tenant_id}/photos/{photo_uid}/original.{extension}"


def build_brand_logo_key(*, tenant_id: str, logo_uid: str, extension: str) -> str:
    """Caminho do logo de uma marca (Fase 7).

    Cada upload recebe um uid novo, então trocar o logo escreve um arquivo novo
    e a marca passa a apontar para ele. O arquivo anterior fica onde está: a
    escrita única deste módulo vale para toda mídia, não só para foto de
    levantamento.
    """
    return f"{tenant_id}/brands/{logo_uid}/logo.{extension}"


def build_derived_key(*, original_key: str, derived_uid: str, extension: str) -> str:
    """Caminho de um derivado, dentro de `derived/` na pasta da própria foto.

    O original fica na raiz da pasta e o derivado num subdiretório: a separação
    é visível no disco, e nenhum caminho de derivado pode colidir com o nome do
    original por acidente. A Fase 9 grava aqui a imagem gerada.
    """
    return f"{original_key.rsplit('/', 1)[0]}/derived/{derived_uid}.{extension}"


def build_presentation_pdf_key(*, tenant_id: str, project_id: str, pdf_uid: str) -> str:
    """Caminho do PDF exportado (Fase 11).

    Fora da pasta das fotos de propósito: o PDF é do projeto, não de uma foto.
    Cada exportação recebe um uid novo, então reexportar grava arquivo novo e a
    apresentação passa a apontar para ele — a escrita única deste módulo vale
    para toda mídia, não só para imagem.
    """
    return f"{tenant_id}/projects/{project_id}/presentations/{pdf_uid}.pdf"


def resolve(key: str) -> Path:
    """Converte a chave do banco em caminho absoluto, preso ao MEDIA_ROOT.

    Uma chave adulterada (`../../etc/passwd`) sai daqui como erro, não como
    leitura de arquivo fora da raiz.
    """
    root = _root().resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Chave de mídia fora do MEDIA_ROOT.")
    return path


def _freeze(path: Path) -> None:
    """Tira a permissão de escrita — o original passa a ser somente-leitura."""
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
    except OSError:
        # Sistema de arquivos sem suporte a permissão não invalida o upload;
        # a imutabilidade continua garantida pelo O_EXCL e pela ausência de
        # qualquer caminho de escrita sobre o original no código.
        pass


# Chunk de leitura do upload. Grande o bastante para não picotar o I/O,
# pequeno o bastante para o limite de tamanho cortar cedo.
CHUNK_SIZE = 1024 * 256


async def single_chunk(content: bytes):
    """Adapta bytes já em memória ao `write_once`, que consome chunks.

    A imagem gerada nasce em memória (veio do adapter), então não há stream
    para repassar — mas a gravação continua sendo a mesma, com `O_EXCL` e
    somente-leitura no fim.
    """
    yield content


async def restream(reader, first: bytes):
    """Re-emite o cabeçalho já lido para o sniff e segue com o resto do stream.

    O sniff precisa dos primeiros bytes antes de decidir se aceita o arquivo,
    mas esses bytes fazem parte do conteúdo — então voltam para o começo do
    stream em vez de sumirem.
    """
    yield first
    while chunk := await reader.read(CHUNK_SIZE):
        yield chunk


async def write_once(*, key: str, chunks, max_bytes: int) -> StoredFile:
    """Grava um arquivo novo a partir de um iterável assíncrono de chunks.

    Escreve em streaming: um upload grande nunca é carregado inteiro em memória,
    e o limite de tamanho corta no meio do caminho em vez de depois de gastar o
    disco. Se estourar, o arquivo parcial é removido — ele nunca chegou a ser
    um arquivo válido, então apagá-lo não viola a regra de imutabilidade.

    Serve para qualquer mídia (original de foto, logo de marca): a chave já vem
    montada pelo chamador, e a garantia de não sobrescrever é do `O_EXCL`
    abaixo, não de quem chamou.
    """
    path = resolve(key)
    path.parent.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256()
    size = 0

    # O_EXCL: se o caminho já existir, isto levanta FileExistsError em vez de
    # truncar um original que já está no banco.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0))
    try:
        with os.fdopen(fd, "wb") as handle:
            async for chunk in chunks:
                if not chunk:
                    continue
                size += len(chunk)
                if size > max_bytes:
                    raise MediaTooLarge
                digest.update(chunk)
                handle.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        try:
            path.parent.rmdir()
        except OSError:
            pass
        raise

    _freeze(path)
    return StoredFile(key=key, size_bytes=size, checksum_sha256=digest.hexdigest())


def discard_unreferenced(key: str) -> None:
    """Remove um arquivo recém-gravado que **não chegou a virar registro**.

    Isto não contradiz a regra do original imutável — é a mesma limpeza que o
    `write_once` já faz quando a gravação falha no meio. A fronteira é precisa:
    só pode ser chamado antes de existir documento apontando para a chave, ou
    seja, para um upload que a validação recusou. Depois que uma foto existe no
    banco, nada neste módulo apaga ou reescreve o binário dela.
    """
    caminho = resolve(key)
    # O arquivo nasce somente-leitura; devolver a escrita é necessário para
    # removê-lo no Windows.
    try:
        os.chmod(caminho, stat.S_IWUSR | stat.S_IRUSR)
    except OSError:
        pass
    caminho.unlink(missing_ok=True)
    try:
        caminho.parent.rmdir()
    except OSError:
        pass


def checksum_on_disk(key: str) -> str | None:
    """SHA-256 do arquivo como ele está agora. Usado para provar que o original
    não mudou depois de qualquer operação (inclusive o DELETE do registro)."""
    path = resolve(key)
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
