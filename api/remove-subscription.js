import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Falta el endpoint' });

  const subs = (await redis.get('pushSubscriptions')) || [];
  const next = subs.filter(s => s.subscription.endpoint !== endpoint);
  await redis.set('pushSubscriptions', next);

  return res.status(200).json({ ok: true });
}
