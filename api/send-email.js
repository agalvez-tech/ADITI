import { Redis } from '@upstash/redis';
import { sendCommunication } from './_brevo.js';

const redis = Redis.fromEnv();

// Email de Beatriz a las alumnas que marque. Solo con el token de admin, y los
// destinatarios salen siempre de las alumnas guardadas (nunca de una dirección libre).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const token = req.headers['x-admin-token'];
  if (!token || !process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'No autorizado' });

  const { studentIds, subject, message } = req.body || {};
  if (!Array.isArray(studentIds) || studentIds.length === 0) return res.status(400).json({ error: 'Elige al menos una alumna' });
  if (studentIds.length > 500) return res.status(400).json({ error: 'Demasiadas destinatarias' });
  if (!String(subject || '').trim() || !String(message || '').trim()) return res.status(400).json({ error: 'Faltan el asunto o el mensaje' });

  const ids = new Set(studentIds);
  const students = ((await redis.get('students')) || []).filter(s => ids.has(s.id));
  const withoutEmail = students.filter(s => !s.email).length;
  const { sent, failed } = await sendCommunication(students, String(subject).trim().slice(0, 150), String(message).trim().slice(0, 5000));
  return res.status(200).json({ sent, failed, withoutEmail });
}
