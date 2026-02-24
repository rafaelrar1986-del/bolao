// routes/bets.js

const express = require('express');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');
const Match = require('../models/Match');
const User = require('../models/User');
const Settings = require('../models/Settings'); // Importado para uso no all-bets
const { protect, admin } = require('../middleware/auth');
const { blockStatsIfLocked } = require('../middleware/blockStats');

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
 * 💾 Salvar palpites
 */
router.post('/save', protect, async (req, res) => {
  try {
    const { groupMatches, podium, knockoutQualifiers } = req.body;
    
    if (!groupMatches || typeof groupMatches !== 'object') {
      return res.status(400).json({ success: false, message: 'groupMatches inválido' });
    }

    const existing = await Bet.findOne({ user: req.user._id });

    let podiumPayload;
    const hasExistingPodium =
      existing &&
      existing.podium &&
      existing.podium.first &&
      existing.podium.second &&
      existing.podium.third;

    if (hasExistingPodium) {
      podiumPayload = {
        first: existing.podium.first,
        second: existing.podium.second,
        third: existing.podium.third,
        fourth: existing.podium.fourth || ''
      };
    } else {
      if (!podium || !podium.first || !podium.second || !podium.third) {
        return res.status(400).json({ success: false, message: 'Pódio incompleto' });
      }
      podiumPayload = {
        first: String(podium.first).trim(),
        second: String(podium.second).trim(),
        third: String(podium.third).trim(),
        fourth: podium.fourth ? String(podium.fourth).trim() : ''
      };
    }

    const gmMap = new Map();
    if (existing && Array.isArray(existing.groupMatches)) {
      existing.groupMatches.forEach((b) => {
        if (!b || typeof b.matchId !== 'number') return;
        gmMap.set(b.matchId, {
          matchId: b.matchId,
          winner: b.winner,
          points: b.points || 0,
          qualifier: b.qualifier || null,
          qualifierPoints: b.qualifierPoints || 0
        });
      });
    }

    Object.entries(groupMatches).forEach(([matchId, choice]) => {
      if (!['A', 'B', 'draw'].includes(choice)) return;
      const idNum = Number(matchId);
      if (!idNum) return;

      const existingBet = gmMap.get(idNum);
      if (existingBet) {
        if (existingBet.winner !== choice) return;
        if (knockoutQualifiers && Object.prototype.hasOwnProperty.call(knockoutQualifiers, String(idNum))) {
          const qExisting = knockoutQualifiers[String(idNum)];
          if (qExisting === 'A' || qExisting === 'B') existingBet.qualifier = qExisting;
        }
        gmMap.set(idNum, existingBet);
        return;
      }

      let qualifier = null;
      if (knockoutQualifiers && Object.prototype.hasOwnProperty.call(knockoutQualifiers, String(idNum))) {
        const qNew = knockoutQualifiers[String(idNum)];
        if (qNew === 'A' || qNew === 'B') qualifier = qNew;
      }

      gmMap.set(idNum, {
        matchId: idNum,
        winner: choice,
        points: 0,
        qualifier,
        qualifierPoints: 0
      });
    });

    const gmArray = Array.from(gmMap.values());
    const now = new Date();
    const payload = {
      user: req.user._id,
      groupMatches: gmArray,
      podium: podiumPayload,
      hasSubmitted: true,
      firstSubmission: existing?.firstSubmission || now,
      lastUpdate: now,
      totalPoints: existing?.totalPoints ?? 0,
      groupPoints: existing?.groupPoints ?? 0,
      podiumPoints: existing?.podiumPoints ?? 0,
      bonusPoints: existing?.bonusPoints ?? 0
    };

    const bet = await Bet.findOneAndUpdate(
      { user: req.user._id },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, message: 'Palpites enviados!', data: { id: bet._id } });
  } catch (e) {
    console.error('POST /save error:', e);
    return res.status(500).json({ success: false, message: 'Erro ao salvar palpites' });
  }
});

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
    res.status(500).json({ success: false, message: 'Erro ao verificar status' });
  }
});

