"""A página principal não pode ficar presa no cache do navegador.

Depois de cada publicação o usuário só via a versão nova com Ctrl+F5, porque
o index.html saía sem Cache-Control. Agora ele sai com `no-cache` — tanto na
raiz quanto nas rotas do painel, que caem no mesmo index.html.
"""

import pytest


@pytest.fixture
def com_build():
    from app.main import index_html

    if not index_html.is_file():
        pytest.skip("Build do frontend ausente (rode npm run build em frontend/).")


@pytest.mark.parametrize("caminho", ["/", "/projeto/qualquer/especificacao", "/estudio/levantamento"])
async def test_pagina_principal_sempre_confere_versao_nova(api, com_build, caminho):
    resposta = await api.get(caminho)
    assert resposta.status_code == 200
    assert "text/html" in resposta.headers["content-type"]
    assert resposta.headers.get("cache-control") == "no-cache"
