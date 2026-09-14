import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const redis = Redis.fromEnv();

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

// Verifica el PIN de Beatriz en el servidor (nunca en el navegador) y, si es
// correcto, entrega el token que el cliente deberá adjuntar en cada petición
// de administración (api/data.js). El token vive solo como variable de
// entorno. El PIN, en cambio, se guarda (con hash) en Redis para que Beatriz
// pueda cambiarlo ella misma desde la app; si todavía no lo ha cambiado
// nunca, se acepta el PIN inicial definido en ADMIN_PIN como respaldo.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { pin } = req.body || {};
  if (!pin) return res.status(401).json({ error: 'PIN incorrecto' });

  const storedHash = await redis.get('adminPinHash');
  const valid = storedHash ? hashPin(pin) === storedHash : pin === process.env.ADMIN_PIN;
  if (!valid) return res.status(401).json({ error: 'PIN incorrecto' });

  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).json({ error: 'Falta configurar ADMIN_TOKEN en el servidor' });
  }

  return res.status(200).json({ token: process.env.ADMIN_TOKEN });
}
