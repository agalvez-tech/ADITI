import { Redis } from '@upstash/redis';
import { notifyBonoConfirmado, notifySueltaConfirmada } from './_brevo.js';

const redis = Redis.fromEnv();

// Aplica el resultado de un pago Redsys ya verificado (firma correcta) a purchases/bookings.
// Devuelve true si el pago fue autorizado por el banco.
export async function confirmPaymentFromParams(params) {
  const responseCode = parseInt(params.Ds_Response, 10);
  const success = responseCode >= 0 && responseCode <= 99;

  if (success && params.Ds_MerchantData) {
    // Redsys devuelve Ds_MerchantData codificado como URL (%7B%22kind%22...);
    // si además de codificar viniera ya en JSON plano, decodeURIComponent no lo altera.
    const { kind, itemId } = JSON.parse(decodeURIComponent(params.Ds_MerchantData));

    // Redsys avisa dos veces (servidor y retorno del navegador) casi a la vez: sin
    // este cierre ambas confirmaban y mandaban el email duplicado.
    const lockKey = `payConfirm:${kind}:${itemId}`;
    if (!(await redis.set(lockKey, '1', { nx: true, ex: 600 }))) return success;
    try {
    // Importe cobrado por el banco (en céntimos): tiene que coincidir con el de la solicitud.
    const paidCents = params.Ds_Amount === undefined ? null : Number(params.Ds_Amount);
    const evidence = { order: params.Ds_Order || params.Ds_Merchant_Order || null, amountCents: paidCents, authCode: params.Ds_AuthorisationCode || null, at: new Date().toISOString() };
    const amountMatches = (price) => paidCents === null || !(Number(price) > 0) || paidCents === Math.round(Number(price) * 100);
    const reject = async (what, item) => {
      console.error(`Redsys: importe cobrado (${paidCents}) distinto al de ${what} ${item.id} (${item.price}); no se activa`);
      await redis.del(lockKey);
      return false;
    };

    if (kind === 'bono') {
      const purchases = (await redis.get('purchases')) || [];
      const found = purchases.find(p => p.id === itemId);
      if (!found || found.status === 'confirmado') return success; // ya activo (o no existe): no se toca ni se reenvía el email
      if (!amountMatches(found.price)) return reject('el bono', found);
      const termDays = found.trimestre ? 90 : 30;
      const confirmed = { ...found, status: 'confirmado', paymentMethod: 'redsys', payment: evidence, expiryDate: new Date(Date.now() + termDays * 24 * 60 * 60 * 1000).toISOString() };
      await redis.set('purchases', purchases.map(p => p.id === itemId ? confirmed : p));
      const students = (await redis.get('students')) || [];
      const student = students.find(s => s.id === confirmed.studentId);
      await notifyBonoConfirmado(student, confirmed);
    } else if (kind === 'freeze') {
      // Congelación de bono pagada: se confirma y se alarga la caducidad del
      // bono los días congelados. Solo si seguía pendiente.
      const freezes = (await redis.get('freezes')) || [];
      const freeze = freezes.find(f => f.id === itemId);
      if (freeze && freeze.status === 'pendiente') {
        if (!amountMatches(freeze.price)) return reject('la congelación', freeze);
        await redis.set('freezes', freezes.map(f => f.id === itemId ? { ...f, status: 'confirmado', paymentMethod: 'redsys', payment: evidence } : f));
        const purchases = (await redis.get('purchases')) || [];
        await redis.set('purchases', purchases.map(p => p.id === freeze.purchaseId
          ? { ...p, expiryDate: new Date(new Date(p.expiryDate).getTime() + freeze.days * 24 * 60 * 60 * 1000).toISOString() }
          : p));
      }
    } else if (kind === 'suelta') {
      const bookings = (await redis.get('bookings')) || [];
      const found = bookings.find(b => b.id === itemId);
      if (!found || found.status === 'confirmada') return success;
      if (!amountMatches(found.price)) return reject('la clase', found);
      const confirmed = { ...found, status: 'confirmada', paymentMethod: 'redsys', payment: evidence };
      await redis.set('bookings', bookings.map(b => b.id === itemId ? confirmed : b));
      const students = (await redis.get('students')) || [];
      const student = students.find(s => s.id === confirmed.studentId);
      await notifySueltaConfirmada(student, confirmed);
    }
    } catch (e) {
      await redis.del(lockKey); // que el siguiente aviso pueda reintentar
      throw e;
    }
  }

  return success;
}
