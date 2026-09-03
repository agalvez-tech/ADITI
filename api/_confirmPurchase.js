import { Redis } from '@upstash/redis';

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

  return success;
}
