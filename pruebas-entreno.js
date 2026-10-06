// Pruebas de la prescripción (descanso, intensidad, tempo, superseries) y del modo entrenando.
// Uso (con el servidor levantado como indica pruebas.js):
//   TURSO_URL="file:test.db" node pruebas-entreno.js
// Toca la base directo solo para pasar la cuenta al plan completo.

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
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
const s = Date.now().toString(36);
const reg = async n => (await call('/registro', { method: 'POST', ip: '10.8.' + n + '.1',
  body: { email: `ent${n}${s}@x.com`, password: 'clave12345', nombre: 'Profe Entreno ' + n } })).data.token;
const pt = await reg(1), otro = await reg(2);
check('se crean las cuentas de prueba', !!pt && !!otro);
await db.execute({ sql: "UPDATE cuentas SET plan = 'activo' WHERE email IN (?, ?)", args: [`ent1${s}@x.com`, `ent2${s}@x.com`] });
await call('/ejemplos', { method: 'DELETE', token: pt });

const sent = (await call('/ejercicios', { method: 'POST', token: pt, body: { nombre: 'Sentadilla ' + s } })).data;
const remo = (await call('/ejercicios', { method: 'POST', token: pt, body: { nombre: 'Remo ' + s } })).data;
const al = (await call('/clientes', { method: 'POST', token: pt, body: { nombre: 'Ana Entrena' } })).data;
const rut = (await call('/clientes/' + al.id + '/rutinas', { method: 'POST', token: pt,
  body: { nombre: 'Mes 1', dias: [{ nombre: 'Piernas' }] } })).data;
const dia = rut.dias[0];

console.log('\n== PRESCRIPCION: VALIDACIONES ==');
const item = body => call('/dias/' + dia.id + '/items', { method: 'POST', token: pt,
  body: Object.assign({ ejercicio_id: sent.id, series: '4', reps: '8' }, body) });
check('descanso de más de 15 minutos se rechaza', (await item({ descanso: 1000 })).status === 400);
check('descanso con decimales se rechaza', (await item({ descanso: 12.5 })).status === 400);
check('descanso negativo se rechaza', (await item({ descanso: -5 })).status === 400);
check('superserie con otra letra se rechaza', (await item({ bloque: 'Z' })).status === 400);
check('intensidad muy larga se rechaza', (await item({ intensidad: 'x'.repeat(30) })).status === 400);
check('tempo muy largo se rechaza', (await item({ tempo: '1-2-3-4-5-6-7-8-9' })).status === 400);
check('ningún rechazo dejó ejercicios a medias', (await call('/rutinas/' + rut.id, { token: pt })).data.dias[0].items.length === 0);

console.log('\n== PRESCRIPCION: GUARDAR Y EDITAR ==');
const i1 = (await item({ descanso: 90, intensidad: ' RPE 8 ', tempo: '3-1-1-0', bloque: 'a' })).data;
const i2 = (await call('/dias/' + dia.id + '/items', { method: 'POST', token: pt,
  body: { ejercicio_id: remo.id, series: '4', reps: '10', bloque: 'A' } })).data;
const i3 = (await call('/dias/' + dia.id + '/items', { method: 'POST', token: pt,
  body: { ejercicio_id: remo.id, series: '3', reps: '12' } })).data;
check('se agregan los ejercicios', !!i1.id && !!i2.id && !!i3.id);
let r = (await call('/rutinas/' + rut.id, { token: pt })).data;
let it1 = r.dias[0].items.find(x => x.id === i1.id);
check('guarda el descanso en segundos', it1.descanso === 90);
check('guarda la intensidad sin espacios de más', it1.intensidad === 'RPE 8');
check('guarda el tempo', it1.tempo === '3-1-1-0');
check('la superserie se guarda en mayúscula', it1.bloque === 'A');
check('el que va solo queda sin bloque', r.dias[0].items.find(x => x.id === i3.id).bloque === null);