/**
 * 🏆 Leaderboard
 */
router.get('/leaderboard', protect, blockStatsIfLocked, async (req, res) => {
  try {
    const bets = await Bet.find({ hasSubmitted: true })
      .populate('user', 'name')
      .select('user totalPoints groupPoints podiumPoints bonusPoints lastUpdate podium groupMatches')
      .sort({ totalPoints: -1 })
      .lean();

    const matches = await Match.find().select('matchId phase').lean();
    const matchPhaseMap = new Map(matches.map(m => [m.matchId, m.phase]));

    let lastPoints = null;
    let position = 0;
    let realIndex = 0;

    const ranked = bets.map((b) => {
      realIndex++;
      if (lastPoints === null || b.totalPoints !== lastPoints) {
        position = realIndex;
        lastPoints = b.totalPoints;
      }

      const groupPhasePoints = (b.groupMatches || []).reduce((sum, gm) => {
        const phase = matchPhaseMap.get(gm.matchId);
        return phase === 'group' ? sum + (gm.points || 0) : sum;
      }, 0);

      const knockoutPoints = (b.groupMatches || []).reduce((sum, gm) => {
        const phase = matchPhaseMap.get(gm.matchId);
        return phase === 'knockout' ? sum + (gm.points || 0) : sum;
      }, 0);

      return {
        position,
        user: b.user,
        totalPoints: b.totalPoints || 0,
        groupPhasePoints,
        knockoutPoints,
        podiumPoints: b.podiumPoints || 0,
        bonusPoints: b.bonusPoints || 0,
        podium: b.podium || null,
        lastUpdate: b.lastUpdate
      };
    });

    res.json({ success: true, data: ranked, count: ranked.length });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erro ao carregar ranking' });
  }
});

/**
 * 👁️ Todos os palpites (com filtros) - CORRIGIDO PARA TRAVAS POR FASE
 */
