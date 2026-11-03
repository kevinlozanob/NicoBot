from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main


class FakeGroq:
    def __init__(self, respuesta="Quiubo parce", error=None):
        self.calls = []
        self._respuesta = respuesta
        self._error = error
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        message = SimpleNamespace(content=self._respuesta)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


@pytest.fixture
def enviados(monkeypatch):
    enviados = []
    monkeypatch.setattr(main, "enviar_respuesta_whatsapp", lambda jid, texto: enviados.append((jid, texto)))
    return enviados


@pytest.fixture
def client():
    # Sin context manager: no corre el lifespan, así que no hace ping a Mongo.
    return TestClient(main.app)


def mensaje(texto, jid="573001234567@s.whatsapp.net", extended=False):
    contenido = {"extendedTextMessage": {"text": texto}} if extended else {"conversation": texto}
    return {"key": {"remoteJid": jid, "fromMe": False}, "message": contenido}


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


@pytest.mark.parametrize(
    "data, esperado",
    [
        (mensaje("hola"), ("573001234567@s.whatsapp.net", "hola")),
        (mensaje("hola", extended=True), ("573001234567@s.whatsapp.net", "hola")),
        (mensaje("hola", jid="status@broadcast"), ("status@broadcast", None)),
        ({"key": {"remoteJid": "x"}, "message": None}, ("x", None)),
        ({}, ("", None)),
    ],
)
def test_extraer_texto(data, esperado):
    assert main.extraer_texto(data) == esperado


def test_webhook_ignora_estados(client, enviados):
    res = client.post("/webhook", json=mensaje("hola", jid="status@broadcast"))
    assert res.json() == {"status": "ignored"}
    assert enviados == []


def test_webhook_ignora_mensajes_sin_texto(client, enviados):
    res = client.post("/webhook", json={"key": {"remoteJid": "x"}, "message": {"imageMessage": {}}})
    assert res.json() == {"status": "ignored"}
    assert enviados == []


def test_webhook_sin_api_key_responde_aviso(client, enviados, monkeypatch, mongo_collection):
    monkeypatch.setattr(main, "groq_client", None)

    res = client.post("/webhook", json=mensaje("hola"))

    assert res.json() == {"status": "processed"}
    assert enviados == [("573001234567@s.whatsapp.net", "El cerebro está desconectado (Falta API Key).")]


def test_webhook_procesa_con_memoria(client, enviados, monkeypatch, mongo_collection):
    fake = FakeGroq(respuesta="Quiubo parce")
    monkeypatch.setattr(main, "groq_client", fake)
    jid = "573001234567@s.whatsapp.net"
    main.database.guardar_mensaje(jid, "user", "mensaje viejo")
    main.database.guardar_mensaje(jid, "assistant", "respuesta vieja")

    res = client.post("/webhook", json=mensaje("necesito una app"))

    assert res.json() == {"status": "processed"}
    assert enviados == [(jid, "Quiubo parce")]

    mensajes = fake.calls[0]["messages"]
    assert mensajes[0]["role"] == "system"
    assert mensajes[1:] == [
        {"role": "user", "content": "mensaje viejo"},
        {"role": "assistant", "content": "respuesta vieja"},
        {"role": "user", "content": "necesito una app"},
    ]
    # La conversación nueva queda guardada en memoria.
    assert main.database.obtener_historial(jid)[-2:] == [
        {"role": "user", "content": "necesito una app"},
        {"role": "assistant", "content": "Quiubo parce"},
    ]


def test_webhook_error_de_groq_no_guarda_y_responde_fallback(client, enviados, monkeypatch, mongo_collection):
    monkeypatch.setattr(main, "groq_client", FakeGroq(error=RuntimeError("caído")))

    res = client.post("/webhook", json=mensaje("hola"))

    assert res.json() == {"status": "processed"}
    assert enviados[0][1].startswith("Uy socio")
    assert main.database.obtener_historial("573001234567@s.whatsapp.net") == []


def test_enviar_respuesta_whatsapp_hace_post_a_node(monkeypatch):
    llamadas = []

    def fake_post(url, json, timeout):
        llamadas.append((url, json, timeout))

    monkeypatch.setattr(main.requests, "post", fake_post)
    main.enviar_respuesta_whatsapp("jid-1", "hola")

    assert llamadas == [(main.NODE_SERVICE_URL, {"jid": "jid-1", "message": "hola"}, 10)]