await call('/items/' + i1.id, { method: 'PATCH', token: pt, body: { series: '5', reps: '6' } });
it1 = (await call('/rutinas/' + rut.id, { token: pt })).data.dias[0].items.find(x => x.id === i1.id);
check('editar sin mandar la prescripción la conserva',
  it1.series === '5' && it1.descanso === 90 && it1.intensidad === 'RPE 8' && it1.bloque === 'A');
await call('/items/' + i1.id, { method: 'PATCH', token: pt, body: { series: '5', reps: '6', descanso: '', tempo: '' } });
it1 = (await call('/rutinas/' + rut.id, { token: pt })).data.dias[0].items.find(x => x.id === i1.id);
check('vaciar un campo lo borra y deja los otros', it1.descanso === null && it1.tempo === null && it1.intensidad === 'RPE 8');
check('editar con un valor inválido se rechaza',
  (await call('/items/' + i1.id, { method: 'PATCH', token: pt, body: { series: '5', reps: '6', bloque: '1' } })).status === 400);
await call('/items/' + i1.id, { method: 'PATCH', token: pt, body: { series: '5', reps: '6', descanso: 120 } });
check('otra cuenta no puede editarlo',
  (await call('/items/' + i1.id, { method: 'PATCH', token: otro, body: { series: '1', reps: '1', descanso: 5 } })).status === 404);

console.log('\n== PRESCRIPCION: SE COPIA ==');
const dup = (await call('/rutinas/' + rut.id + '/duplicar', { method: 'POST', token: pt, body: { cliente_id: al.id } })).data;
const dIt = dup.dias[0].items.find(x => x.ejercicio_id === sent.id);
check('al duplicar la rutina', dIt.descanso === 120 && dIt.intensidad === 'RPE 8' && dIt.bloque === 'A');
const pl = (await call('/rutinas/' + rut.id + '/plantilla', { method: 'POST', token: pt, body: { nombre: 'Base ' + s } })).data;
const pIt = pl.dias[0].items.find(x => x.ejercicio_id === sent.id);
check('al guardarla como plantilla', pIt.descanso === 120 && pIt.bloque === 'A');
const usada = (await call('/plantillas/' + pl.id + '/usar', { method: 'POST', token: pt, body: { cliente_id: al.id } })).data;
const uIt = usada.dias[0].items.find(x => x.ejercicio_id === sent.id);
check('y al usar la plantilla', uIt.descanso === 120 && uIt.intensidad === 'RPE 8' && uIt.bloque === 'A');

const pd = pl.dias[0].id;
check('plantilla: valor inválido se rechaza', (await call('/plantilla-dias/' + pd + '/items', { method: 'POST', token: pt,
  body: { ejercicio_id: remo.id, series: '3', reps: '10', descanso: 'mucho' } })).status === 400);
const pi = (await call('/plantilla-dias/' + pd + '/items', { method: 'POST', token: pt,
  body: { ejercicio_id: remo.id, series: '3', reps: '10', descanso: 60, tempo: '2-0-2-0' } })).data;
await call('/plantilla-items/' + pi.id, { method: 'PATCH', token: pt, body: { series: '4', reps: '10' } });
const pi2 = (await call('/plantillas/' + pl.id, { token: pt })).data.dias[0].items.find(x => x.id === pi.id);
check('plantilla: editar conserva la prescripción', pi2.series === '4' && pi2.descanso === 60 && pi2.tempo === '2-0-2-0');

const exp = (await call('/exportar', { token: pt })).data;
check('el Excel lleva la prescripción', exp.rutinas.some(x => x.descanso_seg === 120 && x.superserie === 'A'));

console.log('\n== MODO ENTRENANDO ==');
// El alumno ve la última rutina (la que salió de la plantilla).
const tok = (await call('/clientes/' + al.id, { token: pt })).data.token;
let va = (await call('/alumno/' + tok)).data;
const diaA = va.rutina.dias[0];
check('el alumno recibe la prescripción', diaA.items.some(x => x.descanso === 120 && x.intensidad === 'RPE 8'));
check('y arranca sin entrenamientos cerrados', Array.isArray(va.sesiones) && va.sesiones.length === 0);

