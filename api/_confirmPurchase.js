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

    if (kind === 'bono') {
      const purchases = (await redis.get('purchases')) || [];
      let confirmed = null;
      const next = purchases.map(p => {
        if (p.id !== itemId) return p;
        const termDays = p.trimestre ? 90 : 30;
        confirmed = { ...p, status: 'confirmado', paymentMethod: 'redsys', expiryDate: new Date(Date.now() + termDays * 24 * 60 * 60 * 1000).toISOString() };
        return confirmed;
      });
      await redis.set('purchases', next);
      if (confirmed) {
        const students = (await redis.get('students')) || [];
        const student = students.find(s => s.id === confirmed.studentId);
        await notifyBonoConfirmado(student, confirmed);
      }
    } else if (kind === 'freeze') {
      // Congelación de bono pagada: se confirma y se alarga la caducidad del
      // bono los días congelados. Solo si seguía pendiente, porque este
      // proceso puede ejecutarse dos veces (aviso de Redsys + retorno del
      // navegador) y no debe alargar el bono dos veces.
      const freezes = (await redis.get('freezes')) || [];
      const freeze = freezes.find(f => f.id === itemId);
      if (freeze && freeze.status === 'pendiente') {
        await redis.set('freezes', freezes.map(f => f.id === itemId ? { ...f, status: 'confirmado', paymentMethod: 'redsys' } : f));
        const purchases = (await redis.get('purchases')) || [];
        await redis.set('purchases', purchases.map(p => p.id === freeze.purchaseId
          ? { ...p, expiryDate: new Date(new Date(p.expiryDate).getTime() + freeze.days * 24 * 60 * 60 * 1000).toISOString() }
          : p));
      }
    } else if (kind === 'suelta') {
      const bookings = (await redis.get('bookings')) || [];
      let confirmed = null;
      const next = bookings.map(b => {
        if (b.id !== itemId) return b;
        confirmed = { ...b, status: 'confirmada', paymentMethod: 'redsys' };
        return confirmed;
      });
      await redis.set('bookings', next);
      if (confirmed) {
        const students = (await redis.get('students')) || [];
        const student = students.find(s => s.id === confirmed.studentId);
        await notifySueltaConfirmada(student, confirmed);
      }
    }
  }

  return success;
}
