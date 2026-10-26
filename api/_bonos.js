// Catálogo de bonos que usa el servidor para comprobar precios y clases.
// Mientras Beatriz no haya guardado bonos propios en "Gestionar bonos", la app
// usa estos (los mismos DEFAULT_BONOS de src/App.jsx: si cambias uno, cambia el otro).
export const DEFAULT_BONOS = [
  { id: 'bono4', price: 60, classes: 4, trimestrePrice: 165 },
  { id: 'bono6', price: 80, classes: 6, trimestrePrice: 220 },
  { id: 'bono8', price: 95, classes: 8, trimestrePrice: 260 },
  { id: 'bono10', price: 105, classes: 10, trimestrePrice: 285 },
  { id: 'bono12', price: 120, classes: 12, trimestrePrice: 325 },
  { id: 'ilimitado', price: 150, classes: null, trimestrePrice: 405 }
];

export function bonoCatalog(savedBonos) {
  return Array.isArray(savedBonos) && savedBonos.length > 0 ? savedBonos : DEFAULT_BONOS;
}

// Precio y nº de clases que le corresponden a una solicitud de bono, o null si
// el bono no existe o no admite trimestre.
export function expectedPurchase(catalog, purchase) {
  const bono = catalog.find(b => b.id === purchase.bonoId);
  if (!bono) return null;
  const tri = !!purchase.trimestre;
  if (tri && !bono.trimestrePrice) return null;
  return {
    price: tri ? bono.trimestrePrice : bono.price,
    classesTotal: bono.classes === null ? null : (tri ? bono.classes * 3 : bono.classes)
  };
}
