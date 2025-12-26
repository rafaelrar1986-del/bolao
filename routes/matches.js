// routes/matches.js
const express = require('express');
const router = express.Router();

const Match = require('../models/Match');
const Bet   = require('../models/Bet');
const { protect, admin } = require('../middleware/auth');
const { trySaveDailyPoints } = require('../services/dailyHistoryService');

// ---- helper
function calcWinner(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
  if (na > nb) return 'A';
  if (nb > na) return 'B';
  return 'draw';
}
/**
 * Converte "DD/MM/YYYY" → Date UTC (00:00)
 * Evita erro MM/DD e dia > 12
 */
function parseMatchDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const [day, month, year] = dateStr.split('/');
  if (!day || !month || !year) return null;

  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    0, 0, 0
  ));
}

// ======================
// GET /api/matches  (público)
// ======================
router.get('/', async (req, res) => {
  try {
    const matches = await Match.find().sort({ matchId: 1 }).lean();
    res.json({ success: true, data: matches });
  } catch (err) {
    console.error('Erro ao listar partidas:', err);
    res.status(500).json({ success: false, message: 'Erro ao listar partidas' });
  }
});

// ======================
// GET /api/matches/admin/all  (admin)
// ======================
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const matches = await Match.find().sort({ matchId: 1 }).lean();

    const betCounts = await Bet.aggregate([
      { $unwind: '$groupMatches' },
      { $group: { _id: '$groupMatches.matchId', count: { $sum: 1 } } },
    ]);

    const countMap = new Map(betCounts.map(b => [b._id, b.count]));
    const enriched = matches.map(m => ({
      ...m,
      betsCount: countMap.get(m.matchId) || 0,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Erro ao listar partidas (admin):', err);
    res.status(500).json({ success: false, message: 'Erro ao listar partidas' });
  }
});

// ======================
// POST /api/matches/admin/add  (admin)
// ======================
router.post('/admin/add', protect, admin, async (req, res) => {
  try {
    const { matchId, teamA, teamB, date, time, group, stadium, phase } = req.body;

    if (!matchId || !teamA || !teamB || !date || !time || (phase !== 'knockout' && !group)) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios ausentes' });
    }

    const idNum = Number(matchId);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ success: false, message: 'matchId inválido' });
    }

    const exists = await Match.findOne({ matchId: idNum });
    if (exists) {
      return res.status(409).json({ success: false, message: 'matchId já existe' });
    }

    const m = await Match.create({
      matchId: idNum,
      teamA: String(teamA).trim(),
      teamB: String(teamB).trim(),
      date: String(date).trim(),
      time: String(time).trim(),
      group: String(group).trim(),
      stadium: stadium ? String(stadium).trim() : undefined,
      phase: phase || 'group',
      status: 'scheduled',
      scoreA: undefined,
      scoreB: undefined,
    });

    res.json({ success: true, data: m });
  } catch (err) {
    console.error('Erro ao adicionar partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao adicionar partida' });
  }
});

// ======================
// PUT /api/matches/admin/edit/:matchId  (admin)
// (não recalcula pontos aqui; /finish é quem define placar e pontos)
// ======================
router.put('/admin/edit/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    if (!Number.isFinite(matchId)) {
      return res.status(400).json({ success: false, message: 'matchId inválido' });
    }

    const updates = {};
    ['teamA','teamB','date','time','group','stadium','phase','status','scoreA','scoreB'].forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });

    if (updates.teamA) updates.teamA = String(updates.teamA).trim();
    if (updates.teamB) updates.teamB = String(updates.teamB).trim();
    if (updates.date)  updates.date  = String(updates.date).trim();
    if (updates.time)  updates.time  = String(updates.time).trim();
    if (updates.group) updates.group = String(updates.group).trim();
    if (updates.stadium) updates.stadium = String(updates.stadium).trim();

    // Se tentarem setar finished por aqui sem placar, bloqueia:
    if (updates.status === 'finished' &&
        (updates.scoreA === undefined || updates.scoreB === undefined)) {
      return res.status(400).json({
        success: false,
        message: 'Para finalizar, informe scoreA e scoreB — use a tela "Finalizar Partida".'
      });
    }

    // Coerção de placar se vier
    if (updates.scoreA !== undefined) updates.scoreA = Number(updates.scoreA);
    if (updates.scoreB !== undefined) updates.scoreB = Number(updates.scoreB);

    const match = await Match.findOneAndUpdate({ matchId }, { $set: updates }, { new: true });
    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    res.json({ success: true, data: match });
  } catch (err) {
    console.error('Erro ao editar partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao editar partida' });
  }
});

