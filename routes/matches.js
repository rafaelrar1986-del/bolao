const express = require('express');
const Match = require('../models/Match');
const Bet = require('../models/Bet');
const { protect, admin } = require('../middleware/auth');
const router = express.Router();

// ======================
// 📋 LISTAR TODOS OS JOGOS
// ======================
router.get('/', async (req, res) => {
  try {
    const matches = await Match.find().sort({ date: 1, time: 1, matchId: 1 });
    res.json({
      success: true,
      count: matches.length,
      data: matches,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erro ao buscar jogos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar lista de jogos'
    });
  }
});

// ======================
// 🔍 BUSCAR JOGO POR ID (matchId numérico ou _id do Mongo)
// ======================
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    let match;

    if (/^\d+$/.test(id)) {
      match = await Match.findOne({ matchId: parseInt(id, 10) });
    } else {
      match = await Match.findById(id);
    }

    if (!match) {
      return res.status(404).json({ success: false, message: 'Jogo não encontrado' });
    }

    res.json({ success: true, data: match });
  } catch (error) {
    console.error('❌ Erro ao buscar jogo:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }
    res.status(500).json({ success: false, message: 'Erro ao buscar jogo' });
  }
});

// ======================
// 📊 ESTATÍSTICAS DOS JOGOS
// ======================
router.get('/stats/summary', async (req, res) => {
  try {
    const total = await Match.countDocuments();
    const scheduled = await Match.countDocuments({ status: 'scheduled' });
    const inProgress = await Match.countDocuments({ status: 'in_progress' });
    const finished = await Match.countDocuments({ status: 'finished' });

    const nextMatches = await Match.find({ status: { $in: ['scheduled', 'in_progress'] } })
      .sort({ date: 1, time: 1 })
      .limit(5)
      .select('matchId teamA teamB date time group status');

    res.json({
      success: true,
      data: { total, scheduled, inProgress, finished, nextMatches }
    });
  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({ success: false, message: 'Erro ao carregar estatísticas' });
  }
});

// ======================
// 📅 PRÓXIMOS JOGOS
// ======================
router.get('/upcoming/next', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 5;
    const upcoming = await Match.find({
      status: { $in: ['scheduled', 'in_progress'] }
    })
      .sort({ date: 1, time: 1 })
      .limit(limit);

    res.json({ success: true, count: upcoming.length, data: upcoming });
  } catch (error) {
    console.error('❌ Erro ao buscar próximos jogos:', error);
    res.status(500).json({ success: false, message: 'Erro ao carregar próximos jogos' });
  }
});

// ======================
// 📍 JOGOS POR GRUPO
// ======================
router.get('/group/:groupName', async (req, res) => {
  try {
    const groupName = req.params.groupName;
    const matches = await Match.find({
      group: new RegExp(groupName, 'i')
    }).sort({ date: 1, time: 1 });

    res.json({ success: true, group: groupName, count: matches.length, data: matches });
  } catch (error) {
    console.error('❌ Erro ao buscar jogos por grupo:', error);
    res.status(500).json({ success: false, message: 'Erro ao carregar jogos do grupo' });
  }
});

// ======================
// 🎯 INICIALIZAR JOGOS (APENAS ADMIN/DESENVOLVIMENTO)
// ======================
router.post('/initialize', protect, admin, async (req, res) => {
  try {
    const existing = await Match.countDocuments();
    if (existing > 0 && process.env.NODE_ENV === 'production') {
      return res.status(400).json({
        success: false,
        message: 'Jogos já inicializados. Use reset apenas em desenvolvimento.'
      });
    }

    // Exemplo minimalista — ajuste sua lista conforme quiser
    const initialMatches = [
      { matchId: 1, teamA: 'Brasil', teamB: 'Croácia', date: '13/06/2026', time: '16:00', group: 'Grupo A', stadium: 'Maracanã', status: 'scheduled' },
      { matchId: 2, teamA: 'Alemanha', teamB: 'Japão', date: '14/06/2026', time: '13:00', group: 'Grupo A', stadium: 'Allianz Arena', status: 'scheduled' },
      { matchId: 3, teamA: 'Argentina', teamB: 'Holanda', date: '14/06/2026', time: '16:00', group: 'Grupo B', stadium: 'La Bombonera', status: 'scheduled' }
    ];

    if (existing > 0) await Match.deleteMany({});

    const created = await Match.insertMany(initialMatches);
    res.json({
      success: true,
      message: `${created.length} jogos inicializados`,
      count: created.length,
      data: created
    });
  } catch (error) {
    console.error('❌ Erro ao inicializar jogos:', error);
    res.status(500).json({ success: false, message: 'Erro ao inicializar jogos' });
  }
});

