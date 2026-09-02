import { decodeMerchantParameters, signParameters, base64UrlToBase64 } from './_redsys.js';
import { confirmPaymentFromParams } from './_confirmPurchase.js';

// Redsys redirige aquí el navegador de la alumna al terminar el pago (éxito o fallo),
// enviando por POST los mismos Ds_MerchantParameters/Ds_Signature que al webhook de notificación.
// Confirmamos el bono/clase en este mismo paso para no depender de que el aviso
// servidor-a-servidor (redsys-notify) llegue.
export default async function handler(req, res) {
  const { Ds_MerchantParameters, Ds_Signature } = req.body || {};

  if (!Ds_MerchantParameters || !Ds_Signature) {
    return res.redirect(302, '/pago-ko.html');
  }

  try {
    const params = decodeMerchantParameters(Ds_MerchantParameters);
    const order = params.Ds_Order || params.Ds_Merchant_Order;

    const expectedSig = signParameters(process.env.REDSYS_SECRET_KEY, order, Ds_MerchantParameters);
    const receivedSig = base64UrlToBase64(Ds_Signature);

    if (expectedSig !== receivedSig) {
      return res.redirect(302, '/pago-ko.html');
    }

    const success = await confirmPaymentFromParams(params);
    return res.redirect(302, success ? '/pago-ok.html' : '/pago-ko.html');
  } catch (e) {
    console.error('Error en redsys-return', e);
    return res.redirect(302, '/pago-ko.html');
  }
}
