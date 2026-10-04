# SmartTrainner

SaaS para personal trainers (PT): banco de ejercicios, armado de rutinas, plantillas, turnos/asistencias y seguimiento del alumno. Cada PT es una "cuenta" y todo lo demás cuelga de ella (multi-cuenta). El alumno entra sin contraseña por un link con token (`/r/:token`).

Idioma: el código, los comentarios, los mensajes de error y la UI están en **español rioplatense** ("Volvé a entrar"). Mantener ese idioma y estilo. Zona horaria por defecto: `America/Argentina/Buenos_Aires`.

## Stack

- **Backend:** Node >= 18, Express 4, `@libsql/client` (Turso/SQLite), `jsonwebtoken`, `bcryptjs`. Todo el backend está en un solo archivo: `server.js`.
- **Frontend:** un único `public/index.html` con React en JSX dentro de `<script type="text/babel">`. El servidor lo **compila con Babel al arrancar** (`armarFrontend()` en `server.js`) y lo sirve como `/app.<huella>.js`. Hay que reiniciar el servidor para ver cambios en el frontend.
- `public/plantilla-carga.xlsx`: plantilla de Excel para importar ejercicios/rutinas. Si existe `public/vendor/xlsx.full.min.js` se usa en lugar de la copia de unpkg.

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
```

En PowerShell: `$env:TURSO_URL="file:test.db"; $env:JWT_SECRET="test123456"; $env:PORT=3210; npm start`. Antes de cada cambio en el backend, correr las tres.

## Arquitectura (server.js)

- Orden del archivo: cabeceras de seguridad y CSP -> compilación del frontend -> cliente de base -> tablas/migraciones (`TABLAS` + `ALTER TABLE ... ADD COLUMN` si faltan) -> mail -> auth -> capa `data.*` -> rutas `/api/...` -> `/api/alumno/:token/...` (público) -> `/api/salud` -> manejador de errores.
- **La fuente de verdad del esquema es el arreglo `TABLAS` de `server.js`**, que se aplica solo al arrancar. `schema.sql` es una versión vieja y **incompleta** (le faltan `turnos`, `grupos`, `plantillas*`, `recuperaciones`, `observaciones`, `indicaciones`, `asistencias`, `mensajes`). Si se cambia el esquema, tocar `server.js`.
- Las rutas se escriben como `app.<verbo>(ruta, auth, ruta(async (req, res) => {...}))`. El helper `ruta()` manda los errores async al manejador. `soloAdmin` restringe las de admin.
- **Aislamiento por cuenta:** casi toda tabla tiene `cuenta_id`, y toda consulta debe filtrar por `req.cuentaId`. No escribir consultas que lean o modifiquen por `id` sin ese filtro.
- Los ids se generan con `uid()` (hex), los links de alumno con `codigo()` (16 caracteres).
- Planes: vencen el mismo día del mes siguiente (`sumarMes`, con `dia_cobro` como ancla); se puede renovar `VENTANA_RENOVAR` (7) días antes.

## Seguridad (no romper)

- La sesión va en cookie `st_sesion` (httpOnly, secure, sameSite strict, path `/api`). Con cookie, toda escritura exige el header `X-ST: 1`. El header `Authorization: Bearer` queda para integraciones y pruebas.
- CSP estricta: solo scripts propios y de unpkg, sin `unsafe-eval` ni scripts inline. No agregar `eval`, `onclick=` inline ni scripts sueltos en el HTML.
- Contraseñas siempre con bcrypt; nunca texto plano ni en logs.
- Hay límite de intentos de login por IP, por eso `TRUST_PROXY` importa detrás de un proxy.

## Git

- Remoto: `https://github.com/gmtiz/SmartTrainner.git`, rama `main`. El historial son subidas por la web ("Add files via upload").
- `.gitignore` excluye `node_modules/`, `test.db*` y `.env*`: nunca commitear secretos ni bases locales.
- Confirmar con el usuario antes de cada `git push`.
