// routes/bets.js
const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');

const router = express.Router();

/**
 * Utils
 */
function toWinnerLabel(choice, teamA, teamB) {
  if (choice === 'A') return teamA || 'Time A';
  if (choice === 'B') return teamB || 'Time B';
  return 'Empate';
}

/**
 * 🌐 Info
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🏆 API de Palpites do Bolão 2026',
    version: '1.0.0',
    endpoints: {
      'GET  /api/bets/my-bets': 'Meus palpites (protegido)',
      'POST /api/bets/save': 'Enviar palpites (protegido, 1x)',
      'GET  /api/bets/status': 'Status dos palpites (protegido)',
      'GET  /api/bets/leaderboard': 'Ranking (protegido)',
      'GET  /api/bets/all-bets': 'Todos os palpites, com filtros (protegido)',
      'GET  /api/bets/matches-for-filter': 'Lista de partidas p/ filtros (protegido)',
      'GET  /api/bets/users-for-filter': 'Lista de usuários p/ filtros (protegido)',
      'POST /api/bets/admin/reset-all': '⚠️ Resetar TODAS as apostas (admin)'
    }
  });
});

/**
 * 🎯 Meus palpites (enriquecidos com nomes dos times)
 */
router.get('/my-bets', protect, async (req, res) => {
  try {
    const bet = await Bet.findOne({ user: req.user._id }).lean();
    const matches = await Match.find().lean();

    if (!bet) {
      return res.json({
        success: true,
        data: null,
        hasSubmitted: false
      });
    }

    const gm = (bet.groupMatches || []).map((b) => {
      const m = matches.find(x => x.matchId === b.matchId);
      const teamA = m?.teamA || 'Time A';
      const teamB = m?.teamB || 'Time B';
      return {
        ...b,
        matchName: m ? `${m.teamA} vs ${m.teamB}` : `Jogo ${b.matchId}`,
        teamA,
        teamB,
        status: m?.status || 'scheduled',
        // rotulo amigável do palpite
        choiceLabel: toWinnerLabel(b.winner, teamA, teamB)
      };
    });

    return res.json({
      success: true,
      data: {
        ...bet,
        groupMatches: gm
      },
      hasSubmitted: !!bet.hasSubmitted
    });
  } catch (e) {
    console.error('GET /my-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar palpites' });
  }
});

/**
 * 💾 Salvar palpites (1x)
 * Espera:
 * {
 *   groupMatches: { [matchId]: 'A'|'B'|'draw', ... },
 *   podium: { first, second, third }
 * }
 */
router.post('/save', protect, async (req, res) => {
  // 🔒 Bloqueio de envio (global e por usuário)
  try {
    const Setting = require('../models/Setting');
    const globalLocked = await Setting.get('betsLocked', false);
    if (globalLocked) {
      return res.status(403).json({ success: false, message: 'Envio de palpites está temporariamente bloqueado pelo administrador.' });
    }
    const me = await User.findById(req.user._id).lean();
    if (me?.betsBlocked) {
      return res.status(403).json({ success: false, message: 'Seu envio de palpites está bloqueado pelo administrador.' });
    }
  } catch (lockErr) {
    console.error('Erro ao verificar bloqueio de apostas:', lockErr);
  }

  try {
    const { groupMatches, podium } = req.body;

    if (!groupMatches || typeof groupMatches !== 'object') {
      return res.status(400).json({ success: false, message: 'groupMatches inválido' });
    }
    if (!podium || !podium.first || !podium.second || !podium.third) {
      return res.status(400).json({ success: false, message: 'Pódio incompleto' });
    }

    const existing = await Bet.findOne({ user: req.user._id });
    if (existing && existing.hasSubmitted) {
      return res.status(409).json({
        success: false,
        message: 'Você já enviou seus palpites.'
      });
    }

    // valida choices e monta array
    const gmArray = Object.entries(groupMatches).map(([matchId, choice]) => {
      if (!['A', 'B', 'draw'].includes(choice)) {
        throw new Error(`Escolha inválida para matchId ${matchId}: ${choice}`);
      }
      return {
        matchId: Number(matchId),
        winner: choice,
        points: 0
      };
    });

    const now = new Date();
    const payload = {
      user: req.user._id,
      groupMatches: gmArray,
      podium: {
        first: String(podium.first).trim(),
        second: String(podium.second).trim(),
        third: String(podium.third).trim()
      },
      hasSubmitted: true,
      firstSubmission: existing?.firstSubmission || now,
      lastUpdate: now,
      totalPoints: 0,
      groupPoints: 0,
      podiumPoints: 0,
      bonusPoints: 0
    };

    const bet = await Bet.findOneAndUpdate(
      { user: req.user._id },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, message: 'Palpites enviados!', data: { id: bet._id } });
  } catch (e) {
    console.error('POST /save error:', e);
    if (e.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: 'Dados inválidos', errors: e.errors });
    }
    return res.status(500).json({ success: false, message: e.message || 'Erro ao salvar palpites' });
  }
});

