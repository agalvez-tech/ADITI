import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const DAY = 86400000;

// Días cerrados por Beatriz que son laborables (festivo con extendBonos): cada
// uno alarga un día la caducidad de los bonos vigentes que lo cubren, salvo si
// esa alumna ya lo tenía congelado. Es idempotente: cada bono apunta en
// closureExt qué días ya ha sumado, así que se puede ejecutar las veces que haga
// falta, y si un día se quita (o se desmarca) se resta.
export function applyClosureExtensions(purchases, holidays, freezes, now = new Date()) {
  const closures = (holidays || []).filter(h => h.extendBonos && h.date).sort((a, b) => a.date.localeCompare(b.date));
  const ids = new Set(closures.map(h => h.id));
  let changed = false;
  const next = (purchases || []).map(p => {
    if (!p.closureExt && p.status !== 'confirmado') return p;
    const ext = { ...(p.closureExt || {}) };
    let exp = new Date(p.expiryDate).getTime();
    let touched = false;
    for (const id of Object.keys(ext)) {
      if (!ids.has(id)) { exp -= ext[id] * DAY; delete ext[id]; touched = true; }
    }
    // Un bono ya caducado no se revive.
    if (p.status === 'confirmado' && exp >= now.getTime()) {
      const startIso = String(p.purchaseDate).slice(0, 10);
      for (const h of closures) {
        if (ext[h.id]) continue;
        const expIso = new Date(exp).toISOString().slice(0, 10);
        if (h.date < startIso || h.date > expIso) continue;
        if ((freezes || []).some(f => f.purchaseId === p.id && f.status === 'confirmado' && f.startDate <= h.date && h.date <= f.endDate)) continue;
        ext[h.id] = 1;
        exp += DAY;
        touched = true;
      }
    }
    if (!touched) return p;
    changed = true;
    const { closureExt, ...rest } = p;
    return { ...rest, expiryDate: new Date(exp).toISOString(), ...(Object.keys(ext).length ? { closureExt: ext } : {}) };
  });
  return { purchases: next, changed };
}

export async function extendBonosForClosures() {
  const [purchases, holidays, freezes] = await Promise.all([redis.get('purchases'), redis.get('holidays'), redis.get('freezes')]);
  const r = applyClosureExtensions(purchases || [], holidays || [], freezes || []);
  if (r.changed) await redis.set('purchases', r.purchases);
  return r.changed;
}
