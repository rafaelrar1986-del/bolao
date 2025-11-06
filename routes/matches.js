const express = require('express');
const Match = require('../models/Match');
const Bet = require('../models/Bet');
const { protect, admin } = require('../middleware/auth');
const router = express.Router();

// =============== Helpers internos ===============

async function recomputeBetTotals(betDoc) {
  // Recalcula groupPoints e totalPoints a partir dos items
  const groupPoints = (betDoc.groupMatches || []).reduce((sum, gm) => sum + (gm.points || 0), 0);
  betDoc.groupPoints = groupPoints;
  betDoc.totalPoints = (betDoc.podiumPoints || 0) + (betDoc.bonusPoints || 0) + groupPoints;
  await betDoc.save();
}

async function zeroPointsForMatchAcrossBets(matchId) {
  // Zera pontos do jogo em todos os bets e recalcula totais
  const bets = await Bet.find({ 'groupMatches.matchId': matchId, hasSubmitted: true });
  for (const bet of bets) {
    let changed = false;
    for (const gm of bet.groupMatches) {
      if (gm.matchId === matchId) {
        if (gm.points && gm.points !== 0) {
          gm.points = 0;
          changed = true;
        }
      }
    }
    if (changed) {
      await recomputeBetTotals(bet);
    }
  }
  // Atualiza ranking global, se existir método
  if (typeof Bet.updateRanking === 'function') {
    await Bet.updateRanking();
  }
}

async function processMatchResults(match) {
  // Processa pontos para uma partida finalizada (reuso do seu fluxo)
  const matchId = match.matchId;
  const bets = await Bet.find({
    'groupMatches.matchId': matchId,
    hasSubmitted: true,
  }).populate('user', 'name');

  for (const bet of bets) {
    // Se o modelo tem método granular, use:
    if (typeof bet.calculatePointsForMatch === 'function') {
      await bet.calculatePointsForMatch(matchId, match);
      await recomputeBetTotals(bet);
    } else if (typeof bet.calculatePoints === 'function') {
      // Fallback: recalcular passando apenas esse match
      await bet.calculatePoints([match]);
      await recomputeBetTotals(bet);
    }
  }

  if (typeof Bet.updateRanking === 'function') {
    await Bet.updateRanking();
  }
}

// =============== Rotas públicas ===============

// 📋 LISTAR TODOS OS JOGOS
router.get('/', async (req, res) => {
  try {
    const matches = await Match.find().sort({ date: 1, time: 1, matchId: 1 });
    res.json({ success: true, count: matches.length, data: matches, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Erro ao buscar jogos:', error);
    res.status(500).json({ success: false, message: 'Erro ao carregar lista de jogos' });
  }
});

// 🔍 BUSCAR JOGO POR ID (matchId numérico ou _id)
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    let match;
    if (/^\d+$/.test(id)) match = await Match.findOne({ matchId: parseInt(id) });
    else match = await Match.findById(id);

    if (!match) return res.status(404).json({ success: false, message: 'Jogo não encontrado' });
    res.json({ success: true, data: match });
  } catch (error) {
    console.error('❌ Erro ao buscar jogo:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'ID do jogo inválido' });
    }
    res.status(500).json({ success: false, message: 'Erro ao buscar jogo' });
  }
});

// 📊 ESTATÍSTICAS DOS JOGOS
router.get('/stats/summary', async (req, res) => {
  try {
    const total = await Match.countDocuments();
    const scheduled = await Match.countDocuments({ status: 'scheduled' });
    const inProgress = await Match.countDocuments({ status: 'in_progress' });
    const finished = await Match.countDocuments({ status: 'finished' });

    const nextMatches = await Match.find({ status: 'scheduled' })
      .sort({ date: 1, time: 1 })
      .limit(5)
      .select('matchId teamA teamB date time group');

    res.json({ success: true, data: { total, scheduled, inProgress, finished, nextMatches } });
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({ success: false, message: 'Erro ao carregar estatísticas' });
  }
});

// 📅 PRÓXIMOS JOGOS
router.get('/upcoming/next', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const upcoming = await Match.find({ $or: [{ status: 'scheduled' }, { status: 'in_progress' }] })
      .sort({ date: 1, time: 1 })
      .limit(limit);
    res.json({ success: true, count: upcoming.length, data: upcoming });
  } catch (error) {
    console.error('❌ Erro ao buscar próximos jogos:', error);
    res.status(500).json({ success: false, message: 'Erro ao carregar próximos jogos' });
  }
});

// 📍 JOGOS POR GRUPO
router.get('/group/:groupName', async (req, res) => {
  try {
    const groupName = req.params.groupName;
    const matches = await Match.find({ group: new RegExp(groupName, 'i') }).sort({ date: 1, time: 1 });
    res.json({ success: true, group: groupName, count: matches.length, data: matches });
  } catch (error) {
    console.error('❌ Erro ao buscar jogos por grupo:', error);
    res.status(500).json({ success: false, message: 'Erro ao carregar jogos do grupo' });
  }
});

