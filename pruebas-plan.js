// Pruebas del plan mensual, la renovación, el aviso de pago y la seguridad del login.
// Uso (con el servidor levantado como indica pruebas.js):
//   TURSO_URL="file:test.db" node pruebas-plan.js
// Toca la base directo solo para simular fechas pasadas.

const fs = require('fs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@libsql/client');

const B = process.env.BASE || 'http://localhost:3210/api';
const db = createClient({ url: process.env.TURSO_URL || 'file:test.db' });
let ok = 0, fail = 0;
const check = (n, c, x = '') => {
  if (c) { ok++; console.log('  OK  ' + n); }
  else { fail++; console.log('FALLA ' + n + (x ? ' -> ' + x : '')); }
};
async function call(p, { method = 'GET', body, token, ip } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  if (ip) h['X-Forwarded-For'] = ip;
  const r = await fetch(B + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, headers: r.headers, data: await r.json().catch(() => ({})) };
}

// Las funciones de fecha se sacan del propio server.js: se prueba el código real.
const srv = fs.readFileSync(__dirname + '/server.js', 'utf8');
const trozo = srv.slice(srv.indexOf('const diasDelMes'), srv.indexOf('const VENTANA_RENOVAR'));
const F = new Function(trozo + '; return { sumarMes, diasEntre, diaDe };')();

const ZONA = 'America/Argentina/Buenos_Aires';
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const mover = (f, dias) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const restarMes = f => { const [a, m, d] = f.split('-').map(Number);
  const pa = m === 1 ? a - 1 : a, pm = m === 1 ? 12 : m - 1;
  return `${pa}-${String(pm).padStart(2, '0')}-${String(Math.min(d, 28)).padStart(2, '0')}`; };

