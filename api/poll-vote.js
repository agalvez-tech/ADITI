import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Enlace de un solo clic que llega por email para votar una encuesta sin
// tener que abrir la app. Si esa alumna ya había votado (desde la app o
// desde otro enlace del mismo email), no se duplica: simplemente se le
// confirma que su voto ya estaba registrado.
export default async function handler(req, res) {
  const { poll: pollId, option: optionId, student: studentId } = req.query;

  if (!pollId || !optionId || !studentId) {
    return res.redirect(302, '/voto.html?status=invalido');
  }

  try {
    const polls = (await redis.get('polls')) || [];
    const poll = polls.find(p => p.id === pollId);
    if (!poll) return res.redirect(302, '/voto.html?status=notfound');

    const already = (poll.votes || []).some(v => v.studentId === studentId);
    if (already) return res.redirect(302, '/voto.html?status=already');

    if (poll.active === false) return res.redirect(302, '/voto.html?status=closed');

    const option = (poll.options || []).find(o => o.id === optionId);
    if (!option) return res.redirect(302, '/voto.html?status=invalido');

    const next = polls.map(p => p.id === pollId
      ? { ...p, votes: [...(p.votes || []), { studentId, optionId, votedAt: new Date().toISOString() }] }
      : p);
    await redis.set('polls', next);

    return res.redirect(302, `/voto.html?status=ok&option=${encodeURIComponent(option.label)}`);
  } catch (e) {
    console.error('poll-vote: error registrando voto', e);
    return res.redirect(302, '/voto.html?status=error');
  }
}
