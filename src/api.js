const BASE = '/api/data';

export async function getData(key) {
  try {
    const res = await fetch(`${BASE}?key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.value;
  } catch (e) {
    console.error('Error leyendo', key, e);
    return null;
  }
}

export async function setData(key, value) {
  try {
    const res = await fetch(`${BASE}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    return res.ok;
  } catch (e) {
    console.error('Error guardando', key, e);
    return false;
  }
}
