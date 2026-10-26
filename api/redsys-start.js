import { Redis } from '@upstash/redis';
import { buildMerchantParameters, signParameters, generateOrder } from './_redsys.js';

const redis = Redis.fromEnv();

// El importe a cobrar sale siempre de lo que hay guardado (la solicitud
// pendiente de esa alumna), nunca de lo que diga el navegador.
const COLLECTION = { bono: ['purchases', 'pendiente'], suelta: ['bookings', 'pendiente_pago'], freeze: ['freezes', 'pendiente'] };
async function pendingItemPrice(kind, itemId, studentId) {
  const [key, pendingStatus] = COLLECTION[kind];
  // La solicitud se guarda justo antes de pedir el pago: damos unos instantes por si aún se está escribiendo.
  for (let i = 0; i < 4; i++) {
    const item = ((await redis.get(key)) || []).find(x => x.id === itemId && x.studentId === studentId && x.status === pendingStatus);
    if (item) return Number(item.price) > 0 ? Number(item.price) : null;
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { kind, itemId, studentId, concept } = req.body || {};
  if (!['bono', 'suelta', 'freeze'].includes(kind) || !itemId || !studentId) {
    return res.status(400).json({ error: 'Faltan datos para iniciar el pago' });
  }
  const amount = await pendingItemPrice(kind, itemId, studentId);
  if (!amount) return res.status(400).json({ error: 'No hay ninguna solicitud pendiente de pago con ese importe' });

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
    Ds_Merchant_UrlOK: `${baseUrl}/api/redsys-return`,
    Ds_Merchant_UrlKO: `${baseUrl}/api/redsys-return`,
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
