"""Senha só se troca pelo e-mail; e-mail novo só vale depois de confirmado.

Regra do produto: "quero trocar minha senha → digite seu e-mail → o link chega
no e-mail → lá se define a senha nova". Não existe outro caminho. O e-mail
sai pelo adapter (`EMAIL_PROVIDER=mock` aqui), e a caixa de saída do mock é
o que os testes leem — como a pessoa leria a caixa de entrada.

O que se prova:
* o link chega para quem é dono do e-mail, e só o hash do código fica no banco;
* e-mail inexistente recebe a mesma resposta e nenhum envio (não revela quem
  está cadastrado);
* o link vale uma vez, vence, e um pedido novo anula o anterior;
* trocar a senha derruba as sessões abertas;
* o link usa o endereço configurado, nunca o `Host` do pedido (envenenamento
  de link de redefinição);
* pedir link tem limite por IP.
"""

import re
import uuid
from datetime import timedelta

from httpx import ASGITransport, AsyncClient

from app.adapters import email as email_adapter
from app.core.clock import utcnow
from conftest import SENHA

NOVA = "nova-senha-bem-longa-42"
OUTRA = "outra-senha-bem-longa-77"


def cliente_de(ip: str, host: str = "testes") -> AsyncClient:
    from app.main import app

    return AsyncClient(transport=ASGITransport(app=app, client=(ip, 12345)), base_url=f"http://{host}")


def ip_novo() -> str:
    n = uuid.uuid4().int
    return f"10.{n % 250}.{(n >> 8) % 250}.{(n >> 16) % 250 + 1}"


async def conta(api) -> tuple[str, dict[str, str]]:
    email = f"senha-{uuid.uuid4().hex[:8]}@exemplo-teste.com"
    r = await api.post("/api/auth/register", json={"email": email, "password": SENHA, "name": "Conta"})
    assert r.status_code == 201, r.text
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


def cartas_para(email: str) -> list[email_adapter.EmailMessage]:
    return [m for m in email_adapter.CAIXA_DE_SAIDA if m.to == email]


def codigo_do_link(carta: email_adapter.EmailMessage, caminho: str) -> str:
    achado = re.search(rf"https://enbypro\.teste/{caminho}\?token=([A-Za-z0-9_-]+)", carta.text)
    assert achado, carta.text
    return achado.group(1)


async def pede_link(email: str, ip: str | None = None, host: str = "testes") -> int:
    async with cliente_de(ip or ip_novo(), host) as c:
        r = await c.post("/api/auth/password-reset/request", json={"email": email})
        return r.status_code


async def entra(api, email: str, senha: str) -> int:
    return (await api.post("/api/auth/login", json={"email": email, "password": senha})).status_code


# ---------------------------------------------------------------- senha


async def test_link_chega_no_email_e_o_banco_guarda_so_o_hash(api, banco):
    email, _ = await conta(api)
    assert await pede_link(email) == 202
    [carta] = cartas_para(email)
    codigo = codigo_do_link(carta, "redefinir-senha")
    registro = await banco.password_resets.find_one({"email": email})
    assert registro is not None
    assert codigo not in str(registro)


async def test_email_desconhecido_tem_a_mesma_resposta_e_nao_envia_nada(api):
    fantasma = f"ninguem-{uuid.uuid4().hex[:8]}@exemplo-teste.com"
    async with cliente_de(ip_novo()) as c:
        r = await c.post("/api/auth/password-reset/request", json={"email": fantasma})
    assert r.status_code == 202
    assert cartas_para(fantasma) == []
    email, _ = await conta(api)
    async with cliente_de(ip_novo()) as c:
        r2 = await c.post("/api/auth/password-reset/request", json={"email": email})
    assert r2.json() == r.json()


async def test_link_troca_a_senha_e_derruba_as_sessoes(api):
    email, sessao = await conta(api)
    await pede_link(email)
    codigo = codigo_do_link(cartas_para(email)[-1], "redefinir-senha")
    r = await api.post("/api/auth/password-reset/confirm", json={"token": codigo, "new_password": NOVA})
    assert r.status_code == 200, r.text
    assert await entra(api, email, NOVA) == 200
    assert await entra(api, email, SENHA) == 401
    assert (await api.get("/api/auth/me", headers=sessao)).status_code == 401


async def test_link_vale_uma_vez(api):
    email, _ = await conta(api)
    await pede_link(email)
    codigo = codigo_do_link(cartas_para(email)[-1], "redefinir-senha")
    assert (await api.post("/api/auth/password-reset/confirm", json={"token": codigo, "new_password": NOVA})).status_code == 200
    r = await api.post("/api/auth/password-reset/confirm", json={"token": codigo, "new_password": OUTRA})
    assert r.status_code == 400
    assert await entra(api, email, NOVA) == 200


async def test_link_vencido_nao_vale(api, banco):
    email, _ = await conta(api)
    await pede_link(email)
    codigo = codigo_do_link(cartas_para(email)[-1], "redefinir-senha")
    await banco.password_resets.update_many({"email": email}, {"$set": {"expires_at": utcnow() - timedelta(minutes=1)}})
    r = await api.post("/api/auth/password-reset/confirm", json={"token": codigo, "new_password": NOVA})
    assert r.status_code == 400
    assert await entra(api, email, SENHA) == 200


async def test_pedido_novo_anula_o_link_anterior(api):
    email, _ = await conta(api)
    await pede_link(email)
    primeiro = codigo_do_link(cartas_para(email)[-1], "redefinir-senha")
    await pede_link(email)
    segundo = codigo_do_link(cartas_para(email)[-1], "redefinir-senha")
    assert (await api.post("/api/auth/password-reset/confirm", json={"token": primeiro, "new_password": NOVA})).status_code == 400
    assert (await api.post("/api/auth/password-reset/confirm", json={"token": segundo, "new_password": NOVA})).status_code == 200


