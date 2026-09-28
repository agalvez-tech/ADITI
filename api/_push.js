import { Redis } from '@upstash/redis';
import webpush from 'web-push';

const redis = Redis.fromEnv();

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:aditifunctionalyoga@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
}

// A diferencia de /api/notify-wall (que avisa a todo el mundo), esto manda la
// notificación solo a las suscripciones guardadas de UNA alumna concreta.
export async function notifyStudentPush(studentId, title, body) {
  if (!studentId || !process.env.VAPID_PUBLIC_KEY) return;
  ensureConfigured();
  try {
    const subs = (await redis.get('pushSubscriptions')) || [];
    const mine = subs.filter(s => s.studentId === studentId);
    if (mine.length === 0) return;
    const payload = JSON.stringify({ title: `Áditi: ${title}`, body: body || '', url: '/' });
    await Promise.allSettled(mine.map(entry => webpush.sendNotification(entry.subscription, payload)));
  } catch (e) {
    console.error('Push: error avisando a alumna', e);
  }
}

// Avisa a TODAS las suscripciones guardadas (equivalente a lo que hace
// /api/notify-wall). Se usa desde el propio servidor para publicaciones
// programadas, que no pasan por ese endpoint porque nadie hace la petición.
export async function notifyAllPush(title, body) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  ensureConfigured();
  try {
    const subs = (await redis.get('pushSubscriptions')) || [];
    const payload = JSON.stringify({ title: `Áditi: ${title}`, body: body || '', url: '/' });
    const stillValid = [];
    await Promise.all(subs.map(async (entry) => {
      try {
        await webpush.sendNotification(entry.subscription, payload);
        stillValid.push(entry);
      } catch (e) {
        if (e.statusCode !== 404 && e.statusCode !== 410) stillValid.push(entry);
      }
    }));
    if (stillValid.length !== subs.length) await redis.set('pushSubscriptions', stillValid);
  } catch (e) {
    console.error('Push: error en aviso general', e);
  }
}
