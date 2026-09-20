"""Endurecimento da autenticação — as três brechas levantadas na revisão.

1. **Registro aberto.** `ALLOW_SELF_REGISTER` vinha `true` por padrão: qualquer
   um que alcançasse a URL criava conta e via os levantamentos do workspace.
2. **Sem limite de tentativas.** `POST /auth/login` aceitava quantas tentativas
   o atacante quisesse.
3. **`JWT_ALGORITHM` livre.** `none` desliga a verificação de assinatura e
   transforma qualquer token forjado em token válido.

Nenhuma delas era explorável de fora enquanto o app rodava só na máquina de
quem desenvolve. Todas seriam, no dia em que ele ganhasse uma URL.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from conftest import EMAIL_OWNER, SENHA


def cliente_de(ip: str) -> AsyncClient:
    """Cliente com IP próprio.

    O limite é por IP, então cada teste que o exercita precisa do seu — senão
    um teste esgotaria a cota do cliente compartilhado da suíte e derrubaria os
    outros por tabela.
    """
    from app.main import app

    return AsyncClient(
        transport=ASGITransport(app=app, client=(ip, 12345)),
        base_url="http://testes",
    )


# ------------------------------------------------- 1. registro fechado


async def test_registro_e_fechado_por_padrao():
    """O padrão do **código**.

    Conferido no campo da classe, e não instanciando `Settings`: uma instância
    leria o ambiente, onde a própria suíte liga o registro para poder criar o
    editor. O que interessa aqui é com o que uma instalação nova nasce.
    """
    from app.core.config import Settings

    assert Settings.model_fields["allow_self_register"].default is False


async def test_registro_fechado_recusa_com_403(api, monkeypatch, sufixo):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "allow_self_register", False)

    resposta = await api.post(
        "/api/auth/register",
        json={
            "email": f"intruso-{sufixo}@exemplo-teste.com",
            "password": SENHA,
            "name": "Intruso",
        },
    )
    assert resposta.status_code == 403, resposta.text
    assert "fechado" in resposta.json()["detail"].lower()


async def test_conta_nao_e_criada_quando_o_registro_esta_fechado(
    api, banco, monkeypatch, sufixo
):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "allow_self_register", False)
    email = f"intruso-{sufixo}@exemplo-teste.com"

    await api.post(
        "/api/auth/register", json={"email": email, "password": SENHA, "name": "Intruso"}
    )
    assert await banco["users"].find_one({"email": email}) is None


# ------------------------------------------- 2. limite de tentativas


async def test_login_bloqueia_apos_o_limite(api, sufixo):
    """Força bruta de um IP só para de funcionar."""
    from app.core.config import get_settings

    limite = get_settings().auth_rate_limit_attempts

    async with cliente_de(f"10.0.0.1") as atacante:
        for tentativa in range(limite):
            resposta = await atacante.post(
                "/api/auth/login",
                json={"email": EMAIL_OWNER, "password": "senha-errada"},
            )
            assert resposta.status_code == 401, (
                f"tentativa {tentativa + 1} devia ser 401: {resposta.status_code}"
            )

        bloqueada = await atacante.post(
            "/api/auth/login", json={"email": EMAIL_OWNER, "password": "senha-errada"}
        )
        assert bloqueada.status_code == 429, bloqueada.text
        assert "muitas tentativas" in bloqueada.json()["detail"].lower()
        assert bloqueada.headers.get("Retry-After"), "o cliente precisa saber quando voltar"


async def test_bloqueio_vale_ate_para_a_senha_certa(api):
    """O limite é conferido antes da senha: quem estourou não passa nem acertando.

    É o que impede o atacante de usar o endpoint como oráculo depois de
    esgotar a cota — e o que evita gastar bcrypt do servidor com ele.
    """
    from app.core.config import get_settings

    limite = get_settings().auth_rate_limit_attempts

    async with cliente_de("10.0.0.2") as atacante:
        for _ in range(limite):
            await atacante.post(
                "/api/auth/login", json={"email": EMAIL_OWNER, "password": "errada"}
            )

        com_senha_certa = await atacante.post(
            "/api/auth/login", json={"email": EMAIL_OWNER, "password": SENHA}
        )
        assert com_senha_certa.status_code == 429


async def test_acerto_limpa_o_historico_do_ip(api):
    """Errar a digitação três vezes e acertar não deixa o usuário na beirada."""
    from app.core.config import get_settings

    limite = get_settings().auth_rate_limit_attempts

    async with cliente_de("10.0.0.3") as usuario:
        for _ in range(limite - 1):
            await usuario.post(
                "/api/auth/login", json={"email": EMAIL_OWNER, "password": "errada"}
            )

        certo = await usuario.post(
            "/api/auth/login", json={"email": EMAIL_OWNER, "password": SENHA}
        )
        assert certo.status_code == 200

        # Cota renovada: dá para errar de novo sem bater no limite.
        de_novo = await usuario.post(
            "/api/auth/login", json={"email": EMAIL_OWNER, "password": "errada"}
        )
        assert de_novo.status_code == 401


async def test_limite_e_por_ip_e_nao_global(api):
    """Um IP bloqueado não pode derrubar o acesso de todo mundo."""
    from app.core.config import get_settings

    limite = get_settings().auth_rate_limit_attempts

    async with cliente_de("10.0.0.4") as atacante:
        for _ in range(limite + 1):
            await atacante.post(
                "/api/auth/login", json={"email": EMAIL_OWNER, "password": "errada"}
            )
        assert (
            await atacante.post(
                "/api/auth/login", json={"email": EMAIL_OWNER, "password": SENHA}
            )
        ).status_code == 429

    async with cliente_de("10.0.0.5") as inocente:
        resposta = await inocente.post(
            "/api/auth/login", json={"email": EMAIL_OWNER, "password": SENHA}
        )
        assert resposta.status_code == 200, "o IP de outra pessoa não foi afetado"


async def test_tentativa_registrada_no_banco(api, banco):
    async with cliente_de("10.0.0.6") as atacante:
        await atacante.post(
            "/api/auth/login", json={"email": EMAIL_OWNER, "password": "errada"}
        )

    doc = await banco["auth_attempts"].find_one({"ip": "10.0.0.6"})
    assert doc is not None
    assert doc["scope"] == "login"


async def test_cabecalho_de_proxy_e_ignorado_por_padrao(api, banco):
    """`X-Forwarded-For` é escolhido pelo cliente; confiar nele daria cota infinita."""
    from app.core.config import get_settings

    assert get_settings().trust_proxy_headers is False

    async with cliente_de("10.0.0.7") as atacante:
        await atacante.post(
            "/api/auth/login",
            headers={"X-Forwarded-For": "1.2.3.4"},
            json={"email": EMAIL_OWNER, "password": "errada"},
        )

    assert await banco["auth_attempts"].find_one({"ip": "1.2.3.4"}) is None, (
        "o IP forjado no cabeçalho não pode ter sido usado"
    )
    assert await banco["auth_attempts"].find_one({"ip": "10.0.0.7"}) is not None


@pytest.mark.parametrize("indice", ["ip_scope_at", "ttl_auth_attempts"])
async def test_indices_do_limite_existem(banco, indice):
    """Sem o TTL, a coleção de tentativas cresceria para sempre."""
    nomes = set(await banco["auth_attempts"].index_information())
    assert indice in nomes, sorted(nomes)


# --------------------------------------------- 3. algoritmo do JWT


@pytest.mark.parametrize("algoritmo", ["none", "None", "RS256", "ES256", "", "HS128"])
async def test_algoritmo_inseguro_impede_o_app_de_subir(algoritmo):
    """`none` desliga a assinatura; RS/ES usaria o segredo como chave pública."""
    from app.core.config import Settings

    with pytest.raises(ValueError, match="JWT_ALGORITHM"):
        Settings(_env_file=None, jwt_secret="x" * 40, jwt_algorithm=algoritmo)


@pytest.mark.parametrize(
    ("entrada", "esperado"), [("HS256", "HS256"), ("hs384", "HS384"), (" HS512 ", "HS512")]
)
async def test_algoritmo_hmac_e_aceito_e_normalizado(entrada, esperado):
    from app.core.config import Settings

    ajustes = Settings(_env_file=None, jwt_secret="x" * 40, jwt_algorithm=entrada)
    assert ajustes.jwt_algorithm == esperado


async def test_token_sem_assinatura_e_recusado(api, owner):
    """O ataque clássico do `alg: none`, conferido de ponta a ponta."""
    import base64
    import json

    def b64(dados: dict) -> str:
        bruto = json.dumps(dados, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(bruto).rstrip(b"=").decode()

    forjado = (
        b64({"alg": "none", "typ": "JWT"})
        + "."
        + b64({"sub": owner.id, "tid": owner.tenant_id, "role": "owner"})
        + "."
    )

    resposta = await api.get("/api/auth/me", headers={"Authorization": f"Bearer {forjado}"})
    assert resposta.status_code == 401, resposta.text