/**
 * 🔍 Status dos palpites do usuário
 */
router.get('/status', protect, async (req, res) => {
  try {
    const bet = await Bet.findOne({ user: req.user._id }).lean();
    const status = {
      hasSubmitted: !!bet?.hasSubmitted,
      firstSubmission: bet?.firstSubmission || null,
      lastUpdate: bet?.lastUpdate || null,
      matchesCount: bet?.groupMatches?.length || 0,
      hasPodium: !!(bet?.podium?.first && bet?.podium?.second && bet?.podium?.third)
    };
    res.json({ success: true, data: status });
  } catch (e) {
    console.error('GET /status error:', e);
    res.status(500).json({ success: false, message: 'Erro ao verificar status' });
  }
});

/**
 * 🏆 Leaderboard
 * (Somente ordena por totalPoints desc; cálculo dos pontos é feito em outros fluxos)
 */
router.get('/leaderboard', protect, async (req, res) => {
  try {
    const bets = await Bet.find({ hasSubmitted: true })
      .populate('user', 'name')
      .select('user totalPoints groupPoints podiumPoints bonusPoints lastUpdate podium')
      .sort({ totalPoints: -1, lastUpdate: 1 })
      .lean();

    const ranked = bets.map((b, i) => ({
      position: i + 1,
      user: b.user, // { _id, name }
      totalPoints: b.totalPoints || 0,
      groupPoints: b.groupPoints || 0,
      podiumPoints: b.podiumPoints || 0,
      bonusPoints: b.bonusPoints || 0,
      podium: b.podium || null,
      lastUpdate: b.lastUpdate
    }));

    res.json({ success: true, data: ranked, count: ranked.length });
  } catch (e) {
    console.error('GET /leaderboard error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar ranking' });
  }
});

/**
 * 👁️ Todos os palpites (com filtros)
 * Query:
 *  - search: nome do usuário (regex)
 *  - matchId: filtra por partida; ao usar, SOMENTE os palpites dessa partida são retornados por usuário
 *  - group: nome do grupo (ex: "Grupo A") -> filtra usuários que tenham palpites em partidas desse grupo
 *  - sortBy: 'user' | 'points' | 'date'
 */
