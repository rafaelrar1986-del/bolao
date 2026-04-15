// routes/bets.js
const express = require('express');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');
const Match = require('../models/Match');
const User = require('../models/User');
const Settings = require('../models/Settings'); 
const { protect, admin, checkPaid } = require('../middleware/auth');
const { blockStatsIfLocked } = require('../middleware/blockStats');

const router = express.Router();

/**
 * Utils
 */
function toWinnerLabel(choice, teamA, teamB) {
  if (choice === 'A') return teamA || 'Time A';
  if (choice === 'B') return teamB || 'Time B';
  if (choice === 'draw') return 'Empate';
  return '-';
}

/**
 * 🌐 Info
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🏆 API de Palpites Multicampeonato',
    version: '2.0.0',
    endpoints: {
      'GET  /api/bets/my-bets?leagueId=X': 'Meus palpites por liga',
      'POST /api/bets/save': 'Enviar palpites (incluindo leagueId)',
      'GET  /api/bets/leaderboard?leagueId=X': 'Ranking específico por liga',
    }
  });
});

/**
 * 🎯 Meus palpites (Filtrado por Liga)
 */
router.get('/my-bets', protect, checkPaid, async (req, res) => {
  try {
    const { leagueId } = req.query;
    if (!leagueId) return res.status(400).json({ success: false, message: 'ID da liga é obrigatório' });

    const [bet, matches] = await Promise.all([
      Bet.findOne({ user: req.user._id }).lean(),
      Match.find({ leagueId: Number(leagueId) }).lean()
    ]);

    if (!bet) {
      return res.json({ success: true, data: null, hasSubmitted: false });
    }

    const matchIdsDaLiga = matches.map(m => m.matchId);
    const gm = (bet.groupMatches || [])
      .filter(b => matchIdsDaLiga.includes(b.matchId))
      .map((b) => {
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
      data: { ...bet, groupMatches: gm },
      hasSubmitted: gm.length > 0
    });
  } catch (e) {
    console.error('GET /my-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar palpites' });
  }
});

/**
 * 💾 Salvar palpites
 */
router.post('/save', protect, checkPaid, async (req, res) => {
  try {
    const { groupMatches, podium, knockoutQualifiers, leagueId } = req.body;
    
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });
    if (!groupMatches || typeof groupMatches !== 'object') {
      return res.status(400).json({ success: false, message: 'groupMatches inválido' });
    }

    const matchIdsEnviados = Object.keys(groupMatches).map(Number);
    
    const dbMatches = await Match.find({ 
      matchId: { $in: matchIdsEnviados }, 
      leagueId: Number(leagueId) 
    }).select('matchId').lean();

    const validMatchIds = new Set(dbMatches.map(m => m.matchId));
    const existing = await Bet.findOne({ user: req.user._id });
    const gmMap = new Map();

    if (existing && Array.isArray(existing.groupMatches)) {
      existing.groupMatches.forEach((b) => {
        gmMap.set(b.matchId, b);
      });
    }

    Object.entries(groupMatches).forEach(([matchId, choice]) => {
      const idNum = Number(matchId);
      if (!validMatchIds.has(idNum)) return; 
      if (!['A', 'B', 'draw'].includes(choice)) return;

      let qualifier = null;
      if (knockoutQualifiers && knockoutQualifiers[matchId]) {
        const q = knockoutQualifiers[matchId];
        if (q === 'A' || q === 'B') qualifier = q;
      }

      gmMap.set(idNum, {
        matchId: idNum,
        winner: choice,
        points: gmMap.get(idNum)?.points || 0,
        qualifier,
        qualifierPoints: gmMap.get(idNum)?.qualifierPoints || 0
      });
    });

    const now = new Date();
    const payload = {
      user: req.user._id,
      leagueId: Number(leagueId), 
      groupMatches: Array.from(gmMap.values()),
      hasSubmitted: true,
      lastUpdate: now,
      firstSubmission: existing?.firstSubmission || now,
    };

    if (podium && podium.first) {
      payload.podium = {
        first: String(podium.first).trim(),
        second: String(podium.second).trim(),
        third: String(podium.third).trim(),
        fourth: podium.fourth ? String(podium.fourth).trim() : ''
      };
    }

    const bet = await Bet.findOneAndUpdate(
      { user: req.user._id },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, message: 'Palpites salvos com sucesso!', data: { id: bet._id } });
  } catch (e) {
    console.error('POST /save error:', e);
    return res.status(500).json({ success: false, message: 'Erro ao salvar palpites' });
  }
});

/**
 * 🏆 Leaderboard (Otimizado com leagueId)
 */
