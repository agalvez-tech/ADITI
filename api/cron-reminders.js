import { Redis } from '@upstash/redis';
import { notifyStudentPush } from './_push.js';

const redis = Redis.fromEnv();

function madridParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

// Avisa por notificación a cada alumna que hoy tiene clase confirmada. Solo
// se envía una vez al día (el cierre evita repeticiones si se llama dos veces).
export async function sendTodayReminders(notify = notifyStudentPush) {
  const { date, hour } = madridParts();
  if (hour < 5) return { skipped: 'demasiado pronto' };
  if (!(await redis.set(`classRemindersSent:${date}`, '1', { nx: true, ex: 172800 }))) return { skipped: 'ya enviados hoy' };

  try {
    const bookings = (await redis.get('bookings')) || [];
    const cancellations = (await redis.get('classCancellations')) || [];
    const byStudent = {};
    bookings
      .filter(b => b.date === date && b.status === 'confirmada')
      .filter(b => !cancellations.some(c => c.date === b.date && c.time === b.time && c.className === b.className))
      .forEach(b => { (byStudent[b.studentId] = byStudent[b.studentId] || []).push(b); });

    const ids = Object.keys(byStudent);
    for (const studentId of ids) {
      const classes = byStudent[studentId].sort((a, b) => a.time.localeCompare(b.time));
      const body = classes.map(c => `${c.className} a las ${c.time}`).join(' · ');
      await notify(studentId, classes.length === 1 ? 'Hoy tienes clase' : 'Hoy tienes clases', body);
    }
    return { sent: ids.length };
  } catch (e) {
    await redis.del(`classRemindersSent:${date}`); // que se pueda reintentar
    throw e;
  }
}

export default async function handler(req, res) {
  // Si CRON_SECRET está definida en Vercel, solo Vercel (que la envía) puede llamarlo.
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    return res.status(200).json(await sendTodayReminders());
  } catch (e) {
    console.error('Recordatorios de clase: error', e);
    return res.status(500).json({ error: 'No se pudieron enviar los recordatorios' });
  }
}