router.get('/all-bets', protect, blockStatsIfLocked, async (req, res) => {
  try {
    const { search, matchId, group, sortBy = 'user' } = req.query;
    const isAdmin = req.user?.isAdmin === true;

    // 1. Busca configurações e partidas (select include 'group')
    const settings = await Settings.findById('global_settings').lean();
    const unlockedPhases = settings?.unlockedPhases || [];
    const matches = await Match.find().lean();

    let query = { hasSubmitted: true };

    if (search) {
      const users = await User.find({ name: { $regex: search, $options: 'i' } }).select('_id').lean();
      query.user = { $in: users.map(u => u._id) };
    }

    let groupMatchIds = null;
    if (group) {
      const matchesInGroup = await Match.find({ group: { $regex: group, $options: 'i' } }).select('matchId').lean();
      groupMatchIds = matchesInGroup.map(m => m.matchId);
      if (groupMatchIds.length > 0) {
        query['groupMatches.matchId'] = { $in: groupMatchIds };
      } else {
        return res.json({ success: true, data: [], stats: { totalBets: 0, totalUsers: 0, totalMatches: 0 } });
      }
    }

    const matchIdNum = matchId ? Number(matchId) : null;
    if (matchIdNum) query['groupMatches.matchId'] = matchIdNum;

    let betsQuery = Bet.find(query)
      .populate('user', 'name')
      .select('user groupMatches podium totalPoints groupPoints podiumPoints firstSubmission lastUpdate')
      .lean();

    if (sortBy === 'user') betsQuery = betsQuery.sort('user.name');
    else if (sortBy === 'points') betsQuery = betsQuery.sort('-totalPoints');
    else if (sortBy === 'date') betsQuery = betsQuery.sort('-firstSubmission');

    const bets = await betsQuery;

    // 2. ENRIQUECER + APLICAR TRAVA DINÂMICA
    const enriched = bets.map(b => {
      let gm = b.groupMatches || [];
      if (groupMatchIds) gm = gm.filter(x => groupMatchIds.includes(x.matchId));
      if (matchIdNum) gm = gm.filter(x => x.matchId === matchIdNum);

      const viewBets = gm.map(g => {
        const m = matches.find(x => x.matchId === g.matchId);
        const teamA = m?.teamA || 'Time A';
        const teamB = m?.teamB || 'Time B';
        
        // --- LÓGICA DE BLOQUEIO CORRIGIDA ---
        let isLocked = !isAdmin;
        if (!isLocked) {
            // Admin nunca está bloqueado
        } else if (m?.phase === 'group') {
            // Se for fase de grupo, checa se 'group' está na lista
            isLocked = !unlockedPhases.includes('group');
        } else if (m?.phase === 'knockout') {
            // Se for mata-mata, checa se o valor do campo group (ex: '16-avos final') está na lista
            isLocked = !unlockedPhases.includes(m.group);
        }
        // ------------------------------------

        return {
          matchId: g.matchId,
          choice: isLocked ? '🔒' : g.winner,
          qualifier: isLocked ? (g.qualifier ? '🔒' : null) : g.qualifier,
          choiceLabel: isLocked ? 'Bloqueado' : toWinnerLabel(g.winner, teamA, teamB),
          matchName: m ? `${m.teamA} vs ${m.teamB}` : `Jogo ${g.matchId}`,
          teamA,
          teamB,
          status: m?.status || 'scheduled'
        };
      });

      return {
        userName: b.user?.name || 'Usuário',
        // Bloqueia pódio se 'final' não estiver liberado
        podium: (isAdmin || unlockedPhases.includes('final')) ? b.podium : { first: '🔒', second: '🔒', third: '🔒', fourth: '🔒' },
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
router.get('/matches-for-filter', protect, blockStatsIfLocked, async (req, res) => {
  try {
    const matches = await Match.find().select('matchId teamA teamB group date').sort('matchId').lean();
    res.json({ success: true, data: matches });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erro ao buscar partidas' });
  }
});

/**
 * 👥 Usuários para filtro
 */
router.get('/users-for-filter', protect, blockStatsIfLocked, async (req, res) => {
  try {
    const users = await User.find().select('_id name').sort('name').lean();
    res.json({ success: true, data: users });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários' });
  }
});

/**
 * ⚠️ Admin: resetar TODAS as apostas
 */
router.post('/admin/reset-all', protect, admin, async (req, res) => {
  try {
    const betsResult = await Bet.deleteMany({});
    const historyResult = await PointsHistory.deleteMany({});
    return res.json({
      success: true,
      message: 'Apostas e histórico de pontos resetados.',
      deleted: { bets: betsResult.deletedCount, pointHistory: historyResult.deletedCount }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao resetar dados' });
  }
});

/**
 * 🏆 Admin: resetar SOMENTE o pódio oficial
 */
router.post('/admin/reset-podium', protect, admin, async (req, res) => {
  try {
    const result = await Bet.updateMany({}, {
      $set: {
        'podium.first': null, 'podium.second': null, 'podium.third': null, 'podium.fourth': null,
        podiumPoints: 0
      }
    });
    return res.json({ success: true, message: 'Pódio oficial resetado', modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao resetar pódio' });
  }
});

// 🔐 PERMISSÃO PARA MENU "MORE"
router.get('/more-access', protect, async (req, res) => {
  try {
    const isAdminUser = req.user?.isAdmin === true || req.user?.role === 'admin';
    if (isAdminUser) return res.json({ success: true, canAccessMore: true });
    const hasBets = await Bet.exists({ user: req.user._id, hasSubmitted: true });
    res.json({ success: true, canAccessMore: !!hasBets });
  } catch (err) {
    res.status(500).json({ success: false, canAccessMore: false });
  }
});

module.exports = router;
