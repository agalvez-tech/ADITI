import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { subscription, studentId } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Falta la suscripción' });

  const subs = (await redis.get('pushSubscriptions')) || [];
  const withoutDup = subs.filter(s => s.subscription.endpoint !== subscription.endpoint);
  withoutDup.push({ subscription, studentId: studentId || null, createdAt: new Date().toISOString() });
  await redis.set('pushSubscriptions', withoutDup);

  return res.status(200).json({ ok: true });
}
