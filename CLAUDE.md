# SmartTrainner

SaaS para personal trainers (PT): banco de ejercicios, armado de rutinas, plantillas, turnos/asistencias y seguimiento del alumno. Cada PT es una "cuenta" y todo lo demás cuelga de ella (multi-cuenta). El alumno entra sin contraseña por un link con token (`/r/:token`).

Idioma: el código, los comentarios, los mensajes de error y la UI están en **español rioplatense** ("Volvé a entrar"). Mantener ese idioma y estilo. Zona horaria por defecto: `America/Argentina/Buenos_Aires`.

## Stack

- **Backend:** Node >= 18, Express 4, `@libsql/client` (Turso/SQLite), `jsonwebtoken`, `bcryptjs`. Todo el backend está en un solo archivo: `server.js`.
- **Frontend:** un único `public/index.html` con React en JSX dentro de `<script type="text/babel">`. El servidor lo **compila con Babel al arrancar** (`armarFrontend()` en `server.js`) y lo sirve como `/app.<huella>.js`. Hay que reiniciar el servidor para ver cambios en el frontend.
- `public/plantilla-carga.xlsx`: plantilla de Excel para importar ejercicios/rutinas. Si existe `public/vendor/xlsx.full.min.js` se usa en lugar de la copia de unpkg.
- **App instalable (PWA):** `/manifest.webmanifest` (entrenador) y `/r/:token/manifest.webmanifest` (alumno, arranca en su rutina y lleva la marca del profe). `/r/:token` reemplaza el link del manifiesto en el HTML: no sacar `href="/manifest.webmanifest"` de `index.html` (el arranque lo exige). `public/sw.js` es el service worker: solo guarda páginas, código, íconos, React/fuentes y `GET /api/alumno/...`; **nunca datos del entrenador**. Si se cambia cómo guarda, subir `VERSION`. Se sirve con su propia CSP (necesita `connect-src` a unpkg y Google Fonts). Íconos en `public/icons/`.

## Comandos

```bash
npm install
npm start                      # node server.js
```

Variables de entorno: `TURSO_URL`, `TURSO_TOKEN`, `JWT_SECRET` (obligatoria, >= 32 caracteres), `ADMIN_EMAIL`, `PORT` (3000 por defecto), `TRUST_PROXY` (1), `ZONA_HORARIA`, `URL_APP`, `MAIL_DESDE`, `RESEND_API_KEY` / `BREVO_API_KEY` (envío de mails de recuperación).

### Pruebas

No hay framework: son scripts sueltos que pegan contra un servidor levantado. Primero el servidor, en otra terminal las pruebas:

```bash
# terminal 1
TURSO_URL="file:test.db" JWT_SECRET="test123456" PORT=3210 npm start
# terminal 2
node pruebas.js            # API general
node pruebas-plan.js       # plan mensual, renovación, login (toca la base directo)
node pruebas-seguridad.js  # importación, cookie de sesión, admin, marca propia
node pruebas-negocio.js    # cobros, pantalla Hoy, reportes, app instalable (toca la base directo)
node pruebas-entreno.js    # prescripción (descanso, RPE, tempo, superseries) y modo entrenando
```

En PowerShell: `$env:TURSO_URL="file:test.db"; $env:JWT_SECRET="test123456"; $env:PORT=3210; npm start`. Antes de cada cambio en el backend, correr las cinco, con la base de prueba borrada antes (`test.db*`): `pruebas.js` cuenta cuentas y alumnos y falla sobre una base usada. `pruebas-seguridad.js` firma sesiones con `JWT_SECRET`: tiene que ser el mismo que usa el servidor.

**Node:** `@babel/core` 8 es solo ESM y `server.js` lo carga con `require()`. Eso necesita Node >= 20.19 o >= 22.12; con Node 20.17 el servidor no arranca (`ERR_REQUIRE_ESM`). En esta máquina hay Node 22.13 instalado con nvm.

## Arquitectura (server.js)

