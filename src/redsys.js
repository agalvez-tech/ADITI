export async function payWithRedsys({ kind, itemId, studentId, amount, concept }) {
  const res = await fetch('/api/redsys-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, itemId, studentId, amount, concept })
  });
  if (!res.ok) throw new Error('No se pudo iniciar el pago');
  const data = await res.json();

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = data.url;
  const fields = {
    Ds_SignatureVersion: data.Ds_SignatureVersion,
    Ds_MerchantParameters: data.Ds_MerchantParameters,
    Ds_Signature: data.Ds_Signature
  };
  Object.entries(fields).forEach(([k, v]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}
