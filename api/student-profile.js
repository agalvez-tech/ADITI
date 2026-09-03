import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

function normPhone(p) {
  return (p || '').replace(/\s/g, '');
}

function randomId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Endpoint público pensado para que una alumna encuentre o cree/edite SOLO
// su propia ficha, sin exponer nunca el listado completo de alumnas (eso
// sigue protegido por token de admin en api/data.js).
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { phone, id } = req.query;
    if (!phone && !id) return res.status(400).json({ error: 'Falta phone o id' });

    const students = (await redis.get('students')) || [];
    const found = id
      ? students.find(s => s.id === id)
      : students.find(s => normPhone(s.phone) === normPhone(phone));

    return res.status(200).json({ student: found || null });
  }

  if (req.method === 'POST') {
    const { student } = req.body || {};
    if (!student || typeof student !== 'object') {
      return res.status(400).json({ error: 'Datos de alumna incompletos' });
    }

    const students = (await redis.get('students')) || [];
    const existingIndex = student.id ? students.findIndex(s => s.id === student.id) : -1;

    let saved;
    let next;
    if (existingIndex >= 0) {
      saved = { ...students[existingIndex], ...student };
      next = students.map((s, i) => i === existingIndex ? saved : s);
    } else {
      saved = { ...student, id: student.id || randomId(), createdAt: student.createdAt || new Date().toISOString() };
      next = [...students, saved];
    }

    await redis.set('students', next);
    return res.status(200).json({ student: saved });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Método no permitido');
}