// ======================
// 🔄 RESETAR JOGOS (APENAS DESENVOLVIMENTO)
// ======================
router.delete('/reset', protect, admin, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Reset não permitido em produção' });
    }
    const deleted = await Match.deleteMany({});
    res.json({
      success: true,
      message: `${deleted.deletedCount} jogos removidos`,
      count: deleted.deletedCount
    });
  } catch (error) {
    console.error('❌ Erro ao resetar jogos:', error);
    res.status(500).json({ success: false, message: 'Erro ao resetar jogos' });
  }
});

// ======================
// 👑 ADMIN - LISTAR TODAS AS PARTIDAS (com contagem de palpites)
// ======================
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const matches = await Match.find().sort({ matchId: 1 });

    const withStats = await Promise.all(
      matches.map(async (m) => {
        const betsCount = await Bet.countDocuments({ 'groupMatches.matchId': m.matchId });
        const obj = m.toObject();
        return { ...obj, betsCount, hasBets: betsCount > 0, matchName: `${m.teamA} vs ${m.teamB}` };
    }));

    res.json({ success: true, count: withStats.length, data: withStats });
  } catch (error) {
    console.error('❌ Erro ao listar partidas admin:', error);
    res.status(500).json({ success: false, message: 'Erro ao listar partidas' });
  }
});

// ======================
// 👑 ADMIN - ADICIONAR PARTIDA
// ======================
router.post('/admin/add', protect, admin, async (req, res) => {
  try {
    const { matchId, teamA, teamB, date, time, group, stadium = '' } = req.body;

    if (!matchId || !teamA || !teamB || !date || !time || !group) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios: matchId, teamA, teamB, date, time, group' });
    }

    const exists = await Match.findOne({ matchId });
    if (exists) return res.status(409).json({ success: false, message: `Já existe uma partida com ID ${matchId}` });

    const created = await Match.create({
      matchId,
      teamA: teamA.trim(),
      teamB: teamB.trim(),
      date,
      time,
      group: group.trim(),
      stadium: stadium.trim(),
      status: 'scheduled'
    });

    res.status(201).json({ success: true, message: 'Partida adicionada', data: created });
  } catch (error) {
    console.error('❌ Erro ao adicionar partida:', error);
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'ID da partida já existe' });
    res.status(500).json({ success: false, message: 'Erro ao adicionar partida' });
  }
});

// ======================
// 👑 ADMIN - EDITAR PARTIDA
// ======================
router.put('/admin/edit/:id', protect, admin, async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;

    let match = /^\d+$/.test(id)
      ? await Match.findOne({ matchId: parseInt(id, 10) })
      : await Match.findById(id);

    if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });

    const allowed = ['teamA', 'teamB', 'date', 'time', 'group', 'stadium', 'status', 'scoreA', 'scoreB'];
    const set = {};
    allowed.forEach((k) => { if (updates[k] !== undefined) set[k] = updates[k]; });

    // Se status voltar a não-finalizado, limpar placar
    if (set.status && set.status !== 'finished') {
      set.scoreA = null;
      set.scoreB = null;
    }

    const updated = await Match.findByIdAndUpdate(match._id, set, { new: true, runValidators: true });

    // Se finalizou via edição, recalcular tudo
    if (updated.status === 'finished') {
      const finishedMatches = await Match.find({ status: 'finished' });
      await Bet.recalculateAllPoints(finishedMatches);
      await Bet.updateRanking();
    }

    res.json({ success: true, message: 'Partida atualizada', data: updated });
  } catch (error) {
    console.error('❌ Erro ao editar partida:', error);
    res.status(500).json({ success: false, message: 'Erro ao editar partida' });
  }
});

// ======================
// 👑 ADMIN - FINALIZAR PARTIDA
// ======================
router.post('/admin/finish/:id', protect, admin, async (req, res) => {
  try {
    const id = req.params.id;
    const { scoreA, scoreB } = req.body;
    if (scoreA === undefined || scoreB === undefined) {
      return res.status(400).json({ success: false, message: 'scoreA e scoreB são obrigatórios' });
    }

    let match;
    if (/^\d+$/.test(id)) {
      match = await Match.findOne({ matchId: parseInt(id, 10) });
      if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });
      await Match.finishMatch(match.matchId, scoreA, scoreB);
    } else {
      match = await Match.findById(id);
      if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });
      await Match.finishMatch(match.matchId, scoreA, scoreB);
    }

    // Recalcular todos os pontos com base nas partidas finalizadas
    const finishedMatches = await Match.find({ status: 'finished' });
    await Bet.recalculateAllPoints(finishedMatches);
    await Bet.updateRanking();

    const updated = await Match.findOne({ matchId: match.matchId });
    res.json({
      success: true,
      message: 'Partida finalizada e pontos recalculados',
      data: updated
    });
  } catch (error) {
    console.error('❌ Erro ao finalizar partida:', error);
    res.status(500).json({ success: false, message: 'Erro ao finalizar partida' });
  }
});

