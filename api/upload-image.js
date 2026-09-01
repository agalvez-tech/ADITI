import { put } from '@vercel/blob';

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { filename, dataUrl } = req.body || {};
    if (!filename || !dataUrl) {
      return res.status(400).json({ error: 'Faltan datos de la imagen' });
    }

    const matches = dataUrl.match(/^data:(.+);base64,(.*)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Formato de imagen no válido' });
    }
    const contentType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = await put(`muro/${Date.now()}-${safeName}`, buffer, {
      access: 'public',
      contentType,
      storeId: process.env.ADITIOK_STORE_ID || process.env.BLOB_STORE_ID
    });

    return res.status(200).json({ url: blob.url });
  } catch (e) {
    console.error('Error subiendo imagen', e);
    return res.status(500).json({ error: 'No se pudo subir la imagen', detail: e.message });
  }
}