// ======================
// POST /api/matches/admin/finish/:matchId  (admin)
// - seta placar + status finished
// - calcula vencedor 'A'|'B'|'draw'
// - marca 1 ponto para quem acertou winner
// - recalcula groupPoints e totalPoints
// ======================
router.post('/admin/finish/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const scoreA = Number(req.body.scoreA);
    const scoreB = Number(req.body.scoreB);

    if (!Number.isFinite(matchId) || !Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
      return res.status(400).json({ success: false, message: 'matchId, scoreA e scoreB válidos são obrigatórios' });
    }

    const match = await Match.findOneAndUpdate(
      { matchId },
      { $set: { scoreA, scoreB, status: 'finished', qualifiedSide: (typeof req.body.qualifiedSide !== 'undefined' ? req.body.qualifiedSide : undefined) } },
      { new: true }
    );

    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    const resultWinner = calcWinner(scoreA, scoreB); // 'A' | 'B' | 'draw'

    // Atualiza apostas desse jogo
    const cursor = Bet.find({ 'groupMatches.matchId': matchId }).cursor();
    for await (const bet of cursor) {
      bet.groupMatches = (bet.groupMatches || []).map(gm => {
        if (gm.matchId === matchId) {
          const hitResult = gm.winner && gm.winner === resultWinner;

          let hitQualifier = false;
          // Prefer explicit qualifiedSide set on match (admin) when available, otherwise use resultWinner
          const realQualifier = (typeof match.qualifiedSide !== 'undefined' && match.qualifiedSide) ? match.qualifiedSide : resultWinner;
          if (gm.qualifier && (gm.qualifier === 'A' || gm.qualifier === 'B')) {
            if (realQualifier && realQualifier !== 'draw' && gm.qualifier === realQualifier) {
              hitQualifier = true;
            }
          }

          gm.qualifierPoints = hitQualifier ? 1 : 0;
          gm.points = (hitResult ? 1 : 0) + (hitQualifier ? 1 : 0);
        }
        return gm;
      });

      bet.groupPoints = (bet.groupMatches || []).reduce((sum, gm) => sum + (gm.points || 0), 0);
      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
      bet.lastUpdate = new Date();

      await bet.save();
    }

    // 🔥 TENTA SALVAR O HISTÓRICO DIÁRIO (AUTOMÁTICO)
const normalizedDate = parseMatchDate(match.date);

console.log(
  '🧪 Tentando salvar histórico do dia correto:',
  match.date,
  '→',
  normalizedDate
);

if (normalizedDate) {
  await trySaveDailyPoints(normalizedDate);
}

    res.json({
      success: true,
      message: 'Partida finalizada e pontos atualizados',
      data: {
        matchId: match.matchId,
        scoreA: match.scoreA,
        scoreB: match.scoreB,
        result: resultWinner,
      },
    });
  } catch (err) {
    console.error('Erro ao finalizar partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao finalizar partida' });
  }
});

// ======================
// POST /api/matches/admin/unfinish/:matchId  (admin)
// - volta para 'scheduled', zera placar
// - zera pontos desse jogo nas apostas e recalcula totais
// ======================
router.post('/admin/unfinish/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    if (!Number.isFinite(matchId)) {
      return res.status(400).json({ success: false, message: 'matchId inválido' });
    }

    const match = await Match.findOneAndUpdate(
      { matchId },
      { $set: { status: 'scheduled' }, $unset: { scoreA: 1, scoreB: 1 } },
      { new: true }
    );
    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    const cursor = Bet.find({ 'groupMatches.matchId': matchId }).cursor();
    for await (const bet of cursor) {
      bet.groupMatches = (bet.groupMatches || []).map(gm => {
        if (gm.matchId === matchId) gm.points = 0;
        return gm;
      });

      bet.groupPoints = (bet.groupMatches || []).reduce((s, gm) => s + (gm.points || 0), 0);
      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
      bet.lastUpdate = new Date();
      await bet.save();
    }

    res.json({ success: true, message: 'Partida reaberta e pontos zerados desse jogo' });
  } catch (err) {
    console.error('Erro ao reabrir partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao reabrir partida' });
  }
});

// ======================
// DELETE /api/matches/admin/delete/:matchId  (admin)
// - remove a partida
// - remove o jogo das apostas e recalcula totais
// ======================
router.delete('/admin/delete/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    if (!Number.isFinite(matchId)) {
      return res.status(400).json({ success: false, message: 'matchId inválido' });
    }

    const removed = await Match.findOneAndDelete({ matchId });
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    const cursor = Bet.find({ 'groupMatches.matchId': matchId }).cursor();
    for await (const bet of cursor) {
      bet.groupMatches = (bet.groupMatches || []).filter(gm => gm.matchId !== matchId);
      bet.groupPoints = (bet.groupMatches || []).reduce((s, gm) => s + (gm.points || 0), 0);
      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
      bet.lastUpdate = new Date();
      await bet.save();
    }

    res.json({ success: true, message: 'Partida excluída e apostas ajustadas' });
  } catch (err) {
    console.error('Erro ao excluir partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao excluir partida' });
  }
});

module.exports = router;
