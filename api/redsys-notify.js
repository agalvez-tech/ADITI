import { decodeMerchantParameters, signParameters, base64UrlToBase64 } from './_redsys.js';
import { confirmPaymentFromParams } from './_confirmPurchase.js';

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

    await confirmPaymentFromParams(params);

    // Redsys solo espera un 200 OK, no le importa el cuerpo
    return res.status(200).send('OK');
  } catch (e) {
    console.error('Error en redsys-notify', e);
    return res.status(500).send('KO');
  }
}