async def test_codigo_inventado_nao_vale(api):
    r = await api.post("/api/auth/password-reset/confirm", json={"token": "x" * 43, "new_password": NOVA})
    assert r.status_code == 400


async def test_senha_fraca_e_recusada_sem_gastar_o_link(api):
    email, _ = await conta(api)
    await pede_link(email)
    codigo = codigo_do_link(cartas_para(email)[-1], "redefinir-senha")
    for fraca in ("curta", "123456789012"):
        r = await api.post("/api/auth/password-reset/confirm", json={"token": codigo, "new_password": fraca})
        assert r.status_code == 422, fraca
    assert (await api.post("/api/auth/password-reset/confirm", json={"token": codigo, "new_password": NOVA})).status_code == 200


async def test_link_usa_o_endereco_configurado_e_ignora_o_host(api):
    email, _ = await conta(api)
    assert await pede_link(email, host="site-do-golpista.com") == 202
    carta = cartas_para(email)[-1]
    assert "site-do-golpista" not in carta.text
    assert "https://enbypro.teste/redefinir-senha?token=" in carta.text


async def test_pedir_link_tem_limite_por_ip(api):
    from app.core.config import get_settings

    email, _ = await conta(api)
    ip = ip_novo()
    limite = get_settings().auth_rate_limit_attempts
    respostas = [await pede_link(email, ip=ip) for _ in range(limite + 1)]
    assert respostas[:limite] == [202] * limite
    assert respostas[-1] == 429


# ---------------------------------------------------------------- minha conta


async def test_troca_o_nome(api):
    _, sessao = await conta(api)
    r = await api.patch("/api/auth/me", headers=sessao, json={"name": "Nome Novo"})
    assert r.status_code == 200, r.text
    assert (await api.get("/api/auth/me", headers=sessao)).json()["name"] == "Nome Novo"


async def test_nao_da_para_se_promover_nem_trocar_senha_por_aqui(api, banco):
    email, sessao = await conta(api)
    for corpo in ({"name": "X", "role": "owner"}, {"password": NOVA}, {"email": "outro@exemplo-teste.com"}, {"name": "  "}):
        assert (await api.patch("/api/auth/me", headers=sessao, json=corpo)).status_code == 422, corpo
    doc = await banco.users.find_one({"email": email})
    assert doc["role"] == "editor"
    assert await entra(api, email, SENHA) == 200


async def test_minha_conta_exige_login(api):
    assert (await api.patch("/api/auth/me", json={"name": "X"})).status_code == 401
    assert (await api.post("/api/auth/email-change/request", json={"new_email": "a@exemplo-teste.com"})).status_code == 401


# ---------------------------------------------------------------- e-mail


async def test_email_novo_so_vale_depois_de_confirmado(api):
    email, sessao = await conta(api)
    novo = f"novo-{uuid.uuid4().hex[:8]}@exemplo-teste.com"
    r = await api.post("/api/auth/email-change/request", headers=sessao, json={"new_email": novo})
    assert r.status_code == 202, r.text
    # Antes de confirmar, nada mudou.
    assert await entra(api, email, SENHA) == 200
    assert await entra(api, novo, SENHA) == 401
    assert cartas_para(email) == [] or all("confirmar-email" not in c.text for c in cartas_para(email))
    codigo = codigo_do_link(cartas_para(novo)[-1], "confirmar-email")
    r = await api.post("/api/auth/email-change/confirm", json={"token": codigo})
    assert r.status_code == 200, r.text
    assert await entra(api, novo, SENHA) == 200
    assert await entra(api, email, SENHA) == 401
    assert (await api.get("/api/auth/me", headers=sessao)).status_code == 401


async def test_email_de_outra_pessoa_e_recusado(api):
    email_a, _ = await conta(api)
    _, sessao_b = await conta(api)
    r = await api.post("/api/auth/email-change/request", headers=sessao_b, json={"new_email": email_a})
    assert r.status_code == 409


async def test_link_de_email_nao_serve_para_senha_e_vice_versa(api):
    email, sessao = await conta(api)
    novo = f"novo-{uuid.uuid4().hex[:8]}@exemplo-teste.com"
    await api.post("/api/auth/email-change/request", headers=sessao, json={"new_email": novo})
    codigo_email = codigo_do_link(cartas_para(novo)[-1], "confirmar-email")
    r = await api.post("/api/auth/password-reset/confirm", json={"token": codigo_email, "new_password": NOVA})
    assert r.status_code == 400
    await pede_link(email)
    codigo_senha = codigo_do_link(cartas_para(email)[-1], "redefinir-senha")
    assert (await api.post("/api/auth/email-change/confirm", json={"token": codigo_senha})).status_code == 400


async def test_sem_envio_configurado_avisa_em_vez_de_fingir(api, monkeypatch):
    """Com `EMAIL_PROVIDER=none` ninguém recebe "enviamos" sem e-mail sair."""
    from app.core.config import get_settings

    email, sessao = await conta(api)
    monkeypatch.setattr(get_settings(), "email_provider", "none")
    r = await api.post("/api/auth/password-reset/request", json={"email": email})
    assert r.status_code == 503
    fantasma = await api.post("/api/auth/password-reset/request", json={"email": "ninguem@exemplo-teste.com"})
    assert fantasma.status_code == 503 and fantasma.json() == r.json()
    r2 = await api.post("/api/auth/email-change/request", headers=sessao, json={"new_email": "x-" + email})
    assert r2.status_code == 503
    assert cartas_para(email) == []


async def test_padrao_do_codigo_e_envio_desligado():
    from app.core.config import Settings

    assert Settings.model_fields["email_provider"].default == "none"
