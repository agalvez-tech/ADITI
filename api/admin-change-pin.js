import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const redis = Redis.fromEnv();

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function isAdminRequest(req) {
  const token = req.headers['x-admin-token'];
  return !!token && !!process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN;
}

// Permite a Beatriz cambiar su propio PIN desde dentro de la app. Exige estar
// ya autenticada (token de admin) Y saber el PIN actual, para que nadie con
// solo el token (que no debería filtrarse, pero por si acaso) pueda secuestrar
// el acceso cambiando el PIN sin más.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Requiere acceso de administración' });

  const { currentPin, newPin } = req.body || {};
  if (!newPin || String(newPin).length < 4) {
    return res.status(400).json({ error: 'El PIN nuevo debe tener al menos 4 caracteres' });
  }

  const storedHash = await redis.get('adminPinHash');
  const currentValid = storedHash ? hashPin(currentPin) === storedHash : currentPin === process.env.ADMIN_PIN;
  if (!currentValid) return res.status(401).json({ error: 'El PIN actual no es correcto' });

  await redis.set('adminPinHash', hashPin(newPin));
  return res.status(200).json({ ok: true });
}