// =============== Admin ===============

// 🎯 INICIALIZAR (dev/prod com guard)
router.post('/initialize', protect, admin, async (req, res) => {
  try {
    const existing = await Match.countDocuments();
    if (existing > 0 && process.env.NODE_ENV === 'production') {
      return res.status(400).json({ success: false, message: 'Jogos já inicializados (produção).' });
    }

    // ... (mantenha seus matches de seed aqui)
    const initialMatches = []; // coloque seus seeds se quiser

    if (existing > 0) await Match.deleteMany({});
    const created = await Match.insertMany(initialMatches);
    res.json({ success: true, message: `${created.length} jogos inicializados`, count: created.length, data: created });
  } catch (error) {
    console.error('❌ Erro ao inicializar jogos:', error);
    res.status(500).json({ success: false, message: 'Erro ao inicializar jogos' });
  }
});

// 👑 ADICIONAR PARTIDA
router.post('/admin/add', protect, admin, async (req, res) => {
  try {
    const { matchId, teamA, teamB, date, time, group, stadium = 'A definir' } = req.body;
    if (!matchId || !teamA || !teamB || !date || !time || !group) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios: matchId, teamA, teamB, date, time, group' });
    }
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return res.status(400).json({ success: false, message: 'Data inválida (DD/MM/AAAA)' });
    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ success: false, message: 'Horário inválido (HH:MM)' });

    const exists = await Match.findOne({ matchId });
    if (exists) return res.status(409).json({ success: false, message: `matchId ${matchId} já existe` });

    const newMatch = await Match.create({
      matchId,
      teamA: teamA.trim(),
      teamB: teamB.trim(),
      date,
      time,
      group: group.trim(),
      stadium: stadium.trim(),
      status: 'scheduled',
      isFinished: false,
      winner: null,
      scoreA: null,
      scoreB: null,
    });

    res.status(201).json({ success: true, message: 'Partida adicionada', data: newMatch });
  } catch (error) {
    console.error('❌ ERRO AO ADICIONAR PARTIDA:', error);
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'ID da partida já existe' });
    res.status(500).json({ success: false, message: 'Erro ao adicionar partida' });
  }
});

// 👑 EDITAR PARTIDA (agora com transição de status)
router.put('/admin/edit/:id', protect, admin, async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;

    let match;
    if (/^\d+$/.test(id)) match = await Match.findOne({ matchId: parseInt(id) });
    else match = await Match.findById(id);

    if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });

    const allowed = ['teamA', 'teamB', 'date', 'time', 'group', 'stadium', 'status', 'scoreA', 'scoreB'];
    const updateData = {};
    allowed.forEach(f => { if (updates[f] !== undefined) updateData[f] = updates[f]; });

    // Transições de status
    if (updateData.status === 'finished') {
      if (updateData.scoreA === undefined || updateData.scoreB === undefined) {
        return res.status(400).json({ success: false, message: 'Para finalizar, informe scoreA e scoreB' });
      }
      updateData.isFinished = true;
      const a = parseInt(updateData.scoreA); const b = parseInt(updateData.scoreB);
      updateData.winner = a > b ? 'teamA' : a < b ? 'teamB' : 'draw';
    }

    // Se voltar para scheduled, limpa placar e winner e zera pontos do jogo
    const goingToScheduled = updateData.status === 'scheduled' && match.status !== 'scheduled';

    const updatedMatch = await Match.findByIdAndUpdate(
      match._id,
      {
        ...updateData,
        ...(goingToScheduled ? { scoreA: null, scoreB: null, isFinished: false, winner: null } : {}),
      },
      { new: true, runValidators: true }
    );

    // Pós-processamento de pontos
    if (updateData.status === 'finished') {
      await processMatchResults(updatedMatch);
    } else if (goingToScheduled) {
      await zeroPointsForMatchAcrossBets(updatedMatch.matchId);
    }

    res.json({ success: true, message: 'Partida atualizada', data: updatedMatch });
  } catch (error) {
    console.error('❌ ERRO AO EDITAR PARTIDA:', error);
    res.status(500).json({ success: false, message: 'Erro ao editar partida' });
  }
});

