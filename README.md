# NicoBot

NicoBot es un asistente de inteligencia artificial para WhatsApp, construido con una arquitectura de microservicios que separa la capa de comunicación del motor de razonamiento.

El proyecto integra un modelo de lenguaje para procesamiento de texto y un sistema de memoria persistente, con despliegue preparado mediante contenedores.

## Stack

- Node.js (Baileys + Express)
- Python (FastAPI)
- MongoDB
- Llama (vía Groq)
- Docker

## Arquitectura

```
WhatsApp <-> motor (Node, :3000) --POST /webhook--> cerebro (Python, :8000) <-> Groq
                     ^                                     |
                     +------- POST /send-message ----------+--> MongoDB (historial)
```

- `motor/`: mantiene la sesión de WhatsApp con Baileys, reenvía los mensajes entrantes al cerebro y expone `POST /send-message` y `GET /health`.
- `cerebro/`: recibe los mensajes en `POST /webhook`, arma el contexto con los últimos 10 mensajes guardados en MongoDB, consulta a Groq y devuelve la respuesta al motor. Expone también `GET /health`.

## Desarrollo local

```bash
cp .env.example .env   # y llena GROQ_API_KEY y MONGO_URI
docker compose up --build
```

La primera vez el motor imprime un QR en los logs (`docker compose logs -f motor`) que hay que escanear desde WhatsApp. La sesión queda guardada en `./sesion_data`.

## Tests

Cerebro (Python 3.11):

```bash
cd cerebro
pip install -r requirements-dev.txt
python -m pytest
```

Motor (Node 20.19 o superior):

```bash
cd motor
npm ci
npm test
```

Los tests no necesitan MongoDB, Groq ni WhatsApp reales: Mongo se simula con `mongomock`, y Groq y el socket de Baileys se reemplazan por dobles de prueba.

## CI/CD

- `.github/workflows/tests.yml`: corre los tests de ambos servicios en cada pull request.
- `.github/workflows/deploy.yml`: en cada push a `main` corre los tests y, si pasan, se conecta por SSH al VPS, actualiza el código, escribe el `.env` y levanta los contenedores con `docker compose`.

### Secretos de GitHub Actions

Se configuran en *Settings → Secrets and variables → Actions → New repository secret*.

| Secreto | Obligatorio | Descripción |
| --- | --- | --- |
| `HOST` | Sí | IP o dominio del VPS. |
| `SSH_USER` | Sí | Usuario con el que se conecta el deploy (por ejemplo `deploy`). Debe poder usar Docker. |
| `SSH_PRIVATE_KEY` | Sí | Llave privada completa (incluye las líneas `-----BEGIN ...` y `-----END ...`). |
| `SSH_PASSPHRASE` | No | Passphrase de la llave, si la tiene. |
| `SSH_PORT` | No | Puerto SSH. Por defecto `22`. |
| `SSH_FINGERPRINT` | No (recomendado) | Huella SHA256 de la llave de host del servidor, para evitar ataques man-in-the-middle. |
| `DEPLOY_PATH` | No | Carpeta del proyecto en el VPS. Por defecto `~/NicoBot` del usuario de deploy. |
| `GROQ_API_KEY` | Sí | API key de Groq. |
| `MONGO_URI` | Sí | Cadena de conexión de MongoDB Atlas. |

El secreto `PASSWORD` ya no se usa y se puede borrar.

### Preparar la llave SSH

1. Genera una llave dedicada para el deploy (en tu máquina, no en el servidor):

   ```bash
   ssh-keygen -t ed25519 -C "nicobot-deploy" -f ~/.ssh/nicobot_deploy -N ""
   ```

2. Crea en el VPS un usuario para el deploy con acceso a Docker y autoriza la llave pública:

   ```bash
   adduser --disabled-password --gecos "" deploy
   usermod -aG docker deploy
   mkdir -p /home/deploy/.ssh
   cat nicobot_deploy.pub >> /home/deploy/.ssh/authorized_keys
   chown -R deploy:deploy /home/deploy/.ssh
   chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
   ```

   Ten en cuenta que pertenecer al grupo `docker` equivale en la práctica a tener acceso de root, así que usa esta llave solo para el deploy.

3. Copia el contenido de `~/.ssh/nicobot_deploy` (la privada) en el secreto `SSH_PRIVATE_KEY` y el usuario en `SSH_USER`.

4. (Recomendado) Obtén la huella del servidor y guárdala en `SSH_FINGERPRINT`:

   ```bash
   ssh-keyscan -t ed25519 TU_HOST 2>/dev/null | ssh-keygen -lf - | awk '{print $2}'
   ```

5. Cuando el deploy funcione con la llave, desactiva el login por contraseña en `/etc/ssh/sshd_config` (`PasswordAuthentication no` y `PermitRootLogin prohibit-password` o `no`) y reinicia el servicio SSH.

### Migrar desde el deploy anterior

El deploy anterior usaba `root` y la carpeta `/root/NicoBot`. Si cambias a otro usuario, mueve la carpeta (incluye `sesion_data`, que guarda la sesión de WhatsApp, para no tener que escanear el QR otra vez) y ajusta el dueño:

```bash
docker compose -f /root/NicoBot/docker-compose.yml down
mv /root/NicoBot /home/deploy/NicoBot
chown -R deploy:deploy /home/deploy/NicoBot
```

Otra opción es dejar la carpeta donde está y apuntar `DEPLOY_PATH` a ella, siempre que el usuario de deploy tenga permisos de escritura.