const ses = body => call('/alumno/' + tok + '/sesion', { method: 'POST', body });
check('sin día se rechaza', (await ses({ esfuerzo: 7 })).status === 400);
check('esfuerzo 11 se rechaza', (await ses({ dia_id: diaA.id, esfuerzo: 11 })).status === 400);
check('esfuerzo 0 se rechaza', (await ses({ dia_id: diaA.id, esfuerzo: 0 })).status === 400);
check('esfuerzo con decimales se rechaza', (await ses({ dia_id: diaA.id, esfuerzo: 7.5 })).status === 400);
check('comentario muy largo se rechaza', (await ses({ dia_id: diaA.id, esfuerzo: 7, nota: 'x'.repeat(600) })).status === 400);
check('un día de otra rutina vieja del mismo alumno sí vale', (await ses({ dia_id: dia.id, esfuerzo: 5 })).status === 200);

// Un día que no es de este alumno.
const ajeno = (await call('/clientes', { method: 'POST', token: pt, body: { nombre: 'Otro Alumno' } })).data;
const rutAjena = (await call('/clientes/' + ajeno.id + '/rutinas', { method: 'POST', token: pt,
  body: { nombre: 'Ajena', dias: [{ nombre: 'Día 1' }] } })).data;
check('un día de otro alumno no se puede cerrar', (await ses({ dia_id: rutAjena.dias[0].id, esfuerzo: 7 })).status === 404);
check('un día inventado da 404', (await ses({ dia_id: 'nada', esfuerzo: 7 })).status === 404);

let rs = await ses({ dia_id: diaA.id, esfuerzo: 7, nota: 'Me costó la última serie', duracion: 47.4 });
check('cerrar el entrenamiento', rs.status === 200 && rs.data.sesiones.some(x => x.dia_id === diaA.id));
const s1 = rs.data.sesiones.find(x => x.dia_id === diaA.id);
check('guarda esfuerzo, comentario y minutos', s1.esfuerzo === 7 && s1.nota === 'Me costó la última serie' && s1.duracion === 47);
rs = await ses({ dia_id: diaA.id, esfuerzo: 9, duracion: 'mucho' });
const delDia = rs.data.sesiones.filter(x => x.dia_id === diaA.id);
check('cerrar de nuevo el mismo día corrige, no duplica', delDia.length === 1 && delDia[0].esfuerzo === 9);
check('una duración rara no se guarda', delDia[0].duracion === null);
check('sin esfuerzo también se puede cerrar', (await ses({ dia_id: diaA.id })).status === 200);
await ses({ dia_id: diaA.id, esfuerzo: 9, nota: 'Me costó', duracion: 50 });
check('el alumno lo ve en su semana', (await call('/alumno/' + tok)).data.sesiones.some(x => x.dia_id === diaA.id && x.esfuerzo === 9));

console.log('\n== LO VE EL ENTRENADOR ==');
const ficha = (await call('/clientes/' + al.id, { token: pt })).data;
const fs1 = ficha.sesiones.find(x => x.dia_id === diaA.id);
check('en la ficha, con el nombre del día', !!fs1 && fs1.dia === 'Piernas' && fs1.esfuerzo === 9 && fs1.duracion === 50);
const hoy = (await call('/hoy', { token: pt })).data;
check('en Hoy', hoy.sesiones.some(x => x.cliente_id === al.id && x.esfuerzo === 9 && x.alumno === 'Ana Entrena'));
check('otra cuenta no lo ve', (await call('/hoy', { token: otro })).data.sesiones.length === 0);
check('ni la ficha', (await call('/clientes/' + al.id, { token: otro })).status === 404);
check('el Excel lleva los entrenamientos', (await call('/exportar', { token: pt })).data.sesiones.some(x => x.esfuerzo === 9 && x.dia === 'Piernas'));
check('un link inválido no cierra nada', (await call('/alumno/ffffffffffffffff/sesion', { method: 'POST',
  body: { dia_id: diaA.id, esfuerzo: 3 } })).status === 404);

console.log(`\n===== ${ok} pruebas OK, ${fail} fallas =====`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
