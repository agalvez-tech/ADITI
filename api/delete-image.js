import { del } from '@vercel/blob';

function isAdminRequest(req) {
  const token = req.headers['x-admin-token'];
  return !!token && !!process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN;
}

// Borra una imagen del Muro de Vercel Blob cuando se elimina la publicación,
// para no dejar archivos huérfanos acumulándose en el storage.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Requiere acceso de administración' });

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Falta la url de la imagen' });

  try {
    await del(url, { storeId: process.env.ADITIOK_STORE_ID || process.env.BLOB_STORE_ID });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Error borrando imagen', e);
    return res.status(500).json({ error: 'No se pudo borrar la imagen' });
  }
}
