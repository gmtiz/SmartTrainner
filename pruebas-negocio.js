// Pruebas de cobros, pantalla "Hoy", reportes del negocio y app instalable.
// Uso (con el servidor levantado como indica pruebas.js):
//   TURSO_URL="file:test.db" node pruebas-negocio.js
// Toca la base directo solo para simular fechas y pasar una cuenta al plan completo.

const fs = require('fs');
const { createClient } = require('@libsql/client');

const B = process.env.BASE || 'http://localhost:3210/api';
const RAIZ = B.replace(/\/api$/, '');
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
const sql = (s, args = []) => db.execute({ sql: s, args });

// Las funciones de fecha se sacan del propio server.js: se prueba el código real.
const srv = fs.readFileSync(__dirname + '/server.js', 'utf8');
const trozo = srv.slice(srv.indexOf('const diasDelMes'), srv.indexOf('const VENTANA_RENOVAR'));
const F = new Function(trozo + '; return { sumarMes, diasEntre, diaSemana, sumarDias, mesAnterior, proximoCumple };')();

const ZONA = 'America/Argentina/Buenos_Aires';
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const mes = hoy.slice(0, 7);

(async () => {
console.log('\n== FECHAS ==');
check('el 29/02 se festeja el 28/02 en año común', F.proximoCumple('2000-02-29', '2027-02-01').fecha === '2027-02-28');
check('cumple que ya pasó cae el año que viene', F.proximoCumple('1990-01-10', '2026-10-05').fecha === '2027-01-10');
check('y cuenta los años que cumple', F.proximoCumple('1990-01-10', '2026-10-05').cumple === 37);
check('cumple de hoy da 0 días', F.proximoCumple('1996-10-05', '2026-10-05').dias === 0);
check('mes anterior a enero es diciembre', F.mesAnterior('2026-01') === '2025-12');
check('día de la semana sin depender del huso', F.diaSemana('2026-10-05') === 1);
check('sumar días cruza el mes', F.sumarDias('2026-10-30', 3) === '2026-11-02');

const s = Date.now().toString(36);
const reg = async (n) => (await call('/registro', { method: 'POST', ip: '10.9.' + n + '.1',
  body: { email: `neg${n}${s}@x.com`, password: 'clave12345', nombre: 'Profe Negocio ' + n } })).data;
const A = await reg(1), Z = await reg(2);
const pt = A.token, otro = Z.token;
check('se crean las cuentas de prueba', !!pt && !!otro);
// Sin ejemplos, para que no molesten.
await call('/ejemplos', { method: 'DELETE', token: pt });

console.log('\n== ALUMNO CON CUOTA Y NACIMIENTO ==');
const nace = (Number(hoy.slice(0, 4)) - 30) + hoy.slice(4);
check('cuota inválida se rechaza',
  (await call('/clientes', { method: 'POST', token: pt, body: { nombre: 'X', precio: -5 } })).status === 400);
check('nacimiento en el futuro se rechaza',
  (await call('/clientes', { method: 'POST', token: pt, body: { nombre: 'X', nacimiento: '2999-01-01' } })).status === 400);
const al = (await call('/clientes', { method: 'POST', token: pt,
  body: { nombre: 'Lucía Pago', contacto: '11 5555-4444', precio: 30000, nacimiento: nace } })).data;
check('alumno con cuota creado', !!al.id);
let ficha = (await call('/clientes/' + al.id, { token: pt })).data;
check('guarda la cuota', ficha.precio === 30000);
check('guarda el nacimiento', ficha.nacimiento === nace);
check('guarda la fecha de alta', ficha.creado === hoy);
await call('/clientes/' + al.id, { method: 'PATCH', token: pt,
  body: { nombre: 'Lucía Pago', contacto: '11 5555-4444', inicio: ficha.inicio } });
ficha = (await call('/clientes/' + al.id, { token: pt })).data;
check('editar sin mandar la cuota no la borra', ficha.precio === 30000 && ficha.nacimiento === nace);
await call('/clientes/' + al.id, { method: 'PATCH', token: pt,
  body: { nombre: 'Lucía Pago', contacto: '11 5555-4444', inicio: ficha.inicio, precio: 32000, nacimiento: nace } });
check('la cuota se puede cambiar', (await call('/clientes/' + al.id, { token: pt })).data.precio === 32000);

let n = (await call('/negocio', { token: pt })).data;
check('el plan gratis ve la caja', n.mes === mes && n.caja.cobrado === 0);
check('pero no los reportes', n.reportes === null && n.reportes_bloqueados === true);
// El resto se prueba con el plan completo (el gratis llega a 3 alumnos).
await sql("UPDATE cuentas SET plan = 'activo' WHERE id = (SELECT cuenta_id FROM clientes WHERE id = ?)", [al.id]);

console.log('\n== COBROS ==');
check('pago sin monto se rechaza',
  (await call('/clientes/' + al.id + '/pagos', { method: 'POST', token: pt, body: {} })).status === 400);
check('pago en cero se rechaza',
  (await call('/clientes/' + al.id + '/pagos', { method: 'POST', token: pt, body: { monto: 0 } })).status === 400);
check('medio de pago inventado se rechaza',
  (await call('/clientes/' + al.id + '/pagos', { method: 'POST', token: pt, body: { monto: 100, medio: 'bitcoin' } })).status === 400);
check('pago con fecha futura se rechaza',
  (await call('/clientes/' + al.id + '/pagos', { method: 'POST', token: pt, body: { monto: 100, fecha: '2999-01-01' } })).status === 400);

// En la semana de vencimiento: se renueva desde el vencimiento.
const vence1 = F.sumarDias(hoy, 3);
await sql('UPDATE clientes SET vence = ?, dia_cobro = ? WHERE id = ?', [vence1, Number(vence1.slice(8)), al.id]);
const p1 = await call('/clientes/' + al.id + '/pagos', { method: 'POST', token: pt,
  body: { monto: 32000, medio: 'transferencia' } });
check('registrar pago', p1.status === 200 && p1.data.monto === 32000);
check('renueva el plan desde el vencimiento', p1.data.plan && p1.data.plan.vence === F.sumarMes(vence1),
  JSON.stringify(p1.data.plan));
check('el pago guarda hasta cuándo quedó el plan', p1.data.vence === F.sumarMes(vence1));

// Por adelantado: el vencimiento se corre un mes y el ciclo no se corta.
const vence2 = F.sumarDias(hoy, 20);
await sql('UPDATE clientes SET inicio = ?, vence = ?, dia_cobro = ? WHERE id = ?',
  [F.sumarDias(hoy, -10), vence2, Number(vence2.slice(8)), al.id]);
const p2 = await call('/clientes/' + al.id + '/pagos', { method: 'POST', token: pt, body: { monto: 32000 } });
check('pago por adelantado suma un mes', p2.data.plan && p2.data.plan.adelantado && p2.data.plan.vence === F.sumarMes(vence2),
  JSON.stringify(p2.data.plan));
ficha = (await call('/clientes/' + al.id, { token: pt })).data;
check('y no corta el ciclo que está haciendo', ficha.inicio === F.sumarDias(hoy, -10));

// Solo anotar (el plan ya se renovó con la rutina).
const p3 = await call('/clientes/' + al.id + '/pagos', { method: 'POST', token: pt,
  body: { monto: 1500, medio: 'efectivo', nota: 'Diferencia', renovar: false } });
check('pago sin renovar no toca el vencimiento', p3.data.plan === null && p3.data.vence === F.sumarMes(vence2));

const lista = (await call('/clientes/' + al.id + '/pagos', { token: pt })).data;
check('la ficha lista los pagos', lista.length === 3);
check('el más nuevo primero', lista[0].nota === 'Diferencia');

console.log('\n== COBROS: CADA CUENTA VE LO SUYO ==');
check('otra cuenta no ve los pagos', (await call('/clientes/' + al.id + '/pagos', { token: otro })).status === 404);
check('otra cuenta no puede cobrarle', (await call('/clientes/' + al.id + '/pagos', { method: 'POST', token: otro,
  body: { monto: 10 } })).status === 404);
check('otra cuenta no puede borrar un pago', (await call('/pagos/' + p3.data.id, { method: 'DELETE', token: otro })).status === 404);
check('el pago sigue estando', (await call('/clientes/' + al.id + '/pagos', { token: pt })).data.length === 3);
check('sin sesión no se cobra', (await call('/clientes/' + al.id + '/pagos', { method: 'POST', body: { monto: 10 } })).status === 401);

const antes = (await call('/clientes/' + al.id, { token: pt })).data.vence;
check('borrar un pago', (await call('/pagos/' + p3.data.id, { method: 'DELETE', token: pt })).status === 200);
check('ya no aparece', (await call('/clientes/' + al.id + '/pagos', { token: pt })).data.length === 2);
check('y el vencimiento no cambia', (await call('/clientes/' + al.id, { token: pt })).data.vence === antes);
check('borrar uno que no existe da 404', (await call('/pagos/nada', { method: 'DELETE', token: pt })).status === 404);

console.log('\n== HOY ==');
// Un alumno que debe, uno con turno hoy y mañana, uno que dejó de entrenar.
const deudor = (await call('/clientes', { method: 'POST', token: pt,
  body: { nombre: 'Martín Debe', contacto: '0351 15 444-5555', precio: 25000 } })).data;
await sql('UPDATE clientes SET vence = ? WHERE id = ?', [F.sumarDias(hoy, -2), deudor.id]);
const lejano = (await call('/clientes', { method: 'POST', token: pt, body: { nombre: 'Viejo Deudor' } })).data;
await sql('UPDATE clientes SET vence = ? WHERE id = ?', [F.sumarDias(hoy, -90), lejano.id]);
await call('/turnos', { method: 'POST', token: pt,
  body: { cliente_id: deudor.id, dia_semana: F.diaSemana(hoy), hora: '18:00', duracion: 60 } });
await call('/turnos', { method: 'POST', token: pt,
  body: { cliente_id: al.id, dia_semana: F.diaSemana(F.sumarDias(hoy, 1)), hora: '07:30' } });

const ej = (await call('/ejercicios', { method: 'POST', token: pt, body: { nombre: 'Remo ' + s, grupo: 'Espalda' } })).data;
const quieto = (await call('/clientes', { method: 'POST', token: pt, body: { nombre: 'Quieto Total' } })).data;
const rut = (await call('/clientes/' + quieto.id + '/rutinas', { method: 'POST', token: pt,
  body: { nombre: 'Mes 1', dias: [{ nombre: 'Día 1' }] } })).data;
const rutCompleta = (await call('/rutinas/' + rut.id, { token: pt })).data;
const item = (await call('/dias/' + rutCompleta.dias[0].id + '/items', { method: 'POST', token: pt,
  body: { ejercicio_id: ej.id, series: '3', reps: '10' } })).data;
await sql('UPDATE rutinas SET inicio = ? WHERE id = ?', [F.sumarDias(hoy, -10), rut.id]);

let h = (await call('/hoy', { token: pt })).data;
check('hoy responde', h.fecha === hoy, h.fecha);
check('lista los turnos de hoy', h.turnos_hoy.some(t => t.cliente_id === deudor.id && t.hora === '18:00'));
check('con el contacto para el recordatorio', h.turnos_hoy.find(t => t.cliente_id === deudor.id).contacto === '0351 15 444-5555');
check('y los de mañana', h.turnos_manana.some(t => t.cliente_id === al.id));
const v = h.vencen.find(c => c.id === deudor.id);
check('avisa al que debe', !!v && v.dias === -2 && v.precio === 25000);
check('no repite al que debe hace meses (ese va en Negocio)', !h.vencen.some(c => c.id === lejano.id));
const q = h.inactivos.find(c => c.id === quieto.id);
check('detecta al que no entrena hace días', !!q && q.dias === 10 && q.ultima === null, JSON.stringify(q));
check('el cumpleañero aparece', h.cumples.some(c => c.id === al.id && c.dias === 0 && c.cumple === 30));
check('la caja suma lo cobrado en el mes', h.caja.cobrado === 64000 && h.caja.pagos === 2, JSON.stringify(h.caja));

// Marca asistencia desde Hoy y el alumno inactivo anota una serie y una observación.
await call('/asistencias', { method: 'POST', token: pt, body: { cliente_id: deudor.id, fecha: hoy, estado: 'presente' } });
const tokQ = (await call('/clientes/' + quieto.id, { token: pt })).data.token;
await call('/alumno/' + tokQ + '/series', { method: 'POST', body: { item_id: item.id, numero: 1, kg: 40, reps: 10 } });
await call('/alumno/' + tokQ + '/observacion', { method: 'POST', body: { item_id: item.id, texto: 'Me molestó el hombro' } });
h = (await call('/hoy', { token: pt })).data;
check('la asistencia queda marcada en el turno', h.turnos_hoy.find(t => t.cliente_id === deudor.id).asistencia === 'presente');
check('el que volvió a entrenar sale de inactivos', !h.inactivos.some(c => c.id === quieto.id));
check('su observación aparece', h.observaciones.some(o => o.cliente_id === quieto.id && o.texto === 'Me molestó el hombro'
  && o.ejercicio === 'Remo ' + s));
check('otra cuenta no ve nada de esto', (await call('/hoy', { token: otro })).data.vencen.length === 0);

console.log('\n== NEGOCIO ==');
n = (await call('/negocio', { token: pt })).data;
check('la caja suma lo cobrado', n.caja.cobrado === 64000);
check('lista los pagos del mes', n.pagos.length === 2 && n.pagos[0].alumno === 'Lucía Pago');
check('agrupa por medio de pago', n.caja.por_medio.some(m => m.medio === 'transferencia' && m.total === 32000));
check('pago promedio', n.caja.ticket === 32000);
check('lista a los que deben, también los de hace meses', n.deudores.some(c => c.id === deudor.id) &&
  n.deudores.some(c => c.id === lejano.id));
check('el más atrasado primero', n.deudores[0].id === lejano.id);
check('por cobrar suma las cuotas cargadas', n.caja.a_cobrar >= 25000);
check('y cuenta los que no tienen cuota', n.caja.sin_precio >= 1);
check('mes inválido se rechaza', (await call('/negocio?mes=2026-13', { token: pt })).status === 400);
check('mes con letras se rechaza', (await call('/negocio?mes=abc', { token: pt })).status === 400);
check('un mes sin pagos da cero', (await call('/negocio?mes=2020-01', { token: pt })).data.caja.cobrado === 0);

check('con el plan completo vienen los reportes', !!n.reportes && !n.reportes_bloqueados);
check('ingresos de 12 meses', n.reportes.ingresos.length === 12);
check('el último es el mes elegido', n.reportes.ingresos[11].mes === mes && n.reportes.ingresos[11].total === 64000);
check('movimiento de 6 meses', n.reportes.movimiento.length === 6);
check('cuenta las altas del mes', n.reportes.alumnos.altas === 4, n.reportes.alumnos.altas);
check('asistencia del mes', n.reportes.asistencia.presente === 1 && n.reportes.asistencia.porcentaje === 100);
check('alumnos que entrenaron', n.reportes.entrenamiento.alumnos === 1 && n.reportes.entrenamiento.sesiones === 1);
check('horarios más pedidos', n.reportes.horarios.length === 2 && n.reportes.por_dia.length === 7);

await call('/clientes/' + lejano.id, { method: 'DELETE', token: pt });
n = (await call('/negocio', { token: pt })).data;
check('dar de baja guarda la fecha y suma una baja', n.reportes.alumnos.bajas === 1);
check('el dado de baja ya no figura como deudor', !n.deudores.some(c => c.id === lejano.id));
check('pagos de otra cuenta no se mezclan', (await call('/negocio', { token: otro })).data.caja.cobrado === 0);

const exp = (await call('/exportar', { token: pt })).data;
check('el Excel incluye los pagos', Array.isArray(exp.pagos) && exp.pagos.length === 2);
check('y la cuota de cada alumno', exp.clientes.some(c => c.nombre === 'Lucía Pago' && c.cuota === 32000));

console.log('\n== APP INSTALABLE ==');
const crudo = async p => { const r = await fetch(RAIZ + p); return { status: r.status, headers: r.headers, texto: await r.text() }; };
let m = await crudo('/manifest.webmanifest');
check('manifiesto general', m.status === 200 && /manifest\+json/.test(m.headers.get('content-type')));
const mj = JSON.parse(m.texto);
check('arranca en la app del entrenador', mj.start_url === '/' && mj.display === 'standalone');
check('con íconos de 192 y 512', mj.icons.some(i => i.sizes === '192x192') && mj.icons.some(i => i.sizes === '512x512'));
for (const i of mj.icons) {
  const r = await crudo(i.src);
  check('ícono ' + i.src + ' existe', r.status === 200 && r.headers.get('content-type') === 'image/png');
}

const tokA = (await call('/clientes/' + al.id, { token: pt })).data.token;
const ma = JSON.parse((await crudo('/r/' + tokA + '/manifest.webmanifest')).texto);
check('el manifiesto del alumno arranca en su rutina', ma.start_url === '/r/' + tokA && ma.id === '/r/' + tokA);
check('sin marca se llama "Mi rutina"', ma.name === 'Mi rutina');
await call('/marca', { method: 'PUT', token: pt, body: { nombre: 'Lu Fit', color: '#2255AA' } });
const mm = JSON.parse((await crudo('/r/' + tokA + '/manifest.webmanifest')).texto);
check('con marca lleva el nombre del profe', mm.name === 'Lu Fit');
check('y su color', mm.theme_color === '#2255AA');
const mx = JSON.parse((await crudo('/r/zzz%22%3E/manifest.webmanifest')).texto);
check('un código raro da el manifiesto general', mx.start_url === '/');

const pag = await crudo('/r/' + tokA);
check('la página del alumno apunta a su manifiesto', pag.texto.includes('href="/r/' + tokA + '/manifest.webmanifest"'));
const pagPt = await crudo('/');
check('la del entrenador al general', pagPt.texto.includes('href="/manifest.webmanifest"'));

const sw = await crudo('/sw.js');
check('el service worker se sirve', sw.status === 200 && /javascript/.test(sw.headers.get('content-type')));
check('sin caché, para que las actualizaciones lleguen', sw.headers.get('cache-control') === 'no-cache');
check('con permiso para guardar React y las fuentes', /connect-src[^;]*unpkg\.com/.test(sw.headers.get('content-security-policy')));
check('no guarda datos del entrenador', !/\/api\/clientes|\/api\/hoy|\/api\/negocio/.test(sw.texto));
check('la página general sigue sin permitir otros destinos', /connect-src 'self'(;|$)/.test(pagPt.headers.get('content-security-policy')));

console.log(`\n===== ${ok} pruebas OK, ${fail} fallas =====`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
