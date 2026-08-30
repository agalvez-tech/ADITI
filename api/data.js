import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Solo se permite leer/escribir estas claves compartidas.
// Evita que alguien use el endpoint para escribir cualquier cosa en tu Redis.
const ALLOWED_KEYS = ['students', 'bookings', 'purchases', 'wallPosts'];

export default async function handler(req, res) {
  const key = req.query.key;

  if (!ALLOWED_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Clave no permitida' });
  }

  if (req.method === 'GET') {
    try {
      const value = await redis.get(key);
      return res.status(200).json({ value: value ?? null });
    } catch (e) {
      return res.status(500).json({ error: 'Error leyendo de Redis' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { value } = req.body || {};
      await redis.set(key, value);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Error escribiendo en Redis' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Método no permitido');
}