// 👑 FINALIZAR PARTIDA (atalho)
router.post('/admin/finish/:id', protect, admin, async (req, res) => {
  try {
    const id = req.params.id;
    const { scoreA, scoreB } = req.body;

    if (scoreA === undefined || scoreB === undefined) {
      return res.status(400).json({ success: false, message: 'scoreA e scoreB são obrigatórios' });
    }

    let match;
    if (/^\d+$/.test(id)) match = await Match.findOne({ matchId: parseInt(id) });
    else match = await Match.findById(id);

    if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    if (match.status === 'finished') return res.status(400).json({ success: false, message: 'Partida já finalizada' });

    const a = parseInt(scoreA), b = parseInt(scoreB);
    const winner = a > b ? 'teamA' : a < b ? 'teamB' : 'draw';

    const updated = await Match.findByIdAndUpdate(
      match._id,
      { scoreA: a, scoreB: b, status: 'finished', isFinished: true, winner },
      { new: true, runValidators: true }
    );

    await processMatchResults(updated);

    res.json({
      success: true,
      message: 'Partida finalizada e pontos calculados',
      data: updated,
      stats: { result: `${a}-${b}`, winner: winner === 'draw' ? 'Empate' : updated[winner] }
    });
  } catch (error) {
    console.error('❌ ERRO AO FINALIZAR PARTIDA:', error);
    res.status(500).json({ success: false, message: 'Erro ao finalizar partida' });
  }
});

// 👑 NOVO: REABRIR/“DESFINALIZAR” PARTIDA
router.post('/admin/unfinish/:id', protect, admin, async (req, res) => {
  try {
    const id = req.params.id;

    let match;
    if (/^\d+$/.test(id)) match = await Match.findOne({ matchId: parseInt(id) });
    else match = await Match.findById(id);

    if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });

    const updated = await Match.findByIdAndUpdate(
      match._id,
      { status: 'scheduled', isFinished: false, scoreA: null, scoreB: null, winner: null },
      { new: true, runValidators: true }
    );

    await zeroPointsForMatchAcrossBets(updated.matchId);

    res.json({ success: true, message: 'Partida reaberta (status: scheduled) e pontos zerados do jogo', data: updated });
  } catch (error) {
    console.error('❌ ERRO AO REABRIR PARTIDA:', error);
    res.status(500).json({ success: false, message: 'Erro ao reabrir partida' });
  }
});

// 👑 EXCLUIR PARTIDA (agora com ?force=1)
router.delete('/admin/delete/:id', protect, admin, async (req, res) => {
  try {
    const id = req.params.id;
    const force = String(req.query.force || '') === '1';

    let match;
    if (/^\d+$/.test(id)) match = await Match.findOne({ matchId: parseInt(id) });
    else match = await Match.findById(id);

    if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });

    const betsWithThisMatch = await Bet.countDocuments({ 'groupMatches.matchId': match.matchId });

    if (betsWithThisMatch > 0 && !force) {
      return res.status(400).json({
        success: false,
        message: `Existem ${betsWithThisMatch} palpites ligados a esta partida. Use ?force=1 para excluir e zerar pontos desse jogo nos palpites.`,
      });
    }

    if (betsWithThisMatch > 0 && force) {
      await zeroPointsForMatchAcrossBets(match.matchId);
    }

    await Match.findByIdAndDelete(match._id);

    res.json({
      success: true,
      message: 'Partida excluída com sucesso',
      deletedMatch: {
        matchId: match.matchId,
        teams: `${match.teamA} vs ${match.teamB}`,
        group: match.group
      }
    });
  } catch (error) {
    console.error('❌ ERRO AO EXCLUIR PARTIDA:', error);
    res.status(500).json({ success: false, message: 'Erro ao excluir partida' });
  }
});

// 👑 ADMIN - LISTAR TODAS
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const matches = await Match.find().sort({ matchId: 1 });
    const withStats = await Promise.all(
      matches.map(async (m) => {
        const betsCount = await Bet.countDocuments({ 'groupMatches.matchId': m.matchId });
        const o = m.toObject();
        return { ...o, betsCount, hasBets: betsCount > 0, matchName: `${m.teamA} vs ${m.teamB}` };
      })
    );
    res.json({ success: true, count: withStats.length, data: withStats });
  } catch (error) {
    console.error('❌ ERRO AO LISTAR PARTIDAS ADMIN:', error);
    res.status(500).json({ success: false, message: 'Erro ao listar partidas' });
  }
});

// 🌐 TESTE
router.get('/test/hello', (req, res) => {
  res.json({
    success: true,
    message: 'Rotas de jogos OK',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET    /api/matches',
      'GET    /api/matches/:id',
      'GET    /api/matches/stats/summary',
      'GET    /api/matches/upcoming/next',
      'GET    /api/matches/group/:groupName',
      'POST   /api/matches/initialize',
      'DELETE /api/matches/admin/delete/:id?force=1',
      'POST   /api/matches/admin/add',
      'PUT    /api/matches/admin/edit/:id',
      'GET    /api/matches/admin/all',
      'POST   /api/matches/admin/finish/:id',
      'POST   /api/matches/admin/unfinish/:id'
    ]
  });
});

module.exports = router;
