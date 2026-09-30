import { Redis } from '@upstash/redis';
import { syncStudentContact, notifyBonoConfirmado, notifySueltaConfirmada, broadcastWallPost, broadcastPoll, broadcastHoliday, notifyWaitlistSpotOpen, broadcastEvent } from './_brevo.js';
import { notifyStudentPush, notifyAllPush } from './_push.js';

const redis = Redis.fromEnv();

// Solo se permite leer/escribir estas claves compartidas.
// Evita que alguien use el endpoint para escribir cualquier cosa en tu Redis.
const ALLOWED_KEYS = ['students', 'bookings', 'purchases', 'wallPosts', 'schedule', 'bonos', 'settings', 'polls', 'holidays', 'events', 'scheduledPosts', 'classCancellations', 'punctualClasses'];

// 'students' contiene datos personales de todas las alumnas: ni lectura ni
// escritura completas sin ser admin (las alumnas usan api/student-profile.js
// para su propia ficha, así nunca reciben el listado completo). Los
// borradores de 'scheduledPosts' tampoco se muestran a nadie hasta que se
// publican de verdad (pasan a 'wallPosts').
const ADMIN_ONLY_READ_KEYS = ['students', 'scheduledPosts'];

// 'wallPosts' (el Muro), 'schedule' (horarios), 'bonos', 'settings',
// 'holidays' (días festivos), 'events' (eventos especiales, solo la ficha
// del evento en sí: apuntarse a uno crea una reserva normal en 'bookings') y
// 'classCancellations' (cancelaciones puntuales de una clase concreta, un
// solo día, sin tocar el horario semanal) y 'punctualClasses' (clases
// sueltas añadidas para un único día, sin duplicarse el resto de semanas)
// los lee cualquier alumna, pero solo Beatriz los edita.
const ADMIN_ONLY_WRITE_KEYS = ['students', 'wallPosts', 'schedule', 'bonos', 'settings', 'holidays', 'events', 'scheduledPosts', 'classCancellations', 'punctualClasses'];

// Para 'bookings' y 'purchases', las alumnas sí necesitan poder crear su propia
// reserva/compra sin ser admin. Sin token, solo se permite un cambio mínimo y
// concreto por petición (ver isChangeAllowedWithoutAdmin) para que nadie pueda
// borrar/reescribir la colección entera ni marcarse un pago como confirmado.
function isAdminRequest(req) {
  const token = req.headers['x-admin-token'];
  return !!token && !!process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Compara el valor guardado con el propuesto y determina si es: sin cambios,
// un único elemento añadido al final, o la modificación de un único elemento
// existente. Cualquier otra diferencia (borrados, reordenaciones, varios
// cambios a la vez) se considera no permitida sin token de admin.
function diffSingleChange(current, next) {
  const cur = Array.isArray(current) ? current : [];
  if (!Array.isArray(next)) return null;

  if (next.length === cur.length) {
    const diffIndexes = [];
    for (let i = 0; i < cur.length; i++) {
      if (!sameJson(cur[i], next[i])) diffIndexes.push(i);
    }
    if (diffIndexes.length === 0) return { type: 'noop' };
    if (diffIndexes.length === 1) {
      const i = diffIndexes[0];
      return { type: 'modify', before: cur[i], after: next[i] };
    }
    return null;
  }

  if (next.length === cur.length + 1) {
    for (let i = 0; i < cur.length; i++) {
      if (!sameJson(cur[i], next[i])) return null;
    }
    return { type: 'append', item: next[next.length - 1] };
  }

  return null;
}

const CLASS_CAPACITY = 8;
const DAY_INDEX_SERVER = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };

function eventFor(events, item) {
  return (events || []).find(e => e.date === item.date && e.time === item.time && e.name === item.className);
}

// Clase suelta añadida por Beatriz para un único día concreto (no duplicada
// en el horario semanal del resto de semanas).
function punctualClassFor(punctualClasses, item) {
  return (punctualClasses || []).find(p => p.date === item.date && p.time === item.time && p.name === item.className);
}

