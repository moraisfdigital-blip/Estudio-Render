"""OpenRouter Image API. No URLs returned by the provider are fetched.

The caller enforces Architecture Lock after generation. Only a metadata-free
copy and its mask leave the server. Requests are never retried automatically:
a timed-out generation may already have incurred a charge.
"""

import base64
import binascii
import io
import json

import httpx
from PIL import Image, UnidentifiedImageError

from app.adapters.image_gen import GenerationRequest, GenerationResult, ImageGenAdapter, ImageGenError
from app.core.config import get_settings


class OpenRouterImageGenAdapter(ImageGenAdapter):
    name = "openrouter"

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        settings = get_settings()
        key = settings.openrouter_api_key.get_secret_value()
        if not key:
            raise ImageGenError("A geração por IA ainda não foi configurada pelo administrador.")
        # Re-encode so GPS/EXIF, embedded profiles and other metadata stay local.
        clean = io.BytesIO()
        with Image.open(io.BytesIO(request.original_bytes)) as source:
            source.convert("RGB").save(clean, format="PNG")

        def reference(data: bytes) -> dict:
            return {"type": "image_url", "image_url": {
                "url": "data:image/png;base64," + base64.b64encode(data).decode("ascii")}}

        payload = {
            "model": settings.openrouter_image_model,
            "prompt": request.prompt + (
                "\nA primeira referência é a fotografia original; a segunda é a máscara. "
                "Altere somente a área branca da máscara. Preserve enquadramento, "
                "perspectiva e dimensões da primeira imagem. Não desenhe a máscara "
                "no resultado. Não invente medidas. Gere uma proposta fotorrealista."
            ),
            "n": 1,
            "output_format": "png",
            "input_references": [reference(clean.getvalue()), reference(request.mask_png)],
        }
        limit = settings.openrouter_max_response_mb * 1024 * 1024
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(settings.openrouter_timeout_seconds, connect=15),
                follow_redirects=False,
            ) as client:
                async with client.stream(
                    "POST", "https://openrouter.ai/api/v1/images",
                    headers={"Authorization": f"Bearer {key}"}, json=payload,
                ) as response:
                    if response.status_code != 200:
                        messages = {
                            401: "A credencial de IA precisa ser revisada pelo administrador.",
                            402: "O serviço de IA está sem créditos disponíveis.",
                            429: "O serviço de IA está ocupado. Aguarde antes de tentar novamente.",
                        }
                        raise ImageGenError(messages.get(response.status_code,
                            "O serviço de IA não conseguiu gerar a proposta. Tente novamente mais tarde."))
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > limit:
                            raise ImageGenError("A imagem recebida excede o limite permitido.")
            result = json.loads(body)
            item = result["data"][0]
            if item.get("media_type", "image/png") not in {"image/png", "image/jpeg", "image/webp"}:
                raise ImageGenError("O serviço de IA retornou um formato de imagem não permitido.")
            data = base64.b64decode(item["b64_json"], validate=True)
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > settings.max_image_pixels:
                    raise ImageGenError("A resolução recebida excede o limite permitido.")
                image.verify()
            return GenerationResult(image_bytes=data, provider=self.name, model=settings.openrouter_image_model)
        except httpx.TimeoutException:
            raise ImageGenError("A geração demorou além do limite. Confira o resultado antes de tentar de novo.") from None
        except httpx.HTTPError:
            raise ImageGenError("Não foi possível conectar ao serviço de IA.") from None
        except (ValueError, KeyError, IndexError, TypeError, binascii.Error,
                UnidentifiedImageError, OSError, Image.DecompressionBombError):
            raise ImageGenError("O serviço de IA retornou uma imagem inválida.") from None
