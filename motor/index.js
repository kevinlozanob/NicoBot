const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const axios = require("axios");

const { createApp, getForwardableMessage } = require("./app");

const PORT = process.env.PORT || 3000;
const PYTHON_BACKEND_URL =
  process.env.PYTHON_URL || "http://127.0.0.1:8000/webhook";

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
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log(`Conexión cerrada. Razón: ${lastDisconnect?.error}, Reconectando: ${shouldReconnect}`);

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
      const msg = getForwardableMessage(m);
      if (msg) {
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

const app = createApp(() => sock);

app.listen(PORT, () => {
  console.log(`Servicio Motor corriendo en puerto ${PORT}`);
  iniciarConexion();
});