(async () => {
console.log('\n== CALCULO DEL VENCIMIENTO ==');
check('15/09 vence 15/10', F.sumarMes('2026-09-15') === '2026-10-15');
check('diciembre pasa al año siguiente', F.sumarMes('2026-12-15') === '2027-01-15');
check('31/08 vence 30/09 (septiembre tiene 30)', F.sumarMes('2026-08-31') === '2026-09-30');
check('31/01 vence 28/02 en año común', F.sumarMes('2027-01-31') === '2027-02-28');
check('31/01 vence 29/02 en año bisiesto', F.sumarMes('2028-01-31') === '2028-02-29');
check('con día de cobro 31, desde 28/02 vuelve a 31/03', F.sumarMes('2027-02-28', 31) === '2027-03-31');
check('con día de cobro 31, desde 31/03 va a 30/04', F.sumarMes('2027-03-31', 31) === '2027-04-30');
check('días entre fechas', F.diasEntre('2026-09-15', '2026-10-15') === 30);
check('días entre fechas cruzando año', F.diasEntre('2026-12-31', '2027-01-01') === 1);
// una cadena de 12 renovaciones desde el 31 no se corre
let f = '2027-01-31'; const cadena = [];
for (let i = 0; i < 12; i++) { f = F.sumarMes(f, 31); cadena.push(f.slice(8)); }
check('12 meses seguidos respetan el día 31 cuando existe',
  cadena.join(',') === '28,31,30,31,30,31,31,30,31,30,31,31', cadena.join(','));

console.log('\n== CUENTAS PARA LAS PRUEBAS ==');
const sufijo = Date.now();
const r1 = await call('/registro', { method: 'POST', body: { email: `plan${sufijo}@x.com`, password: 'clave12345', nombre: 'PT Plan' } });
const r2 = await call('/registro', { method: 'POST', body: { email: `otro${sufijo}@x.com`, password: 'clave12345', nombre: 'PT Otro' } });
check('se crean las cuentas', r1.status === 200 && r2.status === 200, JSON.stringify(r1.data));
const t1 = r1.data.token, t2 = r2.data.token;
// plan completo para no chocar con el tope de 3 alumnos del plan gratis
await db.execute({ sql: "UPDATE cuentas SET plan = 'activo' WHERE email IN (?, ?)", args: [`plan${sufijo}@x.com`, `otro${sufijo}@x.com`] });

console.log('\n== ALTA Y EDICION DEL ALUMNO ==');
const a1 = await call('/clientes', { method: 'POST', token: t1, body: { nombre: 'Alumno Quince', inicio: '2026-09-15' } });
check('alta del 15/09 vence el 15/10', a1.data.vence === '2026-10-15', JSON.stringify(a1.data));
check('guarda el día de cobro 15', a1.data.dia_cobro === 15);
const ver1 = await call('/clientes/' + a1.data.id, { token: t1 });
check('el detalle trae el vencimiento', ver1.data.vence === '2026-10-15');
await call('/clientes/' + a1.data.id, { method: 'PATCH', token: t1, body: { nombre: 'Alumno Quince B', inicio: '2026-09-15' } });
check('editar sin tocar la fecha no cambia el vencimiento',
  (await call('/clientes/' + a1.data.id, { token: t1 })).data.vence === '2026-10-15');
await call('/clientes/' + a1.data.id, { method: 'PATCH', token: t1, body: { nombre: 'Alumno Quince B', inicio: '2026-08-31' } });
const ed = (await call('/clientes/' + a1.data.id, { token: t1 })).data;
check('cambiar la fecha recalcula (31/08 -> 30/09)', ed.vence === '2026-09-30' && ed.dia_cobro === 31, ed.vence);
const sinFecha = await call('/clientes', { method: 'POST', token: t1, body: { nombre: 'Sin Fecha' } });
check('sin fecha arranca hoy y vence en un mes', sinFecha.data.inicio === hoy() && sinFecha.data.vence === F.sumarMes(hoy()));

console.log('\n== MIGRACION DE ALUMNOS VIEJOS ==');
await db.execute({ sql: 'UPDATE clientes SET vence = NULL, dia_cobro = NULL WHERE id = ?', args: [a1.data.id] });
check('queda sin vencimiento antes de migrar',
  (await db.execute({ sql: 'SELECT vence FROM clientes WHERE id = ?', args: [a1.data.id] })).rows[0].vence === null);
// la migración corre al arrancar; se simula con la misma regla
const migrado = F.sumarMes(ed.inicio);
check('la regla de migración da el mismo día del mes siguiente', migrado === '2026-09-30');

console.log('\n== RENOVAR EL PLAN ==');
// vence en 20 días: todavía no se puede renovar
const lejos = await call('/clientes', { method: 'POST', token: t1, body: { nombre: 'Lejos', inicio: mover(hoy(), -10) } });
const rl = await call('/clientes/' + lejos.data.id + '/renovar-plan', { method: 'POST', token: t1 });
check('fuera de la semana de vencimiento no renueva', rl.status === 200 && rl.data.renovado === false, JSON.stringify(rl.data));
check('y el vencimiento queda igual', (await call('/clientes/' + lejos.data.id, { token: t1 })).data.vence === lejos.data.vence);

// vence en 3 días
const vence3 = mover(hoy(), 3), inicio3 = restarMes(vence3);
const cerca = await call('/clientes', { method: 'POST', token: t1, body: { nombre: 'Cerca', inicio: inicio3 } });
await db.execute({ sql: 'UPDATE clientes SET vence = ?, dia_cobro = ? WHERE id = ?', args: [vence3, F.diaDe(vence3), cerca.data.id] });
const rc = await call('/clientes/' + cerca.data.id + '/renovar-plan', { method: 'POST', token: t1 });
check('a 3 días del vencimiento renueva', rc.data.renovado === true, JSON.stringify(rc.data));
check('el mes nuevo se suma al vencimiento anterior (no a hoy)', rc.data.vence === F.sumarMes(vence3), rc.data.vence);
check('el ciclo nuevo arranca hoy', rc.data.inicio === hoy());
const rc2 = await call('/clientes/' + cerca.data.id + '/renovar-plan', { method: 'POST', token: t1 });
check('renovar dos veces seguidas no suma otro mes', rc2.data.renovado === false && rc2.data.vence === rc.data.vence);

// vencido hace 3 días: conserva el día de cobro
const vencio3 = mover(hoy(), -3);
const atrasado = await call('/clientes', { method: 'POST', token: t1, body: { nombre: 'Atrasado', inicio: restarMes(vencio3) } });
await db.execute({ sql: 'UPDATE clientes SET vence = ?, dia_cobro = ? WHERE id = ?', args: [vencio3, F.diaDe(vencio3), atrasado.data.id] });
const ra = await call('/clientes/' + atrasado.data.id + '/renovar-plan', { method: 'POST', token: t1 });
check('vencido hace 3 días conserva su día de cobro', ra.data.vence === F.sumarMes(vencio3), ra.data.vence);

// vencido hace 40 días: arranca de cero
const vencio40 = mover(hoy(), -40);
const perdido = await call('/clientes', { method: 'POST', token: t1, body: { nombre: 'Perdido', inicio: restarMes(vencio40) } });
await db.execute({ sql: 'UPDATE clientes SET vence = ? WHERE id = ?', args: [vencio40, perdido.data.id] });
const rp = await call('/clientes/' + perdido.data.id + '/renovar-plan', { method: 'POST', token: t1 });
check('vencido hace más de 7 días arranca de cero desde hoy', rp.data.vence === F.sumarMes(hoy()), rp.data.vence);
const pd = (await call('/clientes/' + perdido.data.id, { token: t1 })).data;
check('y toma el día de hoy como día de cobro', pd.dia_cobro === F.diaDe(hoy()));

// ancla 31 en la base
const a31 = await call('/clientes', { method: 'POST', token: t1, body: { nombre: 'Del treinta y uno', inicio: '2026-08-31' } });
const v31 = mover(hoy(), 2);
await db.execute({ sql: 'UPDATE clientes SET vence = ?, dia_cobro = 31 WHERE id = ?', args: [v31, a31.data.id] });
const r31 = await call('/clientes/' + a31.data.id + '/renovar-plan', { method: 'POST', token: t1 });
check('renovar respeta el día de cobro guardado', r31.data.vence === F.sumarMes(v31, 31), r31.data.vence);

console.log('\n== RENOVAR DESDE LA RUTINA ==');
const conRut = await call('/clientes', { method: 'POST', token: t1, body: { nombre: 'Con rutina', inicio: restarMes(mover(hoy(), 5)) } });
const vence5 = mover(hoy(), 5);
await db.execute({ sql: 'UPDATE clientes SET vence = ?, dia_cobro = ? WHERE id = ?', args: [vence5, F.diaDe(vence5), conRut.data.id] });
const rut = await call('/clientes/' + conRut.data.id + '/rutinas', { method: 'POST', token: t1, body: { nombre: 'Mes 1', dias: [{ nombre: 'Día 1' }] } });
const dup = await call('/rutinas/' + rut.data.id + '/duplicar', { method: 'POST', token: t1,
  body: { cliente_id: conRut.data.id, renovar: true, nombre: 'Mes 2' } });
check('renovar la rutina crea la rutina nueva', dup.status === 200 && dup.data.nombre === 'Mes 2');
check('y renueva el plan (antes quedaba en "toca renovar")', dup.data.plan && dup.data.plan.renovado === true, JSON.stringify(dup.data.plan));
check('con vencimiento un mes después del anterior', dup.data.plan.vence === F.sumarMes(vence5));
const copia = await call('/rutinas/' + rut.data.id + '/duplicar', { method: 'POST', token: t1,
  body: { cliente_id: conRut.data.id, nombre: 'Copia' } });
check('copiar sin renovar no toca el plan', copia.status === 200 && !copia.data.plan);
const dupLejos = await call('/rutinas/' + rut.data.id + '/duplicar', { method: 'POST', token: t1,
  body: { cliente_id: conRut.data.id, renovar: true, nombre: 'Mes 3' } });
check('renovar la rutina a mitad de mes cambia la rutina pero no el plan', dupLejos.data.plan.renovado === false);

console.log('\n== AVISO DE PAGO PARA EL ALUMNO ==');
const vista = async id => {
  const tok = (await db.execute({ sql: 'SELECT token FROM clientes WHERE id = ?', args: [id] })).rows[0].token;
  return call('/alumno/' + tok);
};
for (const [dias, nombre] of [[3, 'a 3 días'], [1, 'a 1 día'], [0, 'el día que vence'], [-2, 'vencido'], [10, 'a 10 días']]) {
  const v = mover(hoy(), dias);
  await db.execute({ sql: 'UPDATE clientes SET vence = ? WHERE id = ?', args: [v, lejos.data.id] });
  const x = await vista(lejos.data.id);
  check('el alumno recibe los días que faltan ' + nombre, x.data.dias_para_vencer === dias && x.data.vence === v,
    JSON.stringify({ d: x.data.dias_para_vencer, v: x.data.vence }));
}
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
check('la vista del alumno muestra el aviso con 3 días o menos', /d\.dias_para_vencer <= 3/.test(html));
check('el aviso le pide abonar', /Recordá abonarle a tu profe/.test(html));

console.log('\n== SEMANAS DEL CICLO NUEVO ==');
// Un alumno anotó en la semana 1 del mes pasado; tras renovar, su semana 1 arranca limpia.
const sem = await call('/clientes', { method: 'POST', token: t1, body: { nombre: 'Semanas', inicio: hoy() } });
const rs = await call('/clientes/' + sem.data.id + '/rutinas', { method: 'POST', token: t1, body: { nombre: 'Mes 1', dias: [{ nombre: 'Día 1' }] } });
const ejs = (await call('/ejercicios', { token: t1 })).data.ejercicios;
const itm = await call('/dias/' + rs.data.dias[0].id + '/items', { method: 'POST', token: t1, body: { ejercicio_id: ejs[0].id, series: '3', reps: '10' } });
const tokSem = (await db.execute({ sql: 'SELECT token FROM clientes WHERE id = ?', args: [sem.data.id] })).rows[0].token;
const itemId = itm.data.id || (itm.data.items ? itm.data.items[0].id : null);
const anot = await call('/alumno/' + tokSem + '/series', { method: 'POST', body: { item_id: itemId, numero: 1, kg: 50, reps: 10 } });
check('el alumno anota una serie', anot.status === 200 && anot.data.series.length === 1, JSON.stringify(anot.data).slice(0, 200));
// esa serie pasa a ser del mes anterior
const mesPasado = mover(hoy(), -31);
await db.execute({ sql: 'UPDATE series_log SET fecha = ? WHERE cliente_id = ?', args: [mesPasado, sem.data.id] });
await db.execute({ sql: 'UPDATE clientes SET inicio = ? WHERE id = ?', args: [hoy(), sem.data.id] });
const vistaSem = await call('/alumno/' + tokSem);
check('la semana 1 del mes nuevo no muestra lo del mes anterior', vistaSem.data.semana === 1 && vistaSem.data.series.length === 0,
  JSON.stringify(vistaSem.data.series));
const hist = await call('/clientes/' + sem.data.id, { token: t1 });
check('el historial del PT conserva lo anotado', JSON.stringify(hist.data.registros).includes('50'));
check('las semanas del ciclo salen del vencimiento', vistaSem.data.semanas_totales === Math.ceil(F.diasEntre(hoy(), F.sumarMes(hoy())) / 7));

console.log('\n== AISLAMIENTO ENTRE CUENTAS ==');
check('otro PT no puede renovar el plan de un alumno ajeno',
  (await call('/clientes/' + cerca.data.id + '/renovar-plan', { method: 'POST', token: t2 })).status === 404);
check('otro PT no puede renovar con una rutina ajena',
  (await call('/rutinas/' + rut.data.id + '/duplicar', { method: 'POST', token: t2, body: { cliente_id: conRut.data.id, renovar: true } })).status === 404);
const venceAntes = (await db.execute({ sql: 'SELECT vence FROM clientes WHERE id = ?', args: [cerca.data.id] })).rows[0].vence;
check('y el vencimiento ajeno no se movió', venceAntes === rc.data.vence);

console.log('\n== LOGIN Y SESION ==');
const noExiste = await call('/login', { method: 'POST', body: { email: `nadie${sufijo}@x.com`, password: 'clave12345' }, ip: '10.9.0.1' });
const claveMal = await call('/login', { method: 'POST', body: { email: `plan${sufijo}@x.com`, password: 'otraclave1' }, ip: '10.9.0.2' });
check('mail inexistente y clave mal dan el mismo mensaje', noExiste.status === 401 && claveMal.status === 401 && noExiste.data.error === claveMal.data.error);
// la demora no delata si el mail existe
const medir = async body => { const t = Date.now(); await call('/login', { method: 'POST', body, ip: '10.9.0.' + (3 + Math.floor(Math.random() * 200)) }); return Date.now() - t; };
const tNo = await medir({ email: `nadie2${sufijo}@x.com`, password: 'x12345678' });
const tSi = await medir({ email: `plan${sufijo}@x.com`, password: 'x12345678' });
check('el login tarda parecido exista o no el mail', tNo > tSi * 0.4, `${tNo}ms vs ${tSi}ms`);
const larga = await call('/registro', { method: 'POST', body: { email: `larga${sufijo}@x.com`, password: 'a'.repeat(200), nombre: 'L' }, ip: '10.9.1.1' });
check('rechaza contraseñas de más de 128 caracteres', larga.status === 400);
const nombreLargo = await call('/registro', { method: 'POST', body: { email: `nom${sufijo}@x.com`, password: 'clave12345', nombre: 'N'.repeat(200) }, ip: '10.9.1.2' });
check('rechaza nombres larguísimos', nombreLargo.status === 400);
const sinFirma = jwt.sign({ cuentaId: 'x', v: 0 }, '', { algorithm: 'none' });
check('rechaza un token sin firma (alg none)', (await call('/clientes', { token: sinFirma })).status === 401);
const otraClave = jwt.sign({ cuentaId: 'x', v: 0 }, 'otro-secreto-cualquiera');
check('rechaza un token firmado con otra clave', (await call('/clientes', { token: otraClave })).status === 401);
const ok1 = await call('/clientes', { token: t1 });
check('un token válido sigue entrando', ok1.status === 200);

console.log('\n== RECUPERAR CONTRASEÑA ==');
const rec = await fetch(B + '/recuperar', { method: 'POST',
  headers: { 'Content-Type': 'application/json', Host: 'atacante.com', 'X-Forwarded-Host': 'atacante.com', 'X-Forwarded-For': '10.9.2.1' },
  body: JSON.stringify({ email: `plan${sufijo}@x.com` }) });
check('recuperar responde igual aunque manden otro Host', rec.status === 200);
const log = fs.existsSync(__dirname + '/srv.log') ? fs.readFileSync(__dirname + '/srv.log', 'utf8') : '';
check('nunca arma un link con el Host falso', !/atacante\.com/.test(log));

console.log('\n== CABECERAS DE SEGURIDAD ==');
const pag = await fetch(B.replace('/api', '/'));
const csp = pag.headers.get('content-security-policy') || '';
check('manda Content-Security-Policy', /default-src 'self'/.test(csp) && /connect-src 'self'/.test(csp));
check('CSP estricta: sin unsafe-inline ni unsafe-eval en scripts', /script-src 'self' https:\/\/unpkg\.com(;|$)/.test(csp) && !/script-src[^;]*unsafe/.test(csp));
check('manda HSTS', /max-age=31536000/.test(pag.headers.get('strict-transport-security') || ''));
check('no permite cámara ni ubicación', /camera=\(\)/.test(pag.headers.get('permissions-policy') || ''));
check('no dice que es Express', !pag.headers.get('x-powered-by'));
check('las librerías tienen versión fija y huella', (html.match(/integrity="sha384-/g) || []).length === 3 && !/react@18\//.test(html));
check('ya no se carga Babel en el navegador', !/babel\/standalone/.test(html));
const servido = await (await fetch(B.replace('/api', '/'))).text();
check('la página servida trae la app compilada, no JSX', /<script src="\/app\.[a-f0-9]{12}\.js"><\/script>/.test(servido) && !/text\/babel/.test(servido));

console.log('\n== LINKS DE ALUMNO ADIVINADOS ==');
const ipAtacante = '10.66.0.1';
let bloqueado = false, primero = null;
for (let i = 0; i < 40; i++) {
  const r = await call('/alumno/' + 'deadbeef' + String(i).padStart(8, '0'), { ip: ipAtacante });
  if (i === 0) primero = r.status;
  if (r.status === 429) { bloqueado = true; break; }
}
check('un link inexistente da 404', primero === 404);
check('probar links al azar se frena solo', bloqueado);
check('el bloqueo no afecta a otro alumno de otra conexión', (await call('/alumno/' + tokSem, { ip: '10.66.0.2' })).status === 200);
const basura = await call('/alumno/' + encodeURIComponent("' OR 1=1 --"), { ip: '10.66.0.3' });
check('un link con caracteres raros se rechaza', basura.status === 404);

console.log(`\n===== ${ok} pruebas OK, ${fail} fallas =====`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
