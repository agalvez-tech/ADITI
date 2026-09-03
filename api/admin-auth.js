// Verifica el PIN de Beatriz en el servidor (nunca en el navegador) y, si es
// correcto, entrega el token que el cliente deberá adjuntar en cada petición
// de administración (api/data.js). El PIN y el token viven solo como
// variables de entorno, nunca en el bundle de la app.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { pin } = req.body || {};
  if (!pin || !process.env.ADMIN_PIN || pin !== process.env.ADMIN_PIN) {
    return res.status(401).json({ error: 'PIN incorrecto' });
  }

  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).json({ error: 'Falta configurar ADMIN_TOKEN en el servidor' });
  }

  return res.status(200).json({ token: process.env.ADMIN_TOKEN });
}
