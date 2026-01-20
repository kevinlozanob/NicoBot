const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const express = require("express");
const bodyParser = require("body-parser");
const qrcode = require("qrcode-terminal");
const axios = require("axios");

const PORT = process.env.PORT || 3000;
const PYTHON_BACKEND_URL =
  process.env.PYTHON_URL || "http://127.0.0.1:8000/webhook";

const app = express();
app.use(bodyParser.json());

let sock;

async function iniciarConexion() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_session");

  console.log("Iniciando socket...");
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n------------------------------------------------");
      console.log("--> QR RECIBIDO. ESCANEE AHORA <--");
      console.log("------------------------------------------------\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      
      console.log(`Conexión cerrada. Razón: ${lastDisconnect.error}, Reconectando: ${shouldReconnect}`);
      
      if (shouldReconnect) {
        iniciarConexion();
      }
    } else if (connection === "open") {
      console.log("\n!!! CONEXIÓN EXITOSA !!! Bot listo para usar.\n");
    }
  });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.key.fromMe && m.type === "notify") {
        console.log("Mensaje recibido, enviando a Python...");
        await axios.post(PYTHON_BACKEND_URL, msg).catch((error) => {
          console.error(`Error enviando webhook a Python: ${error.message}`);
        });
      }
    } catch (error) {
      console.error("Error procesando mensaje entrante:", error);
    }
  });
}

app.post("/send-message", async (req, res) => {
  const { phone, message, jid } = req.body;

  if ((!phone && !jid) || !message) {
    return res
      .status(400)
      .json({ error: "Faltan parámetros: jid (o phone) y message son requeridos." });
  }

  try {
    const destination = jid ? jid : `${phone}@s.whatsapp.net`;

    if (sock) {
        await sock.sendMessage(destination, { text: message });
        console.log(`Mensaje enviado a ${destination}`);
        return res.status(200).json({ status: "sent", to: destination });
    } else {
        return res.status(500).json({ error: "Bot no conectado aún." });
    }
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    return res.status(500).json({ error: "Error interno al enviar mensaje." });
  }
});

app.listen(PORT, () => {
  console.log(`Servicio Motor corriendo en puerto ${PORT}`);
  iniciarConexion();
});