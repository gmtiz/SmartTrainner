// Pruebas: tope al importar, importación todo-o-nada, sesión por cookie, admin y marca propia.
// Uso (servidor levantado como indica pruebas.js):
//   TURSO_URL="file:test.db" JWT_SECRET="test123456" node pruebas-seguridad.js

const jwt = require('jsonwebtoken');
const { createClient } = require('@libsql/client');

const B = process.env.BASE || 'http://localhost:3210/api';
const SECRET = process.env.JWT_SECRET || 'test123456';
const db = createClient({ url: process.env.TURSO_URL || 'file:test.db' });
let ok = 0, fail = 0;
const check = (n, c, x = '') => {
  if (c) { ok++; console.log('  OK  ' + n); }
  else { fail++; console.log('FALLA ' + n + (x ? ' -> ' + x : '')); }
};
async function call(p, { method = 'GET', body, token, cookie, xst, ip, headers = {} } = {}) {
  const h = Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': ip || '10.1.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) }, headers);
  if (token) h.Authorization = 'Bearer ' + token;
  if (cookie) h.Cookie = 'st_sesion=' + cookie;
  if (xst) h['X-ST'] = '1';
  const r = await fetch(B + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const texto = await r.text();
  let data = {}; try { data = JSON.parse(texto); } catch { data = { _texto: texto }; }
  return { status: r.status, headers: r.headers, data, bytes: texto.length };
}
const cookieDe = r => { const m = (r.headers.get('set-cookie') || '').match(/st_sesion=([^;]*)/); return m ? m[1] : null; };
const s = Date.now();
async function nuevaCuenta(prefijo, plan) {
  const r = await call('/registro', { method: 'POST', body: { email: `${prefijo}${s}@x.com`, password: 'clave12345', nombre: prefijo } });
  if (plan) await db.execute({ sql: 'UPDATE cuentas SET plan = ? WHERE email = ?', args: [plan, `${prefijo}${s}@x.com`] });
  return r;
}
const contar = async (tabla, cuentaId, extra = '') =>
  Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${tabla} WHERE cuenta_id = ? ${extra}`, args: [cuentaId] })).rows[0].n);
const idDe = async mail => (await db.execute({ sql: 'SELECT id FROM cuentas WHERE email = ?', args: [mail] })).rows[0].id;
const ejNuevos = n => Array.from({ length: n }, (_, i) => ({ ejercicio: `Ejercicio prueba ${i + 1}`, grupo: 'Piernas' }));

(async () => {
console.log('\n== TOPE DE EJERCICIOS AL IMPORTAR ==');
const imp = await nuevaCuenta('imp', 'activo');
const T = imp.data.token, cid = await idDe(`imp${s}@x.com`);
// dejamos la cuenta a 10 lugares del tope de 600
await db.execute({ sql: 'UPDATE cuentas SET plan = ? WHERE id = ?', args: ['activo', cid] });
for (let i = 0; i < 590; i++)
  await db.execute({ sql: 'INSERT INTO ejercicios (id, cuenta_id, nombre, grupo) VALUES (?,?,?,?)', args: ['r' + s + i, cid, 'Relleno ' + i, 'Core'] });
check('la cuenta arranca con 590 ejercicios propios', await contar('ejercicios', cid, 'AND (ejemplo IS NULL OR ejemplo = 0)') === 590);

const rev = await call('/importar/revisar', { method: 'POST', token: T, body: { ejercicios: ejNuevos(11) } });
check('la vista previa avisa que 11 nuevos no entran en 10 lugares', rev.data.entra === false && rev.data.nuevos.ejercicios === 11 && rev.data.libres.ejercicios === 10, JSON.stringify(rev.data));
check('el mensaje dice cuántos trae y cuántos quedan', /11 ejercicios nuevos y te quedan 10 lugares/.test(rev.data.mensaje || ''), rev.data.mensaje);
const r11 = await call('/importar', { method: 'POST', token: T, body: { ejercicios: ejNuevos(11) } });
check('importar 11 se rechaza entero', r11.status === 402 && /No se cargó nada/.test(r11.data.error), JSON.stringify(r11.data));
check('y no se cargó ninguno', await contar('ejercicios', cid, 'AND (ejemplo IS NULL OR ejemplo = 0)') === 590);

const r10 = await call('/importar', { method: 'POST', token: T, body: { ejercicios: ejNuevos(10) } });
check('importar exactamente los 10 que entran funciona', r10.status === 200 && r10.data.ejercicios === 10, JSON.stringify(r10.data));
check('queda en el tope justo (600)', await contar('ejercicios', cid, 'AND (ejemplo IS NULL OR ejemplo = 0)') === 600);

const repetidos = await call('/importar/revisar', { method: 'POST', token: T,
  body: { ejercicios: [{ ejercicio: 'Relleno 1' }, { ejercicio: '  relleno 1 ' }, { ejercicio: 'Sentadilla con barra' }] } });
check('lo que ya existe o se repite en el archivo no ocupa lugar', repetidos.data.nuevos.ejercicios === 0 && repetidos.data.entra, JSON.stringify(repetidos.data));
const dup = await call('/importar/revisar', { method: 'POST', token: T, body: { ejercicios: [{ ejercicio: 'Nuevo X' }, { ejercicio: 'NUEVO X' }] } });
check('dos filas iguales en el archivo cuentan como uno', dup.data.nuevos.ejercicios === 1);

// ejercicios que solo aparecen en la hoja Rutinas
await db.execute({ sql: "DELETE FROM ejercicios WHERE cuenta_id = ? AND nombre LIKE 'Ejercicio prueba%'", args: [cid] });
const alumnoR = await call('/clientes', { method: 'POST', token: T, body: { nombre: 'Rita Rutina' } });
const soloRut = Array.from({ length: 12 }, (_, i) => ({ alumno: 'Rita Rutina', rutina: 'Mes 1', dia: 'Día 1', ejercicio: 'Solo en rutinas ' + i, series: '3', reps: '10' }));
const rr = await call('/importar', { method: 'POST', token: T, body: { rutinas: soloRut } });
check('los ejercicios que solo vienen en la hoja Rutinas también cuentan', rr.status === 402 && /12 ejercicios nuevos/.test(rr.data.error), JSON.stringify(rr.data));
check('y la rutina no quedó a medias', await contar('rutinas', cid) === 0);
const rutAlumnoInexistente = await call('/importar/revisar', { method: 'POST', token: T,
  body: { rutinas: [{ alumno: 'No existe', ejercicio: 'Fantasma' }] } });
check('una rutina de un alumno que no existe no suma ejercicios', rutAlumnoInexistente.data.nuevos.ejercicios === 0);

// importación por alumno
const porAlumno = await call('/clientes/' + alumnoR.data.id + '/importar', { method: 'POST', token: T,
  body: { nombre: 'Mes 1', filas: soloRut.map(f => ({ dia: f.dia, ejercicio: f.ejercicio, series: '3', reps: '10' })) } });
check('la importación por alumno también respeta el tope', porAlumno.status === 402, JSON.stringify(porAlumno.data));

console.log('\n== TOPE DE ALUMNOS AL IMPORTAR ==');
const al = await nuevaCuenta('alum', 'activo');
const TA = al.data.token, aid = await idDe(`alum${s}@x.com`);
for (let i = 0; i < 148; i++)
  await db.execute({ sql: 'INSERT INTO clientes (id, cuenta_id, nombre, token, activo) VALUES (?,?,?,?,1)', args: ['c' + s + i, aid, 'Alumno ' + i, 'tk' + s + i] });
const yaEstan = await call('/importar', { method: 'POST', token: TA,
  body: { alumnos: [{ alumno: 'Alumno 1' }, { alumno: 'Alumno 2' }, { alumno: 'Alumno 3' }, { alumno: 'Nuevo Uno' }] } });
check('alumnos que ya existen no cuentan contra el tope (antes rechazaba de más)', yaEstan.status === 200 && yaEstan.data.alumnos === 1, JSON.stringify(yaEstan.data));
const demas = await call('/importar', { method: 'POST', token: TA, body: { alumnos: [{ alumno: 'Nuevo Dos' }, { alumno: 'Nuevo Tres' }] } });
check('2 alumnos nuevos con 1 lugar se rechaza', demas.status === 402 && /2 alumnos nuevos y te queda 1 lugar/.test(demas.data.error), demas.data.error);

console.log('\n== IMPORTAR ES TODO O NADA ==');
const tx = await nuevaCuenta('tx', 'activo');
const TT = tx.data.token, tid = await idDe(`tx${s}@x.com`);
// Forzamos una falla a mitad de camino: la base rechaza un turno puntual.
await db.execute(`CREATE TRIGGER IF NOT EXISTS falla_prueba BEFORE INSERT ON turnos
  WHEN NEW.nota = 'FALLAR' BEGIN SELECT RAISE(ABORT, 'falla de prueba'); END`);
const antesEj = await contar('ejercicios', tid), antesAl = await contar('clientes', tid);
const rompe = await call('/importar', { method: 'POST', token: TT, body: {
  ejercicios: [{ ejercicio: 'Antes de la falla', grupo: 'Pecho' }],
  alumnos: [{ alumno: 'Tomás Transacción' }],
  turnos: [{ alumno: 'Tomás Transacción', dia_semana: 1, hora: '09:00', duracion: 60, nota: 'FALLAR' }] } });
check('si algo falla a mitad, la importación da error', rompe.status === 500);
check('y no queda ningún ejercicio a medias', await contar('ejercicios', tid) === antesEj);
check('ni ningún alumno a medias', await contar('clientes', tid) === antesAl);
await db.execute('DROP TRIGGER falla_prueba');
const sana = await call('/importar', { method: 'POST', token: TT, body: {
  ejercicios: [{ ejercicio: 'Antes de la falla', grupo: 'Pecho', video: 'javascript:alert(1)' }],
  alumnos: [{ alumno: 'Tomás Transacción', peso: 'ochenta', altura: '175', inicio: 'ayer' }],
  turnos: [{ alumno: 'Tomás Transacción', dia_semana: 1, hora: '09:00', duracion: 60 }, { alumno: 'Tomás Transacción', dia_semana: 9, hora: 'xx' }] } });
check('sin la falla, la misma importación entra', sana.status === 200 && sana.data.alumnos === 1 && sana.data.ejercicios === 1, JSON.stringify(sana.data));
check('un link de video peligroso no rompe: se carga sin video y avisa',
  sana.data.avisos.some(a => /link/.test(a)) && (await db.execute({ sql: "SELECT video_url FROM ejercicios WHERE cuenta_id = ? AND nombre = 'Antes de la falla'", args: [tid] })).rows[0].video_url === null);
check('un peso escrito con letras no rompe: queda vacío y avisa', sana.data.avisos.some(a => /peso/.test(a)));
check('una fecha inválida arranca hoy y avisa', sana.data.avisos.some(a => /fecha/.test(a)));
check('un turno con día u hora inválidos se descarta', sana.data.turnos === 1, String(sana.data.turnos));
const linkRut = await call('/importar', { method: 'POST', token: TT, body: {
  rutinas: [{ alumno: 'Tomás Transacción', rutina: 'Mes 1', dia: 'Día 1', ejercicio: 'Con link roto', video: 'javascript:x', series: '3', reps: '10' }] } });
check('un link roto en la hoja Rutinas ya no tira abajo la importación', linkRut.status === 200 && linkRut.data.rutinas === 1, JSON.stringify(linkRut.data));

console.log('\n== SESION EN COOKIE ==');
const ses = await nuevaCuenta('ses');
const sc = ses.headers.get('set-cookie') || '';
check('el registro deja la sesión en una cookie', /st_sesion=/.test(sc));
check('la cookie no se puede leer desde la página (HttpOnly)', /HttpOnly/i.test(sc));
check('solo viaja por HTTPS (Secure)', /Secure/i.test(sc));
check('no viaja desde otros sitios (SameSite=Strict)', /SameSite=Strict/i.test(sc));
check('solo se manda a /api', /Path=\/api/i.test(sc));
check('dura 7 días', /Max-Age=604800/.test(sc));
const ck = cookieDe(ses);
check('el token vence a los 7 días', (() => { const d = jwt.decode(ck); return d.exp - d.iat === 7 * 86400; })());
const log = await call('/login', { method: 'POST', body: { email: `ses${s}@x.com`, password: 'clave12345' } });
const ckLog = cookieDe(log);
check('el login también deja la cookie', !!ckLog);
check('con la cookie se puede leer', (await call('/clientes', { cookie: ckLog })).status === 200);
check('con la cookie, escribir sin X-ST se rechaza (anti-CSRF)',
  (await call('/clientes', { method: 'POST', cookie: ckLog, body: { nombre: 'Intruso' } })).status === 403);
check('con la cookie y X-ST se puede escribir',
  (await call('/clientes', { method: 'POST', cookie: ckLog, xst: true, body: { nombre: 'Legítimo' } })).status === 200);
check('sin cookie ni token no entra', (await call('/clientes')).status === 401);
check('una cookie falsificada no entra', (await call('/clientes', { cookie: jwt.sign({ cuentaId: 'x', v: 0 }, 'otra') })).status === 401);
const vieja = jwt.sign({ cuentaId: await idDe(`ses${s}@x.com`), v: 0, iat: Math.floor(Date.now() / 1000) - 2 * 86400 }, SECRET, { expiresIn: '7d' });
const renov = await call('/clientes', { cookie: vieja });
check('una sesión de hace 2 días se renueva sola', renov.status === 200 && !!cookieDe(renov) && cookieDe(renov) !== vieja);
const fresca = await call('/clientes', { cookie: ckLog });
check('una sesión recién creada no se reemite en cada pedido', !cookieDe(fresca));
const vencida = jwt.sign({ cuentaId: await idDe(`ses${s}@x.com`), v: 0, iat: Math.floor(Date.now() / 1000) - 8 * 86400, exp: Math.floor(Date.now() / 1000) - 86400 }, SECRET);
const rv = await call('/clientes', { cookie: vencida });
check('una sesión vencida no entra y se borra la cookie', rv.status === 401 && /st_sesion=;/.test(rv.headers.get('set-cookie') || ''));
const salir = await call('/salir', { method: 'POST' });
check('salir borra la cookie', /st_sesion=;/.test(salir.headers.get('set-cookie') || ''));
// migración de la sesión vieja del navegador
const mig = await call('/sesion', { method: 'POST', token: log.data.token });
check('una sesión vieja (Bearer) se pasa a cookie', mig.status === 200 && !!cookieDe(mig));
// cambiar la contraseña corta las demás sesiones
const cambio = await call('/cambiar-clave', { method: 'POST', cookie: ckLog, xst: true, body: { actual: 'clave12345', nueva: 'claveNueva99' } });
check('cambiar la contraseña entrega una cookie nueva', cambio.status === 200 && !!cookieDe(cambio));
check('y la cookie anterior deja de servir', (await call('/clientes', { cookie: ckLog })).status === 401);
check('la nueva sí sirve', (await call('/clientes', { cookie: cookieDe(cambio) })).status === 200);

console.log('\n== ADMIN ==');
const falso = await call('/registro', { method: 'POST', body: { email: `quiero-ser-admin${s}@x.com`, password: 'clave12345', nombre: 'X' } });
check('una cuenta nueva común no es admin', falso.data.rol === 'pt');
const srv = require('fs').readFileSync(__dirname + '/server.js', 'utf8');
check('con ADMIN_EMAIL, solo ese mail puede ser admin', /esAdmin = adminMail \? mail === adminMail/.test(srv));

console.log('\n== MARCA PROPIA ==');
const gr = await nuevaCuenta('gratis');
const TG = gr.data.token;
const bloqueada = await call('/marca', { method: 'PUT', token: TG, body: { nombre: 'Gym Gratis', color: '#112233' } });
check('en el plan gratis la marca está bloqueada', bloqueada.status === 402 && bloqueada.data.tope === 'marca');
check('y el perfil lo indica', (await call('/perfil', { token: TG })).data.limites.marca === false);

const pm = await nuevaCuenta('marca', 'activo');
const TM = pm.data.token;
check('en el plan completo se puede', (await call('/marca', { token: TM })).data.permitido === true);
check('rechaza un color inválido', (await call('/marca', { method: 'PUT', token: TM, body: { nombre: 'X', color: 'red;}body{display:none' } })).status === 400);
check('rechaza un nombre de más de 40', (await call('/marca', { method: 'PUT', token: TM, body: { nombre: 'N'.repeat(41), color: '#112233' } })).status === 400);
const guard = await call('/marca', { method: 'PUT', token: TM, body: { nombre: '  Fuerza <b>Total</b>\u0007 ', color: '#1e88e5' } });
check('guarda nombre y color', guard.status === 200 && guard.data.nombre === 'Fuerza <b>Total</b>' && guard.data.color === '#1E88E5', JSON.stringify(guard.data));

// logo
const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
check('rechaza un SVG (puede traer código)', (await call('/marca/logo', { method: 'PUT', token: TM, body: { imagen: 'data:image/svg+xml;base64,' + svg } })).status === 400);
check('rechaza un SVG disfrazado de PNG', (await call('/marca/logo', { method: 'PUT', token: TM, body: { imagen: 'data:image/png;base64,' + svg } })).status === 400);
const grande = Buffer.concat([Buffer.from(png1x1, 'base64'), Buffer.alloc(210 * 1024)]).toString('base64');
check('rechaza un logo de más de 200 KB', (await call('/marca/logo', { method: 'PUT', token: TM, body: { imagen: 'data:image/png;base64,' + grande } })).status === 400);
const subido = await call('/marca/logo', { method: 'PUT', token: TM, body: { imagen: 'data:image/png;base64,' + png1x1 } });
check('acepta un PNG real', subido.status === 200 && subido.data.logo === true);
const gif = await call('/marca/logo', { method: 'PUT', token: TM, body: { imagen: 'data:image/png;base64,' + Buffer.from('GIF89a....').toString('base64') } });
check('el tipo se decide por el contenido, no por lo que dice el archivo', gif.status === 400);
const verLogo = await fetch(B + '/marca/logo', { headers: { Authorization: 'Bearer ' + TM } });
check('el PT ve su logo como imagen PNG', verLogo.status === 200 && verLogo.headers.get('content-type') === 'image/png');
check('el logo se sirve con política que no ejecuta nada', /default-src 'none'/.test(verLogo.headers.get('content-security-policy') || ''));

// vista del alumno
const alm = await call('/clientes', { method: 'POST', token: TM, body: { nombre: 'Ana Alumna' } });
const va = await call('/alumno/' + alm.data.token);
check('el alumno recibe la marca de su profe', va.data.marca && va.data.marca.nombre === 'Fuerza <b>Total</b>' && va.data.marca.color === '#1E88E5' && va.data.marca.logo === true, JSON.stringify(va.data.marca));
const lg = await fetch(B + '/alumno/' + alm.data.token + '/logo');
check('el alumno ve el logo de su profe', lg.status === 200 && lg.headers.get('content-type') === 'image/png');
check('un link inventado no ve ningún logo', (await fetch(B + '/alumno/0123456789abcdef/logo', { headers: { 'X-Forwarded-For': '10.3.3.3' } })).status === 404);
const deOtro = await call('/clientes', { method: 'POST', token: T, body: { nombre: 'De otro' } });
const vistaOtro = await call('/alumno/' + deOtro.data.token);
check('la marca no se filtra a los alumnos de otro profe', vistaOtro.status === 200 && vistaOtro.data.marca === null,
  deOtro.status + ' ' + JSON.stringify(deOtro.data).slice(0, 120) + ' | ' + vistaOtro.status + ' ' + JSON.stringify(vistaOtro.data.marca));

// si deja el plan completo, la marca deja de verse pero no se pierde
const mid = await idDe(`marca${s}@x.com`);
await db.execute({ sql: "UPDATE cuentas SET plan = 'prueba' WHERE id = ?", args: [mid] });
check('si deja el plan completo, el alumno ya no ve la marca', (await call('/alumno/' + alm.data.token)).data.marca === null);
check('ni el logo', (await fetch(B + '/alumno/' + alm.data.token + '/logo')).status === 404);
await db.execute({ sql: "UPDATE cuentas SET plan = 'activo' WHERE id = ?", args: [mid] });
check('al volver al plan completo reaparece tal cual', (await call('/alumno/' + alm.data.token)).data.marca.nombre === 'Fuerza <b>Total</b>');
check('el logo nunca viaja dentro del perfil (no lo hace pesado)', !('marca_logo' in (await call('/perfil', { token: TM })).data));
const quitar = await call('/marca/logo', { method: 'DELETE', token: TM });
check('se puede sacar el logo', quitar.data.logo === false && (await fetch(B + '/alumno/' + alm.data.token + '/logo')).status === 404);
check('la versión sube en cada cambio (para refrescar la imagen)', quitar.data.version > subido.data.version);
check('otro PT no puede tocar esta marca', (await call('/marca', { token: TG })).data.nombre === null);

const html = require('fs').readFileSync(__dirname + '/public/index.html', 'utf8');
check('la vista del alumno con marca sigue diciendo SmartTrainner', /con SmartTrainner<\/span>/.test(html) && /Hecho con SmartTrainner/.test(html));
check('la pestaña del navegador lleva "· SmartTrainner"', /' · SmartTrainner'/.test(html));

console.log(`\n===== ${ok} pruebas OK, ${fail} fallas =====`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