function classCapacityFor(schedule, item, events, punctualClasses) {
  const ev = eventFor(events, item);
  if (ev) return ev.capacity || CLASS_CAPACITY;
  const pc = punctualClassFor(punctualClasses, item);
  if (pc) return pc.capacity || CLASS_CAPACITY;
  if (!schedule || !item?.date) return CLASS_CAPACITY;
  const dow = new Date(`${item.date}T12:00:00`).getDay();
  const slots = schedule[DAY_INDEX_SERVER[dow]] || [];
  const slot = slots.find(s => s.time === item.time && s.name === item.className);
  return (slot && slot.capacity) || CLASS_CAPACITY;
}

// El servidor de Vercel corre en UTC, así que comparar Date directamente
// desplazaría la hora respecto a España. En vez de eso, comparamos como
// cadenas 'YYYY-MM-DDTHH:mm' en la hora local de Madrid (incluye el cambio
// de horario de verano/invierno automáticamente).
function madridNowString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function isPastSlot(item) {
  return `${item.date}T${item.time}` < madridNowString();
}

// Las clases del horario semanal solo se pueden reservar con un máximo de
// 7 días de antelación (si hoy es miércoles, como muy tarde el miércoles
// siguiente). Los eventos especiales quedan fuera de esta ventana: Beatriz
// los crea a propósito para que se puedan reservar con más adelanto.
const BOOKING_WINDOW_DAYS = 7;
function isTooFarAhead(item) {
  const todayStr = madridNowString().slice(0, 10);
  const d = new Date(`${todayStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + BOOKING_WINDOW_DAYS);
  const maxDateStr = d.toISOString().slice(0, 10);
  return item.date > maxDateStr;
}

function isBookingChangeAllowed(diff, current, schedule, holidays, events, classCancellations, punctualClasses) {
  if (!diff) return false;
  if (diff.type === 'noop') return true;

  if (diff.type === 'modify') {
    // Sin token, una alumna solo puede cancelar SU PROPIA reserva: el único
    // campo que puede cambiar es 'status', y solo hacia 'cancelada'. Nunca
    // puede reactivarla, cambiar la fecha/hora, ni tocar la de otra persona.
    const { before, after } = diff;
    if (after.status !== 'cancelada' || before.status === 'cancelada') return false;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      if (k === 'status') continue;
      if (!sameJson(before[k], after[k])) return false;
    }
    return true;
  }

  if (diff.type !== 'append') return false; // ninguna otra modificación permitida sin token
  const item = diff.item || {};
  // Solo altas nuevas: pendiente de pago (bizum/tarjeta), confirmada por bono
  // propio, o apuntarse una misma a la lista de espera de una clase completa.
  const validNew = item.status === 'pendiente_pago' || (item.status === 'confirmada' && item.paymentMethod === 'bono') || item.status === 'en_espera';
  if (!validNew) return false;

  // Día marcado como festivo por Beatriz: no se admiten reservas nuevas,
  // salvo que sea precisamente un evento especial programado ese mismo día
  // (Beatriz lo ha creado a propósito para esa fecha).
  const ev = eventFor(events, item);
  if (!ev && (holidays || []).some(h => h.date === item.date)) return false;

  // Beatriz ha cancelado puntualmente esta clase concreta ese día (el
  // horario semanal sigue igual el resto de semanas).
  if ((classCancellations || []).some(c => c.date === item.date && c.time === item.time && c.className === item.className)) return false;

  // No se puede reservar (ni apuntarse a la lista de espera de) una clase
  // cuya fecha/hora ya ha pasado.
  if (isPastSlot(item)) return false;

  // Ventana de reserva: como mucho con BOOKING_WINDOW_DAYS días de
  // antelación (salvo eventos especiales, pensados para abrirse con más adelanto).
  if (!ev && isTooFarAhead(item)) return false;

  const cur = Array.isArray(current) ? current : [];

  // 'en_espera' (lista de espera) no ocupa plaza real.
  const occupied = cur
    .filter(b => b.date === item.date && b.time === item.time && b.className === item.className && b.status !== 'cancelada' && b.status !== 'en_espera')
    .length;
  const capacity = classCapacityFor(schedule, item, events, punctualClasses);

  if (item.status === 'en_espera') {
    // Solo tiene sentido apuntarse a la lista de espera si la clase está
    // completa, y no se puede duplicar la propia entrada.
    const alreadyThere = cur.some(b => b.studentId === item.studentId && b.date === item.date && b.time === item.time && b.className === item.className && b.status !== 'cancelada');
    if (alreadyThere) return false;
    return occupied >= capacity;
  }

  return occupied < capacity;
}

function isPollChangeAllowed(diff) {
  if (!diff) return false;
  if (diff.type === 'noop') return true;
  if (diff.type !== 'modify') return false; // crear/cerrar/borrar encuestas: solo Beatriz

  // Sin token, una alumna solo puede añadir SU voto a una encuesta ya
  // existente: ningún otro campo puede cambiar, no se pueden tocar votos
  // ya registrados, y no puede haber votado ya esa misma encuesta.
  const { before, after } = diff;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'votes') continue;
    if (!sameJson(before[k], after[k])) return false;
  }
  const beforeVotes = Array.isArray(before.votes) ? before.votes : [];
  const afterVotes = Array.isArray(after.votes) ? after.votes : [];
  if (afterVotes.length !== beforeVotes.length + 1) return false;
  for (let i = 0; i < beforeVotes.length; i++) {
    if (!sameJson(beforeVotes[i], afterVotes[i])) return false;
  }
  const newVote = afterVotes[afterVotes.length - 1];
  if (!newVote?.studentId || !newVote?.optionId) return false;
  if (beforeVotes.some(v => v.studentId === newVote.studentId)) return false; // ya había votado
  if (before.active === false) return false; // encuesta cerrada
  return (before.options || []).some(o => o.id === newVote.optionId);
}

function isPurchaseChangeAllowed(diff) {
  if (!diff) return false;
  if (diff.type === 'noop') return true;
  if (diff.type === 'append') {
    // Solo se puede crear una compra nueva en estado pendiente (aún sin pagar).
    return diff.item?.status === 'pendiente';
  }
  if (diff.type === 'modify') {
    const { before, after } = diff;
    // Solo se permite descontar/ajustar classesUsed de un bono ya confirmado;
    // ningún otro campo (status, price, expiryDate...) puede cambiar por esta vía.
    if (before.status !== 'confirmado' || after.status !== 'confirmado') return false;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      if (k === 'classesUsed') continue;
      if (!sameJson(before[k], after[k])) return false;
    }
    return true;
  }
  return false;
}

// Al cancelarse una reserva, si esa clase tiene lista de espera y ya hay
// hueco real, avisa (email + push) a la alumna que lleva más tiempo
// esperando, para que sea ella quien decida entrar a reservarlo. No la
// apunta automáticamente. Marca la entrada con notifiedAt para no
// repetirle el aviso si se libera y se vuelve a ocupar varias veces.
async function notifyNextWaitlisted(cancelledBooking, allBookings) {
  const { date, time, className } = cancelledBooking;
  const cur = Array.isArray(allBookings) ? allBookings : [];
  const occupied = cur.filter(b => b.date === date && b.time === time && b.className === className && b.status !== 'cancelada' && b.status !== 'en_espera').length;
  const schedule = await redis.get('schedule');
  const capacity = classCapacityFor(schedule, cancelledBooking);
  if (occupied >= capacity) return; // no hay hueco real (p.ej. ya lo cogió otra persona)

  const waitlist = cur
    .filter(b => b.date === date && b.time === time && b.className === className && b.status === 'en_espera' && !b.notifiedAt)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const next = waitlist[0];
  if (!next) return;

  const students = (await redis.get('students')) || [];
  const student = students.find(s => s.id === next.studentId);
  if (student) await notifyWaitlistSpotOpen(student, next);
  await notifyStudentPush(next.studentId, 'Se ha liberado una plaza', `${next.className} · ${new Date(`${next.date}T12:00:00`).toLocaleDateString('es-ES')} a las ${next.time}`);

  const updated = cur.map(b => b.id === next.id ? { ...b, notifiedAt: new Date().toISOString() } : b);
  await redis.set('bookings', updated);
}

// Dispara las integraciones de Brevo según qué colección cambió. No hace
// nada si BREVO_API_KEY no está configurada (ver api/_brevo.js).
async function runBrevoSideEffects(key, value, diff, appBaseUrl) {
  if (key === 'students') {
    const purchases = (await redis.get('purchases')) || [];
    await Promise.allSettled((value || []).map(s => syncStudentContact(s, purchases)));
    return;
  }
  if (key === 'purchases' && diff?.type === 'modify' && diff.before.status === 'pendiente' && diff.after.status === 'confirmado') {
    const students = (await redis.get('students')) || [];
    const student = students.find(s => s.id === diff.after.studentId);
    await notifyBonoConfirmado(student, diff.after);
    return;
  }
  if (key === 'purchases' && diff?.type === 'append' && diff.item.status === 'confirmado') {
    // Alta manual de un bono ya pagado (ej. en efectivo) hecha por Beatriz.
    const students = (await redis.get('students')) || [];
    const student = students.find(s => s.id === diff.item.studentId);
    await notifyBonoConfirmado(student, diff.item);
    return;
  }
  if (key === 'purchases' && diff?.type === 'modify' && diff.before.status !== diff.after.status) {
    // Cualquier otro cambio de estado (ej. cancelar un bono confirmado) resincroniza
    // la lista de Brevo de la alumna, sin mandar el email de "bono confirmado".
    const students = (await redis.get('students')) || [];
    const student = students.find(s => s.id === diff.after.studentId);
    if (student) await syncStudentContact(student, value);
    return;
  }
  if (key === 'bookings' && diff?.type === 'modify' && diff.before.status === 'pendiente_pago' && diff.after.status === 'confirmada') {
    const students = (await redis.get('students')) || [];
    const student = students.find(s => s.id === diff.after.studentId);
    await notifySueltaConfirmada(student, diff.after);
    return;
  }
  if (key === 'bookings' && diff?.type === 'append' && diff.item.status === 'confirmada' && (diff.item.paymentMethod === 'efectivo' || diff.item.paymentMethod === 'transferencia')) {
    // Alta manual de una clase ya pagada en efectivo o transferencia, hecha por Beatriz.
    const students = (await redis.get('students')) || [];
    const student = students.find(s => s.id === diff.item.studentId);
    await notifySueltaConfirmada(student, diff.item);
    return;
  }
  if (key === 'bookings' && diff?.type === 'modify' && diff.before.status !== 'cancelada' && diff.after.status === 'cancelada') {
    // Alguien ha cancelado (alumna o Beatriz): si esa clase tiene lista de
    // espera, avisamos a la siguiente por si quiere quedarse con la plaza.
    await notifyNextWaitlisted(diff.after, value);
    return;
  }
  if (key === 'wallPosts' && diff?.type === 'append') {
    const students = (await redis.get('students')) || [];
    await broadcastWallPost(students, diff.item.title, diff.item.content, diff.item.imageUrl);
    return;
  }
  if (key === 'polls' && diff?.type === 'append') {
    const students = (await redis.get('students')) || [];
    await broadcastPoll(students, diff.item, appBaseUrl);
    return;
  }
  if (key === 'holidays' && diff?.type === 'append') {
    const students = (await redis.get('students')) || [];
    await broadcastHoliday(students, diff.item);
    return;
  }
  if (key === 'events' && diff?.type === 'append') {
    const students = (await redis.get('students')) || [];
    await broadcastEvent(students, diff.item);
    return;
  }
}

// No hay ningún proceso en segundo plano corriendo solo: esto se llama cada
// vez que alguien (cualquier alumna o Beatriz) pide el Muro, que ocurre cada
// pocos segundos mientras la app está abierta en algún sitio. Si toca
// publicar algo programado, lo pasa a 'wallPosts' y avisa exactamente igual
// que una publicación manual. Un bloqueo corto evita que dos peticiones
// que lleguen a la vez lo dupliquen.
async function publishDueScheduledPosts() {
  try {
    const scheduled = (await redis.get('scheduledPosts')) || [];
    const now = new Date();
    if (!scheduled.some(p => new Date(p.publishAt) <= now)) return;

    const gotLock = await redis.set('scheduledPostsLock', '1', { nx: true, ex: 10 });
    if (!gotLock) return; // otra petición concurrente ya se está encargando

    const fresh = (await redis.get('scheduledPosts')) || [];
    const due = fresh.filter(p => new Date(p.publishAt) <= now);
    if (due.length === 0) return;
    const remaining = fresh.filter(p => new Date(p.publishAt) > now);

    const wallPosts = (await redis.get('wallPosts')) || [];
    const newPosts = due.map(p => ({ id: p.id, title: p.title, content: p.content, imageUrl: p.imageUrl, date: p.publishAt }));
    await redis.set('wallPosts', [...wallPosts, ...newPosts]);
    await redis.set('scheduledPosts', remaining);

    const students = (await redis.get('students')) || [];
    for (const p of newPosts) {
      await broadcastWallPost(students, p.title, p.content, p.imageUrl);
      await notifyAllPush(p.title, p.content);
    }
  } catch (e) {
    console.error('Publicaciones programadas: error publicando', e);
  }
}

export default async function handler(req, res) {
  const key = req.query.key;

  if (!ALLOWED_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Clave no permitida' });
  }

  const admin = isAdminRequest(req);

  if (req.method === 'GET') {
    if (ADMIN_ONLY_READ_KEYS.includes(key) && !admin) {
      return res.status(401).json({ error: 'Requiere acceso de administración' });
    }
    try {
      if (key === 'wallPosts') await publishDueScheduledPosts();
      const value = await redis.get(key);
      return res.status(200).json({ value: value ?? null });
    } catch (e) {
      return res.status(500).json({ error: 'Error leyendo de Redis' });
    }
  }

  if (req.method === 'POST') {
    if (ADMIN_ONLY_WRITE_KEYS.includes(key) && !admin) {
      return res.status(401).json({ error: 'Requiere acceso de administración' });
    }
    try {
      const { value } = req.body || {};
      const needsDiff = key === 'bookings' || key === 'purchases' || key === 'wallPosts' || key === 'polls' || key === 'holidays' || key === 'events';
      const current = needsDiff ? await redis.get(key) : undefined;
      const diff = needsDiff ? diffSingleChange(current, value) : null;

      if (!admin && (key === 'bookings' || key === 'purchases' || key === 'polls')) {
        let allowed;
        if (key === 'bookings') {
          const schedule = await redis.get('schedule');
          const holidays = await redis.get('holidays');
          const events = await redis.get('events');
          const classCancellations = await redis.get('classCancellations');
          const punctualClasses = await redis.get('punctualClasses');
          allowed = isBookingChangeAllowed(diff, current, schedule, holidays, events, classCancellations, punctualClasses);
        } else if (key === 'purchases') {
          allowed = isPurchaseChangeAllowed(diff);
        } else {
          allowed = isPollChangeAllowed(diff);
        }
        if (!allowed) {
          return res.status(403).json({ error: 'Cambio no permitido' });
        }
      }

      await redis.set(key, value);

      // Efectos secundarios de Brevo (sincronizar contactos / avisos por email).
      // Se esperan (Vercel puede cortar el proceso justo después de responder),
      // pero un fallo aquí no hace fallar la escritura ya confirmada.
      try {
        const appBaseUrl = process.env.APP_BASE_URL || `https://${req.headers.host}`;
        await runBrevoSideEffects(key, value, diff, appBaseUrl);
      } catch (e) {
        console.error('Brevo: error en efectos secundarios', e);
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Error escribiendo en Redis' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Método no permitido');
}
