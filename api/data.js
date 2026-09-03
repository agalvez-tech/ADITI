import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Solo se permite leer/escribir estas claves compartidas.
// Evita que alguien use el endpoint para escribir cualquier cosa en tu Redis.
const ALLOWED_KEYS = ['students', 'bookings', 'purchases', 'wallPosts'];

// 'students' contiene datos personales de todas las alumnas: ni lectura ni
// escritura completas sin ser admin (las alumnas usan api/student-profile.js
// para su propia ficha, así nunca reciben el listado completo).
const ADMIN_ONLY_READ_KEYS = ['students'];

// 'wallPosts' (el Muro) lo lee cualquier alumna, pero solo Beatriz publica o borra.
const ADMIN_ONLY_WRITE_KEYS = ['students', 'wallPosts'];

// Para 'bookings' y 'purchases', las alumnas sí necesitan poder crear su propia
// reserva/compra sin ser admin. Sin token, solo se permite un cambio mínimo y
// concreto por petición (ver isChangeAllowedWithoutAdmin) para que nadie pueda
// borrar/reescribir la colección entera ni marcarse un pago como confirmado.
function isAdminRequest(req) {
  const token = req.headers['x-admin-token'];
  return !!token && !!process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Compara el valor guardado con el propuesto y determina si es: sin cambios,
// un único elemento añadido al final, o la modificación de un único elemento
// existente. Cualquier otra diferencia (borrados, reordenaciones, varios
// cambios a la vez) se considera no permitida sin token de admin.
function diffSingleChange(current, next) {
  const cur = Array.isArray(current) ? current : [];
  if (!Array.isArray(next)) return null;

  if (next.length === cur.length) {
    const diffIndexes = [];
    for (let i = 0; i < cur.length; i++) {
      if (!sameJson(cur[i], next[i])) diffIndexes.push(i);
    }
    if (diffIndexes.length === 0) return { type: 'noop' };
    if (diffIndexes.length === 1) {
      const i = diffIndexes[0];
      return { type: 'modify', before: cur[i], after: next[i] };
    }
    return null;
  }

  if (next.length === cur.length + 1) {
    for (let i = 0; i < cur.length; i++) {
      if (!sameJson(cur[i], next[i])) return null;
    }
    return { type: 'append', item: next[next.length - 1] };
  }

  return null;
}

function isBookingChangeAllowed(diff) {
  if (!diff) return false;
  if (diff.type === 'noop') return true;
  if (diff.type !== 'append') return false; // sin token, no se permite modificar reservas existentes
  const item = diff.item || {};
  // Solo altas nuevas: pendiente de pago (bizum/tarjeta) o confirmada por bono propio.
  return item.status === 'pendiente_pago' || (item.status === 'confirmada' && item.paymentMethod === 'bono');
}

function isPurchaseChangeAllowed(diff) {
  if (!diff) return false;
  if (diff.type === 'noop') return true;
  if (diff.type === 'append') {
    // Solo se puede crear una compra nueva en estado pendiente (aún sin pagar).
    return diff.item?.status === 'pendiente';
  }
  if (diff.type === 'modify') {
    const { before, after } = diff;
    // Solo se permite descontar/ajustar classesUsed de un bono ya confirmado;
    // ningún otro campo (status, price, expiryDate...) puede cambiar por esta vía.
    if (before.status !== 'confirmado' || after.status !== 'confirmado') return false;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      if (k === 'classesUsed') continue;
      if (!sameJson(before[k], after[k])) return false;
    }
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  const key = req.query.key;

  if (!ALLOWED_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Clave no permitida' });
  }

  const admin = isAdminRequest(req);

  if (req.method === 'GET') {
    if (ADMIN_ONLY_READ_KEYS.includes(key) && !admin) {
      return res.status(401).json({ error: 'Requiere acceso de administración' });
    }
    try {
      const value = await redis.get(key);
      return res.status(200).json({ value: value ?? null });
    } catch (e) {
      return res.status(500).json({ error: 'Error leyendo de Redis' });
    }
  }

  if (req.method === 'POST') {
    if (ADMIN_ONLY_WRITE_KEYS.includes(key) && !admin) {
      return res.status(401).json({ error: 'Requiere acceso de administración' });
    }
    try {
      const { value } = req.body || {};

      if (!admin && (key === 'bookings' || key === 'purchases')) {
        const current = await redis.get(key);
        const diff = diffSingleChange(current, value);
        const allowed = key === 'bookings' ? isBookingChangeAllowed(diff) : isPurchaseChangeAllowed(diff);
        if (!allowed) {
          return res.status(403).json({ error: 'Cambio no permitido' });
        }
      }

      await redis.set(key, value);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Error escribiendo en Redis' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Método no permitido');
}