router.get('/all-bets', protect, async (req, res) => {
  try {
    const { search, matchId, group, sortBy = 'user' } = req.query;

    // Base query
    let query = { hasSubmitted: true };

    // Filtro por usuário (nome)
    if (search) {
      const users = await User.find({ name: { $regex: search, $options: 'i' } }).select('_id').lean();
      query.user = { $in: users.map(u => u._id) };
    }

    // Se grupo informado, limita matchIds ao grupo
    let groupMatchIds = null;
    if (group) {
      const matchesInGroup = await Match.find({ group: { $regex: group, $options: 'i' } })
        .select('matchId')
        .lean();
      groupMatchIds = matchesInGroup.map(m => m.matchId);
      if (groupMatchIds.length > 0) {
        query['groupMatches.matchId'] = { $in: groupMatchIds };
      } else {
        // nenhum jogo naquele grupo -> resultado vazio
        return res.json({ success: true, data: [], stats: { totalBets: 0, totalUsers: 0, totalMatches: 0 } });
      }
    }

    // Se matchId informado, filtra por ele na query
    const matchIdNum = matchId ? Number(matchId) : null;
    if (matchIdNum) {
      query['groupMatches.matchId'] = matchIdNum;
    }

    // Busca apostas
    let betsQuery = Bet.find(query)
      .populate('user', 'name')
      .select('user groupMatches podium totalPoints groupPoints podiumPoints firstSubmission lastUpdate')
      .lean();

    // Ordenação
    if (sortBy === 'user') betsQuery = betsQuery.sort('user.name');
    else if (sortBy === 'points') betsQuery = betsQuery.sort('-totalPoints');
    else if (sortBy === 'date') betsQuery = betsQuery.sort('-firstSubmission');

    const bets = await betsQuery;
    const matches = await Match.find().lean();

    // Enriquecer + aplicar regra: se matchId foi passado, retorna apenas os palpites daquela partida em cada usuário
    const enriched = bets.map(b => {
      // filtra matches por grupo (se aplicável) e por matchId (se aplicável)
      let gm = b.groupMatches || [];
      if (groupMatchIds) {
        gm = gm.filter(x => groupMatchIds.includes(x.matchId));
      }
      if (matchIdNum) {
        gm = gm.filter(x => x.matchId === matchIdNum);
      }

      const viewBets = gm.map(g => {
        const m = matches.find(x => x.matchId === g.matchId);
        const teamA = m?.teamA || 'Time A';
        const teamB = m?.teamB || 'Time B';
        return {
          matchId: g.matchId,
          choice: g.winner,                // 'A' | 'B' | 'draw' (armazenado)
          choiceLabel: toWinnerLabel(g.winner, teamA, teamB), // rótulo amigável
          matchName: m ? `${m.teamA} vs ${m.teamB}` : `Jogo ${g.matchId}`,
          teamA,
          teamB,
          status: m?.status || 'scheduled'
        };
      });

      return {
        userName: b.user?.name || 'Usuário',
        podium: b.podium || null,
        totalPoints: b.totalPoints || 0,
        bets: viewBets
      };
    });

    const stats = {
      totalBets: enriched.length,
      totalUsers: new Set(enriched.map(e => e.userName)).size,
      totalMatches: new Set(enriched.flatMap(e => e.bets.map(x => x.matchId))).size
    };

    res.json({ success: true, data: enriched, stats, searchParams: { search, matchId, group, sortBy } });
  } catch (e) {
    console.error('GET /all-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar apostas' });
  }
});

/**
 * 🔍 Partidas para filtro
 */
router.get('/matches-for-filter', protect, async (req, res) => {
  try {
    const matches = await Match.find().select('matchId teamA teamB group date').sort('matchId').lean();
    res.json({ success: true, data: matches });
  } catch (e) {
    console.error('GET /matches-for-filter error:', e);
    res.status(500).json({ success: false, message: 'Erro ao buscar partidas' });
  }
});

/**
 * 👥 Usuários para filtro
 */
router.get('/users-for-filter', protect, async (req, res) => {
  try {
    const users = await User.find().select('_id name').sort('name').lean();
    res.json({ success: true, data: users });
  } catch (e) {
    console.error('GET /users-for-filter error:', e);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários' });
  }
});

/**
 * ⚠️ Admin: resetar TODAS as apostas
 */
router.post('/admin/reset-all', protect, admin, async (req, res) => {
  try {
    const result = await Bet.deleteMany({});
    return res.json({
      success: true,
      message: 'Apostas resetadas com sucesso.',
      deletedCount: result.deletedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('POST /admin/reset-all error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao resetar apostas' });
  }
});

module.exports = router;
