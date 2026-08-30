import { buildMerchantParameters, signParameters, generateOrder } from './_redsys.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { kind, itemId, studentId, amount, concept } = req.body || {};
  if (!['bono', 'suelta'].includes(kind) || !itemId || !studentId || !amount) {
    return res.status(400).json({ error: 'Faltan datos para iniciar el pago' });
  }

  const env = process.env.REDSYS_ENV === 'production' ? 'production' : 'test';
  const url = env === 'production'
    ? 'https://sis.redsys.es/sis/realizarPago'
    : 'https://sis-t.redsys.es:25443/sis/realizarPago';

  const baseUrl = process.env.APP_BASE_URL || `https://${req.headers.host}`;
  const order = generateOrder();
  const amountCents = Math.round(Number(amount) * 100).toString();
  const merchantData = JSON.stringify({ kind, itemId, studentId });

  const paramsObj = {
    Ds_Merchant_Amount: amountCents,
    Ds_Merchant_Order: order,
    Ds_Merchant_MerchantCode: process.env.REDSYS_MERCHANT_CODE,
    Ds_Merchant_Currency: '978',
    Ds_Merchant_TransactionType: '0',
    Ds_Merchant_Terminal: process.env.REDSYS_TERMINAL,
    Ds_Merchant_MerchantURL: `${baseUrl}/api/redsys-notify`,
    Ds_Merchant_UrlOK: `${baseUrl}/pago-ok.html`,
    Ds_Merchant_UrlKO: `${baseUrl}/pago-ko.html`,
    Ds_Merchant_MerchantName: process.env.REDSYS_MERCHANT_NAME || 'Aditi Functional Yoga',
    Ds_Merchant_ProductDescription: (concept || '').slice(0, 125),
    Ds_Merchant_MerchantData: merchantData,
    Ds_Merchant_ConsumerLanguage: '001'
  };

  const merchantParameters = buildMerchantParameters(paramsObj);
  const signature = signParameters(process.env.REDSYS_SECRET_KEY, order, merchantParameters);

  return res.status(200).json({
    url,
    Ds_SignatureVersion: 'HMAC_SHA256_V1',
    Ds_MerchantParameters: merchantParameters,
    Ds_Signature: signature
  });
}
