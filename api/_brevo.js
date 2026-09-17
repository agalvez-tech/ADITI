import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const BREVO_API = 'https://api.brevo.com/v3';

function enabled() {
  return !!process.env.BREVO_API_KEY;
}

async function brevoPost(path, body) {
  return fetch(`${BREVO_API}${path}`, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// Brevo exige el teléfono en formato internacional (+34...); las alumnas lo
// guardan como un número español normal de 9 dígitos, sin prefijo.
function toE164(phone) {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  const clean = digits.replace(/^0+/, '');
  return clean.length === 9 ? `+34${clean}` : undefined;
}

export function hasActiveBono(purchases, studentId, onDate) {
  const now = onDate || new Date();
  return (purchases || []).some(p =>
    p.studentId === studentId && p.status === 'confirmado' &&
    new Date(p.expiryDate) >= now && (p.classesTotal === null || p.classesUsed < p.classesTotal)
  );
}

// Da de alta o mueve a una alumna a la lista de Brevo que le corresponde
// (puntual / con bono activo / sin bono activo). No falla nunca de forma
// visible: si Brevo no está configurado o da error, simplemente no hace nada.
export async function syncStudentContact(student, purchases) {
  if (!enabled() || !student?.email) return;

  const listId = student.isPuntual
    ? process.env.BREVO_LIST_PUNTUALES
    : hasActiveBono(purchases, student.id)
      ? process.env.BREVO_LIST_CON_BONO
      : process.env.BREVO_LIST_SIN_BONO;
  if (!listId) return;

  try {
    const res = await brevoPost('/contacts', {
      email: student.email,
      attributes: { FIRSTNAME: (student.name || '').split(' ')[0], SMS: toE164(student.phone) },
      listIds: [Number(listId)],
      updateEnabled: true
    });
    if (!res.ok) console.error('Brevo: error sincronizando contacto', await res.text());
  } catch (e) {
    console.error('Brevo: excepción sincronizando contacto', e);
  }
}

async function sendEmail(to, subject, htmlContent) {
  if (!enabled() || !to || !process.env.BREVO_SENDER_EMAIL) return;
  try {
    const res = await brevoPost('/smtp/email', {
      sender: { name: process.env.BREVO_SENDER_NAME || 'Aditi Functional Yoga', email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent
    });
    if (!res.ok) console.error('Brevo: error enviando email', await res.text());
  } catch (e) {
    console.error('Brevo: excepción enviando email', e);
  }
}

export async function notifyBonoConfirmado(student, purchase) {
  if (!student) return;
  const purchases = (await redis.get('purchases')) || [];
  await syncStudentContact(student, purchases);
  const bonos = (await redis.get('bonos')) || [];
  const bono = bonos.find(b => b.id === purchase.bonoId);
  const bonoLabel = (bono ? bono.name : purchase.bonoId) + (purchase.trimestre ? ' (trimestre)' : '');
  await sendEmail(
    student.email,
    '¡Tu bono de Aditi ya está activo!',
    `<p>Hola ${(student.name || '').split(' ')[0]},</p>
     <p>Hemos confirmado el pago de tu <b>${bonoLabel}</b>. Ya puedes reservar tus clases desde la app.</p>
     <p>Válido hasta el ${new Date(purchase.expiryDate).toLocaleDateString('es-ES')}.</p>
     <p>— Aditi Functional Yoga</p>`
  );
}

export async function notifySueltaConfirmada(student, booking) {
  if (!student) return;
  await sendEmail(
    student.email,
    'Tu clase en Aditi está confirmada',
    `<p>Hola ${(student.name || '').split(' ')[0]},</p>
     <p>Tu plaza en <b>${booking.className}</b> el ${new Date(booking.date).toLocaleDateString('es-ES')} a las ${booking.time} está confirmada.</p>
     <p>— Aditi Functional Yoga</p>`
  );
}

// Aviso por email cuando Beatriz publica algo en el Muro (además del push).
// Cada alumna recibe su propio email individual, nunca se exponen las
// direcciones de las demás.
export async function broadcastWallPost(students, title, content, imageUrl) {
  if (!enabled()) return;
  const emails = (students || []).map(s => s.email).filter(Boolean);
  const imageHtml = imageUrl ? `<p><img src="${imageUrl}" alt="" style="max-width:100%;border-radius:8px;"></p>` : '';
  const html = `${imageHtml}<p>${content}</p><p>— Aditi Functional Yoga</p>`;
  await Promise.allSettled(
    emails.map(email => sendEmail(email, `Aditi: ${title}`, html))
  );
}

// Manda la encuesta a cada alumna con un botón por opción para poder votar
// con un solo clic desde el propio email, sin tener que abrir la app.
// Cada enlace lleva su id de alumna incrustado para que el voto quede ligado
// a ella igual que si votara desde dentro de la app.
export async function broadcastPoll(students, poll, appBaseUrl) {
  if (!enabled() || !poll) return;
  const optionButtons = (poll.options || []).map(o => (studentId) =>
    `<p style="margin:8px 0;"><a href="${appBaseUrl}/api/poll-vote?poll=${encodeURIComponent(poll.id)}&option=${encodeURIComponent(o.id)}&student=${encodeURIComponent(studentId)}" style="display:inline-block;padding:11px 18px;background:#3F2751;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${o.label}</a></p>`
  );
  await Promise.allSettled((students || []).filter(s => s.email).map(s => {
    const html = `<p>Hola ${(s.name || '').split(' ')[0]},</p>
      <p><b>${poll.question}</b></p>
      ${optionButtons.map(fn => fn(s.id)).join('')}
      <p style="font-size:12px;color:#888;">También puedes votar abriendo la app. Un solo voto por alumna.</p>
      <p>— Aditi Functional Yoga</p>`;
    return sendEmail(s.email, `Aditi: ${poll.question}`, html);
  }));
}