// ======================
// 👑 ADMIN - REABRIR (UNFINISH) PARTIDA
// ======================
router.post('/admin/unfinish/:id', protect, admin, async (req, res) => {
  try {
    const id = req.params.id;
    let match;

    if (/^\d+$/.test(id)) {
      match = await Match.findOne({ matchId: parseInt(id, 10) });
    } else {
      match = await Match.findById(id);
    }
    if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });

    await Match.unfinishMatch(match.matchId, 'scheduled');

    // Opcional: zerar pontos do jogo reaberto antes de recalc (para consistência visual)
    await Bet.updateMany(
      { 'groupMatches.matchId': match.matchId },
      { $set: { 'groupMatches.$[elem].points': 0 } },
      { arrayFilters: [{ 'elem.matchId': match.matchId }] }
    );

    // Recalcular com base nas partidas finalizadas restantes
    const finishedMatches = await Match.find({ status: 'finished' });
    await Bet.recalculateAllPoints(finishedMatches);
    await Bet.updateRanking();

    const updated = await Match.findOne({ matchId: match.matchId });
    res.json({
      success: true,
      message: 'Partida reaberta; placar limpo e pontos recalculados',
      data: updated
    });
  } catch (error) {
    console.error('❌ Erro ao reabrir partida:', error);
    res.status(500).json({ success: false, message: 'Erro ao reabrir partida' });
  }
});

// ======================
// 👑 ADMIN - EXCLUIR PARTIDA (com ?force=1 para forçar)
// ======================
router.delete('/admin/delete/:id', protect, admin, async (req, res) => {
  try {
    const id = req.params.id;
    const force = String(req.query.force || '').trim() === '1';

    let match = /^\d+$/.test(id)
      ? await Match.findOne({ matchId: parseInt(id, 10) })
      : await Match.findById(id);

    if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });

    const betsWithThisMatch = await Bet.countDocuments({ 'groupMatches.matchId': match.matchId });

    if (!force && betsWithThisMatch > 0) {
      return res.status(400).json({
        success: false,
        message: `Não é possível excluir: existem ${betsWithThisMatch} palpites associados. Use ?force=1 para forçar.`
      });
    }

    // Se forçar: remover a partida e limpar esse jogo dos palpites
    if (force) {
      // Remove o jogo dos arrays de palpites
      await Bet.updateMany(
        { 'groupMatches.matchId': match.matchId },
        { $pull: { groupMatches: { matchId: match.matchId } } }
      );
    }

    // Excluir a partida
    await Match.deleteByMatchId(match.matchId);

    // Recalcular pontos (agora sem esse jogo)
    const finishedMatches = await Match.find({ status: 'finished' });
    await Bet.recalculateAllPoints(finishedMatches);
    await Bet.updateRanking();

    res.json({
      success: true,
      message: `Partida ${match.matchId} excluída${force ? ' (forçado)' : ''}`,
      deletedMatch: {
        matchId: match.matchId,
        teams: `${match.teamA} vs ${match.teamB}`,
        group: match.group
      }
    });
  } catch (error) {
    console.error('❌ Erro ao excluir partida:', error);
    res.status(500).json({ success: false, message: 'Erro ao excluir partida' });
  }
});

// ======================
// 🌐 ROTA DE STATUS/TESTE
// ======================
router.get('/test/hello', (req, res) => {
  res.json({
    success: true,
    message: 'Rotas de jogos funcionando!',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET    /api/matches',
      'GET    /api/matches/:id',
      'GET    /api/matches/stats/summary',
      'GET    /api/matches/upcoming/next',
      'GET    /api/matches/group/:groupName',
      'POST   /api/matches/initialize',
      'DELETE /api/matches/reset',
      'GET    /api/matches/admin/all',
      'POST   /api/matches/admin/add',
      'PUT    /api/matches/admin/edit/:id',
      'POST   /api/matches/admin/finish/:id',
      'POST   /api/matches/admin/unfinish/:id',
      'DELETE /api/matches/admin/delete/:id?force=1',
      'GET    /api/matches/test/hello'
    ]
  });
});

module.exports = router;