router.get('/leaderboard', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { type, leagueId } = req.query;
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });

    const isPartial = type === 'partial';
    const lId = Number(leagueId);

    const [matches, bets] = await Promise.all([
      Match.find({ leagueId: lId }).select('matchId status scoreA scoreB phase qualifiedSide').lean(),
      Bet.find({ hasSubmitted: true, leagueId: lId }).populate('user', 'name avatar').lean()
    ]);

    const matchMap = new Map(matches.map(m => [m.matchId, m]));
    const getWinner = (a, b) => {
      if (a === null || b === null) return null;
      if (a > b) return 'A';
      if (b > a) return 'B';
      return 'draw';
    };

    const ranked = bets.map((b) => {
      let totalPoints = 0;
      let groupPhasePoints = 0;
      let knockoutPoints = 0;

      (b.groupMatches || []).forEach(gm => {
        const m = matchMap.get(gm.matchId);
        if (!m || m.status === 'scheduled') return;

        const realWinner = getWinner(m.scoreA, m.scoreB);
        if (realWinner && gm.winner === realWinner) {
          totalPoints += 1;
          if (m.phase === 'group') groupPhasePoints += 1;
          else knockoutPoints += 1;
        }

        const realQual = m.qualifiedSide || (realWinner !== 'draw' ? realWinner : null);
        if (gm.qualifier && realQual && gm.qualifier === realQual) {
          totalPoints += 1;
          knockoutPoints += 1;
        }
      });

      return {
        user: b.user,
        totalPoints: totalPoints + (b.bonusPoints || 0),
        groupPhasePoints,
        knockoutPoints,
        lastUpdate: b.lastUpdate
      };
    });

    ranked.sort((a, b) => b.totalPoints - a.totalPoints || (a.user?.name || "").localeCompare(b.user?.name || ""));

    let lastPoints = null;
    let position = 0;
    const finalData = ranked.map((item, index) => {
      if (lastPoints === null || item.totalPoints !== lastPoints) {
        position = index + 1;
        lastPoints = item.totalPoints;
      }
      return { ...item, position };
    });

    res.json({ success: true, data: finalData, isPartial, leagueId: lId });
  } catch (e) {
    console.error('Leaderboard Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao processar ranking' });
  }
});

/**
 * 👁️ Todos os palpites (CORRIGIDO PARA STATS.JS)
 */
router.get('/all-bets', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { search, matchId, group, leagueId } = req.query;
    const isAdmin = req.user?.isAdmin === true;

    const settings = await Settings.findById('global_settings').lean();
    const unlockedPhases = settings?.unlockedPhases || [];
    
    let matchFilter = {};
    if (leagueId) matchFilter.leagueId = Number(leagueId);
    if (group) matchFilter.group = { $regex: group, $options: 'i' };
    if (matchId) matchFilter.matchId = Number(matchId);

    const matches = await Match.find(matchFilter).lean();
    const matchIdsFilter = matches.map(m => m.matchId);

    let query = { hasSubmitted: true };
    if (leagueId) query.leagueId = Number(leagueId);
    if (search) {
      const users = await User.find({ name: { $regex: search, $options: 'i' } }).select('_id').lean();
      query.user = { $in: users.map(u => u._id) };
    }

    const bets = await Bet.find(query)
      .populate('user', 'name')
      .select('user groupMatches podium totalPoints lastUpdate leagueId')
      .lean();

    const enriched = bets.map(b => {
      const viewGroupMatches = (b.groupMatches || [])
        .filter(gm => matchIdsFilter.includes(gm.matchId))
        .map(gm => {
          const m = matches.find(x => x.matchId === gm.matchId);
          let isLocked = !isAdmin;
          
          if (m?.phase === 'group') {
             isLocked = !unlockedPhases.includes('group');
          } else if (m?.phase === 'knockout') {
             isLocked = !unlockedPhases.includes(m.group);
          }

          return {
            ...gm,
            winner: isLocked ? '🔒' : gm.winner, 
            choiceLabel: isLocked ? 'Bloqueado' : toWinnerLabel(gm.winner, m?.teamA, m?.teamB)
          };
        });

      return {
        ...b,
        userName: b.user?.name || 'Usuário',
        groupMatches: viewGroupMatches 
      };
    });

    res.json({ success: true, data: enriched });
  } catch (e) {
    console.error('All-Bets Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar apostas' });
  }
});

/**
 * 🔍 Partidas para filtro
 */
router.get('/matches-for-filter', protect, checkPaid, async (req, res) => {
  try {
    const { leagueId } = req.query;
    let filter = {};
    if (leagueId) filter.leagueId = Number(leagueId);

    const matches = await Match.find(filter).select('matchId teamA teamB group date leagueId').sort('matchId').lean();
    res.json({ success: true, data: matches });
  } catch (e) {
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
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários' });
  }
});

/**
 * ⚠️ Admin: resets
 */
router.post('/admin/reset-all', protect, admin, async (req, res) => {
  try {
    await Bet.deleteMany({});
    await PointsHistory.deleteMany({});
    res.json({ success: true, message: 'Tudo resetado.' });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// 🔐 PERMISSÃO PARA MENU "MORE"
router.get('/more-access', protect, async (req, res) => {
  try {
    const isAdminUser = req.user?.isAdmin === true;
    if (isAdminUser) return res.json({ success: true, canAccessMore: true });
    const hasBets = await Bet.exists({ user: req.user._id, hasSubmitted: true });
    res.json({ success: true, canAccessMore: !!hasBets });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
