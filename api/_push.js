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
