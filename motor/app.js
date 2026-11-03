const express = require("express");
const bodyParser = require("body-parser");

/**
 * Construye el JID de destino a partir de un jid explícito o un número.
 */
function resolveDestination({ jid, phone }) {
  if (jid) return jid;
  if (phone) return `${phone}@s.whatsapp.net`;
  return null;
}

/**
 * Decide si un evento `messages.upsert` debe reenviarse al cerebro.
 * Devuelve el mensaje a reenviar o null.
 */
function getForwardableMessage(upsert) {
  const msg = upsert?.messages?.[0];
  if (!msg || !msg.key) return null;
  if (msg.key.fromMe) return null;
  if (upsert.type !== "notify") return null;
  return msg;
}

/**
 * Crea la app HTTP del motor. `getSock` devuelve el socket de Baileys
 * actual (o undefined si aún no hay conexión).
 */
function createApp(getSock) {
  const app = express();
  app.use(bodyParser.json());

  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", connected: Boolean(getSock()) });
  });

  app.post("/send-message", async (req, res) => {
    const { phone, message, jid } = req.body || {};

    if ((!phone && !jid) || !message) {
      return res
        .status(400)
        .json({ error: "Faltan parámetros: jid (o phone) y message son requeridos." });
    }

    const destination = resolveDestination({ jid, phone });
    const sock = getSock();

    if (!sock) {
      return res.status(500).json({ error: "Bot no conectado aún." });
    }

    try {
      await sock.sendMessage(destination, { text: message });
      console.log(`Mensaje enviado a ${destination}`);
      return res.status(200).json({ status: "sent", to: destination });
    } catch (error) {
      console.error("Error enviando mensaje:", error);
      return res.status(500).json({ error: "Error interno al enviar mensaje." });
    }
  });

  return app;
}

module.exports = { createApp, resolveDestination, getForwardableMessage };
