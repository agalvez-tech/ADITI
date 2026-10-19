import { hasActiveBono } from './_brevo.js';

// A quién va dirigida una publicación del Muro: 'todos' (todas las alumnas) o
// 'activos' (solo las que tienen ahora un bono vigente). Las publicaciones
// antiguas no tienen audiencia y se entienden como para todas.
export function audienceStudents(students, purchases, audience) {
  const all = students || [];
  if (audience !== 'activos') return all;
  return all.filter(s => hasActiveBono(purchases, s.id));
}
