import { Redis } from '@upstash/redis';
import webpush from 'web-push';

const redis = Redis.fromEnv();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:aditifunctionalyoga@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { title, body } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Falta el título' });

  const subs = (await redis.get('pushSubscriptions')) || [];
  const payload = JSON.stringify({ title: `Áditi: ${title}`, body: body || '', url: '/' });

  const stillValid = [];
  let sent = 0;

  await Promise.all(subs.map(async (entry) => {
    try {
      await webpush.sendNotification(entry.subscription, payload);
      stillValid.push(entry);
      sent++;
    } catch (e) {
      // 404/410 = la suscripción ya no existe (el navegador la revocó); la descartamos.
      if (e.statusCode !== 404 && e.statusCode !== 410) {
        stillValid.push(entry);
      }
    }
  }));

  if (stillValid.length !== subs.length) {
    await redis.set('pushSubscriptions', stillValid);
  }

  return res.status(200).json({ ok: true, sent, total: subs.length });
}
