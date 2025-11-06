// routes/matches.js
const express = require('express');
const router = express.Router();

const Match = require('../models/Match');
const Bet   = require('../models/Bet');
const { protect, admin } = require('../middleware/auth');

// ======================
// GET /api/matches  (público) — lista partidas para o app
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
// GET /api/matches/admin/all  (admin) — lista com info extra
// ======================
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const matches = await Match.find().sort({ matchId: 1 }).lean();

    // betsCount por partida (opcional)
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
/* POST /api/matches/admin/add  (admin) — cria partida */
router.post('/admin/add', protect, admin, async (req, res) => {
  try {
    const { matchId, teamA, teamB, date, time, group, stadium } = req.body;

    if (!matchId || !teamA || !teamB || !date || !time || !group) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios ausentes' });
    }

    const exists = await Match.findOne({ matchId });
    if (exists) {
      return res.status(409).json({ success: false, message: 'matchId já existe' });
    }

    const m = await Match.create({
      matchId: Number(matchId),
      teamA: teamA.trim(),
      teamB: teamB.trim(),
      date: date.trim(),
      time: time.trim(),
      group: group.trim(),
      stadium: stadium ? stadium.trim() : undefined,
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
// PUT /api/matches/admin/edit/:matchId  (admin) — edita dados
// (não recalcula pontos aqui; isso é feito em /finish)
// ======================
router.put('/admin/edit/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const updates = {};

    ['teamA','teamB','date','time','group','stadium','status','scoreA','scoreB'].forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });

    // Normalize
    if (updates.teamA) updates.teamA = String(updates.teamA).trim();
    if (updates.teamB) updates.teamB = String(updates.teamB).trim();
    if (updates.date)  updates.date  = String(updates.date).trim();
    if (updates.time)  updates.time  = String(updates.time).trim();
    if (updates.group) updates.group = String(updates.group).trim();
    if (updates.stadium) updates.stadium = String(updates.stadium).trim();

    // Não force status finished aqui — use a rota /finish para recalcular pontos
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
// - seta placar e status finished
// - calcula vencedor 'A'|'B'|'draw'
// - atualiza points = 1 se acertou winner; 0 senão
// - recalcula groupPoints e totalPoints
// ======================
router.post('/admin/finish/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const { scoreA, scoreB } = req.body;

    if (Number.isNaN(matchId) || scoreA == null || scoreB == null) {
      return res.status(400).json({ success: false, message: 'matchId, scoreA e scoreB são obrigatórios' });
    }

    const match = await Match.findOneAndUpdate(
      { matchId },
      {
        $set: {
          scoreA: Number(scoreA),
          scoreB: Number(scoreB),
          status: 'finished',
        },
      },
      { new: true }
    );

    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    let resultWinner = 'draw';
    if (match.scoreA > match.scoreB) resultWinner = 'A';
    else if (match.scoreB > match.scoreA) resultWinner = 'B';

    // Atualiza todas as apostas que possuem esse matchId
    const cursor = Bet.find({ 'groupMatches.matchId': matchId }).cursor();
    for await (const bet of cursor) {
      // atualiza pontos do jogo
      bet.groupMatches = bet.groupMatches.map(gm => {
        if (gm.matchId === matchId) {
          gm.points = (gm.winner === resultWinner) ? 1 : 0;
        }
        return gm;
      });

      // recomputa totais
      bet.groupPoints = bet.groupMatches.reduce((s, gm) => s + (gm.points || 0), 0);
      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);

      await bet.save();
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
// - volta status para 'scheduled'
// - limpa scoreA/scoreB
// - zera pontos desse jogo nas apostas e recalcula totais
// ======================
router.post('/admin/unfinish/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);

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
      bet.groupMatches = bet.groupMatches.map(gm => {
        if (gm.matchId === matchId) {
          gm.points = 0;
        }
        return gm;
      });

      bet.groupPoints = bet.groupMatches.reduce((s, gm) => s + (gm.points || 0), 0);
      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
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

    const removed = await Match.findOneAndDelete({ matchId });
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    const cursor = Bet.find({ 'groupMatches.matchId': matchId }).cursor();
    for await (const bet of cursor) {
      bet.groupMatches = bet.groupMatches.filter(gm => gm.matchId !== matchId);
      bet.groupPoints = bet.groupMatches.reduce((s, gm) => s + (gm.points || 0), 0);
      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
      await bet.save();
    }

    res.json({ success: true, message: 'Partida excluída e apostas ajustadas' });
  } catch (err) {
    console.error('Erro ao excluir partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao excluir partida' });
  }
});

module.exports = router;
