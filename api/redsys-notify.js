import { Redis } from '@upstash/redis';
import { decodeMerchantParameters, signParameters, base64UrlToBase64 } from './_redsys.js';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { Ds_MerchantParameters, Ds_Signature } = req.body || {};
    if (!Ds_MerchantParameters || !Ds_Signature) return res.status(400).send('KO');

    const params = decodeMerchantParameters(Ds_MerchantParameters);
    const order = params.Ds_Order || params.Ds_Merchant_Order;

    const expectedSig = signParameters(process.env.REDSYS_SECRET_KEY, order, Ds_MerchantParameters);
    const receivedSig = base64UrlToBase64(Ds_Signature);

    // Firma inválida: no confiamos en la notificación
    if (expectedSig !== receivedSig) {
      return res.status(400).send('KO');
    }

    const responseCode = parseInt(params.Ds_Response, 10);
    const success = responseCode >= 0 && responseCode <= 99;

    if (success && params.Ds_MerchantData) {
      const { kind, itemId } = JSON.parse(params.Ds_MerchantData);

      if (kind === 'bono') {
        const purchases = (await redis.get('purchases')) || [];
        const next = purchases.map(p => p.id === itemId
          ? { ...p, status: 'confirmado', paymentMethod: 'redsys', expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }
          : p);
        await redis.set('purchases', next);
      } else if (kind === 'suelta') {
        const bookings = (await redis.get('bookings')) || [];
        const next = bookings.map(b => b.id === itemId
          ? { ...b, status: 'confirmada', paymentMethod: 'redsys' }
          : b);
        await redis.set('bookings', next);
      }
    }

    // Redsys solo espera un 200 OK, no le importa el cuerpo
    return res.status(200).send('OK');
  } catch (e) {
    console.error('Error en redsys-notify', e);
    return res.status(500).send('KO');
  }
}
