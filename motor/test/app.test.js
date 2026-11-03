const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp, resolveDestination, getForwardableMessage } = require("../app");

async function withServer(getSock, fn) {
  const server = createApp(getSock).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(baseUrl, body) {
  return fetch(`${baseUrl}/send-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("resolveDestination prioriza jid sobre phone", () => {
  assert.equal(resolveDestination({ jid: "123@g.us", phone: "57300" }), "123@g.us");
  assert.equal(resolveDestination({ phone: "57300" }), "57300@s.whatsapp.net");
  assert.equal(resolveDestination({}), null);
});

test("getForwardableMessage filtra mensajes propios y no-notify", () => {
  const msg = { key: { remoteJid: "57300@s.whatsapp.net", fromMe: false } };
  assert.equal(getForwardableMessage({ type: "notify", messages: [msg] }), msg);
  assert.equal(
    getForwardableMessage({ type: "notify", messages: [{ key: { fromMe: true } }] }),
    null
  );
  assert.equal(getForwardableMessage({ type: "append", messages: [msg] }), null);
  assert.equal(getForwardableMessage({ type: "notify", messages: [] }), null);
  assert.equal(getForwardableMessage(undefined), null);
});

test("GET /health responde ok", async () => {
  await withServer(() => undefined, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", connected: false });
  });
});

test("POST /send-message sin parámetros devuelve 400", async () => {
  await withServer(() => undefined, async (baseUrl) => {
    const res = await post(baseUrl, { message: "hola" });
    assert.equal(res.status, 400);
  });
});

test("POST /send-message sin socket devuelve 500", async () => {
  await withServer(() => undefined, async (baseUrl) => {
    const res = await post(baseUrl, { phone: "57300", message: "hola" });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Bot no conectado aún." });
  });
});

test("POST /send-message envía el texto por el socket", async () => {
  const calls = [];
  const fakeSock = {
    sendMessage: async (to, content) => {
      calls.push([to, content]);
    },
  };

  await withServer(() => fakeSock, async (baseUrl) => {
    const res = await post(baseUrl, { phone: "57300", message: "hola" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "sent", to: "57300@s.whatsapp.net" });
  });

  assert.deepEqual(calls, [["57300@s.whatsapp.net", { text: "hola" }]]);
});

test("POST /send-message devuelve 500 si el socket falla", async () => {
  const fakeSock = {
    sendMessage: async () => {
      throw new Error("boom");
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await withServer(() => fakeSock, async (baseUrl) => {
      const res = await post(baseUrl, { jid: "123@g.us", message: "hola" });
      assert.equal(res.status, 500);
    });
  } finally {
    console.error = originalError;
  }
});
