import base64
import io
import json

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr

from app.adapters import openrouter
from app.adapters.image_gen import GenerationRequest, ImageGenError
from app.core.config import get_settings
from helpers import imagem_png


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(get_settings(), "openrouter_api_key", SecretStr("test-only-not-a-key"))


def mocked(monkeypatch, handler):
    client = httpx.AsyncClient
    monkeypatch.setattr(openrouter.httpx, "AsyncClient", lambda **kwargs: client(
        **kwargs, transport=httpx.MockTransport(handler)))


def request():
    return GenerationRequest(original_bytes=imagem_png((100, 100, 100)),
        mask_png=imagem_png((255, 255, 255)), prompt="Teste controlado", size=(120, 60))


async def test_openrouter_reference_and_image_decode(monkeypatch, configured):
    output = imagem_png((10, 20, 30))
    def serve(req):
        assert str(req.url) == "https://openrouter.ai/api/v1/images"
        payload = json.loads(req.content)
        assert len(payload["input_references"]) == 2
        assert payload["n"] == 1
        assert payload["model"] == get_settings().openrouter_image_model
        reference = payload["input_references"][0]["image_url"]["url"]
        with Image.open(io.BytesIO(base64.b64decode(reference.split(",")[1]))) as image:
            assert not image.getexif()
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(output).decode(), "media_type": "image/png"}]})
    mocked(monkeypatch, serve)
    result = await openrouter.OpenRouterImageGenAdapter().generate(request())
    assert result.image_bytes == output
    assert result.provider == "openrouter"


@pytest.mark.parametrize("status", [401, 402, 429, 500, 302])
async def test_provider_errors_do_not_leak_secret(monkeypatch, configured, status):
    calls = []
    def serve(req):
        calls.append(req)
        return httpx.Response(status, text="secret-provider-payload", headers={"Location": "http://127.0.0.1/private"})
    mocked(monkeypatch, serve)
    with pytest.raises(ImageGenError) as error:
        await openrouter.OpenRouterImageGenAdapter().generate(request())
    assert "secret-provider-payload" not in str(error.value)
    assert len(calls) == 1


@pytest.mark.parametrize("item", [
    {"url": "http://169.254.169.254/metadata"},
    {"b64_json": "invalid!"},
    {"b64_json": "PHN2Zz4=", "media_type": "image/svg+xml"},
])
async def test_rejects_urls_invalid_data_and_svg(monkeypatch, configured, item):
    mocked(monkeypatch, lambda req: httpx.Response(200, json={"data": [item]}))
    with pytest.raises(ImageGenError):
        await openrouter.OpenRouterImageGenAdapter().generate(request())


async def test_missing_key_fails_without_network(monkeypatch):
    monkeypatch.setattr(get_settings(), "openrouter_api_key", SecretStr(""))
    with pytest.raises(ImageGenError, match="configurada"):
        await openrouter.OpenRouterImageGenAdapter().generate(request())
