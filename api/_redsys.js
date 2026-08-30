import crypto from 'crypto';

function pad8(buf) {
  const rem = buf.length % 8;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(8 - rem, 0)]);
}

function encrypt3DES(messageBuf, keyBuf) {
  let key = keyBuf;
  if (key.length === 16) key = Buffer.concat([key, key.slice(0, 8)]);
  const iv = Buffer.alloc(8, 0);
  const cipher = crypto.createCipheriv('des-ede3-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(messageBuf), cipher.final()]);
}

export function buildMerchantParameters(paramsObj) {
  const json = JSON.stringify(paramsObj);
  return Buffer.from(json, 'utf8').toString('base64');
}

export function decodeMerchantParameters(base64Str) {
  const json = Buffer.from(base64Str, 'base64').toString('utf8');
  return JSON.parse(json);
}

export function signParameters(secretKeyBase64, order, merchantParametersBase64) {
  const key = Buffer.from(secretKeyBase64, 'base64');
  const orderPadded = pad8(Buffer.from(order, 'utf8'));
  const derivedKey = encrypt3DES(orderPadded, key);
  const hmac = crypto.createHmac('sha256', derivedKey);
  hmac.update(merchantParametersBase64, 'utf8');
  return hmac.digest('base64');
}

// Redsys envía la firma de vuelta en base64 "url-safe" (con - y _ en vez de + y /)
export function base64UrlToBase64(s) {
  let out = s.replace(/-/g, '+').replace(/_/g, '/');
  while (out.length % 4) out += '=';
  return out;
}

export function generateOrder() {
  const prefix = Date.now().toString().slice(-4);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return prefix + rand;
}
