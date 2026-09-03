const BASE = '/api/data';

export async function getData(key, adminToken) {
  try {
    const res = await fetch(`${BASE}?key=${encodeURIComponent(key)}`, {
      headers: adminToken ? { 'x-admin-token': adminToken } : undefined
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.value;
  } catch (e) {
    console.error('Error leyendo', key, e);
    return null;
  }
}

export async function setData(key, value, adminToken) {
  try {
    const res = await fetch(`${BASE}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
      body: JSON.stringify({ value })
    });
    return res.ok;
  } catch (e) {
    console.error('Error guardando', key, e);
    return false;
  }
}

export async function adminLogin(pin) {
  try {
    const res = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.token;
  } catch (e) {
    console.error('Error validando PIN', e);
    return null;
  }
}

// Busca la ficha de UNA alumna por teléfono o id, sin exponer el resto del listado.
export async function findStudent({ phone, id }) {
  try {
    const qs = id ? `id=${encodeURIComponent(id)}` : `phone=${encodeURIComponent(phone)}`;
    const res = await fetch(`/api/student-profile?${qs}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.student;
  } catch (e) {
    console.error('Error buscando alumna', e);
    return null;
  }
}

// Crea o edita SOLO la ficha propia de una alumna.
export async function upsertStudent(student) {
  try {
    const res = await fetch('/api/student-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student })
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.student;
  } catch (e) {
    console.error('Error guardando alumna', e);
    return null;
  }
}