- Orden del archivo: cabeceras de seguridad y CSP -> compilación del frontend -> cliente de base -> tablas/migraciones (`TABLAS` + `ALTER TABLE ... ADD COLUMN` si faltan) -> mail -> auth -> capa `data.*` -> rutas `/api/...` -> `/api/alumno/:token/...` (público) -> `/api/salud` -> manejador de errores.
- **La fuente de verdad del esquema es el arreglo `TABLAS` de `server.js`**, que se aplica solo al arrancar. `schema.sql` es una versión vieja y **incompleta** (le faltan `turnos`, `grupos`, `plantillas*`, `recuperaciones`, `observaciones`, `indicaciones`, `asistencias`, `mensajes`). Si se cambia el esquema, tocar `server.js`.
- Las rutas se escriben como `app.<verbo>(ruta, auth, ruta(async (req, res) => {...}))`. El helper `ruta()` manda los errores async al manejador. `soloAdmin` restringe las de admin.
- **Aislamiento por cuenta:** casi toda tabla tiene `cuenta_id`, y toda consulta debe filtrar por `req.cuentaId`. No escribir consultas que lean o modifiquen por `id` sin ese filtro.
- Los ids se generan con `uid()` (hex), los links de alumno con `codigo()` (16 caracteres).
- Planes: vencen el mismo día del mes siguiente (`sumarMes`, con `dia_cobro` como ancla); se puede renovar `VENTANA_RENOVAR` (7) días antes.
- Cobros: tabla `pagos`. `POST /api/clientes/:id/pagos` anota el pago y renueva el plan (`data.pagarPlan`: como `renovarPlan`, pero si paga por adelantado corre el vencimiento un mes sin cortar el ciclo). Con `renovar: false` solo anota la plata. Borrar un pago no toca el vencimiento. `clientes` guarda `precio` (cuota), `nacimiento`, `creado` (alta) y `baja` (la pone `borrarCliente`), que usan los reportes.
- `GET /api/hoy` arma la pantalla de inicio (`data.tablero`). `GET /api/negocio?mes=AAAA-MM` devuelve la caja del mes para todos los planes, y `reportes` solo con `limites(plan).reportes` (plan completo).
- Prescripción: `rutina_items` y `plantilla_items` tienen `descanso` (segundos, 0 a 900), `intensidad` (texto libre: "RPE 8", "RIR 2", "70%"), `tempo` y `bloque` (superserie, letra A a F; la misma letra va seguida). Se validan con `revisarPrescripcion()`; al editar, lo que no viene en el pedido se conserva. Toda copia de ítems (duplicar, renovar, plantilla ↔ rutina) tiene que llevar los cuatro con `extrasDe()`. La importación desde Excel todavía no los trae.
- Modo entrenando: el alumno cierra el día con `POST /api/alumno/:token/sesion` (tabla `sesiones`, una por día de rutina y fecha; esfuerzo 1 a 10, comentario y minutos). El PT lo ve en la ficha (`sesiones`) y en Hoy. El temporizador, el sonido y la pantalla prendida (Wake Lock) viven solo en el frontend (`ModoEntreno`), y el avance se guarda en `localStorage` por 4 horas para retomar.
- Recordatorios: el frontend arma links `wa.me` con el texto escrito (`MENSAJE`, `numeroWhatsApp` normaliza teléfonos argentinos). No hay envío automático ni API de WhatsApp.

## Seguridad (no romper)

- La sesión va en cookie `st_sesion` (httpOnly, secure, sameSite strict, path `/api`). Con cookie, toda escritura exige el header `X-ST: 1`. El header `Authorization: Bearer` queda para integraciones y pruebas.
- CSP estricta: solo scripts propios y de unpkg, sin `unsafe-eval` ni scripts inline. No agregar `eval`, `onclick=` inline ni scripts sueltos en el HTML.
- Contraseñas siempre con bcrypt; nunca texto plano ni en logs.
- Hay límite de intentos de login por IP, por eso `TRUST_PROXY` importa detrás de un proxy.

## Git

- Remoto: `https://github.com/gmtiz/SmartTrainner.git`, rama `main`. El historial son subidas por la web ("Add files via upload").
- `.gitignore` excluye `node_modules/`, `test.db*` y `.env*`: nunca commitear secretos ni bases locales.
- Confirmar con el usuario antes de cada `git push`.
