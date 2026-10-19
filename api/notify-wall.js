import { Redis } from '@upstash/redis';
import { notifyAllPush } from './_push.js';
import { audienceStudents } from './_audience.js';

const redis = Redis.fromEnv();

// Aviso push de algo publicado en el Muro. Con audience 'activos' solo se
// avisa a las alumnas con bono vigente; sin audiencia, a todas.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { title, body, audience } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Falta el título' });

  let onlyStudentIds = null;
  if (audience === 'activos') {
    const students = (await redis.get('students')) || [];
    const purchases = (await redis.get('purchases')) || [];
    onlyStudentIds = new Set(audienceStudents(students, purchases, audience).map(s => s.id));
  }

  await notifyAllPush(title, body, onlyStudentIds);
  return res.status(200).json({ ok: true });
}
