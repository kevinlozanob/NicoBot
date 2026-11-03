const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const axios = require("axios");

const { createApp, getForwardableMessage } = require("./app");

const PORT = process.env.PORT || 3000;
const PYTHON_BACKEND_URL =
  process.env.PYTHON_URL || "http://127.0.0.1:8000/webhook";

let sock;
let conectado = false;
let intentos = 0;

// Espera creciente entre reconexiones: 1s, 2s, 4s... hasta 60s.
function retrasoReconexion(intento) {
  return Math.min(1000 * 2 ** intento, 60000);
}

// WhatsApp rechaza (código 405) las versiones viejas de WhatsApp Web, y la
// que trae Baileys por defecto se desactualiza. Se consulta la vigente y, si
// falla, se usa la de Baileys.
async function obtenerVersionWA() {
  try {
    const { version, isLatest } = await fetchLatestWaWebVersion();
    if (isLatest) {
      console.log(`Usando WhatsApp Web ${version.join(".")}`);
      return version;
    }
  } catch (error) {
    console.error(`No se pudo consultar la versión de WhatsApp Web: ${error.message}`);
  }
  console.log("Usando la versión de WhatsApp Web que trae Baileys.");
  return undefined;
}

async function iniciarConexion() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_session");
  const version = await obtenerVersionWA();

  console.log("Iniciando socket...");

  sock = makeWASocket({
    ...(version && { version }),
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
      conectado = false;
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log(`Conexión cerrada. Razón: ${lastDisconnect?.error}, Reconectando: ${shouldReconnect}`);

      if (shouldReconnect) {
        const espera = retrasoReconexion(intentos++);
        console.log(`Reintentando en ${espera / 1000}s...`);
        setTimeout(iniciarConexion, espera);
      }
    } else if (connection === "open") {
      conectado = true;
      intentos = 0;
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

// Solo se expone el socket cuando WhatsApp está realmente conectado.
const app = createApp(() => (conectado ? sock : undefined));

app.listen(PORT, () => {
  console.log(`Servicio Motor corriendo en puerto ${PORT}`);
  iniciarConexion();
});
