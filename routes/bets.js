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
    message: '🏆 API de Palpites do Bolão 2026',
    version: '1.1.0',
    endpoints: {
      'GET  /api/bets/my-bets': 'Meus palpites (protegido + pago)',
      'POST /api/bets/save': 'Enviar palpites (protegido + pago)',
      'GET  /api/bets/status': 'Status dos palpites (apenas login)',
      'GET  /api/bets/leaderboard': 'Ranking (protegido + pago)',
      'GET  /api/bets/all-bets': 'Todos os palpites (protegido + pago)',
    }
  });
});

/**
 * 🎯 Meus palpites
 */
router.get('/my-bets', protect, checkPaid, async (req, res) => {
  try {
    const bet = await Bet.findOne({ user: req.user._id }).lean();
    const matches = await Match.find().lean();

    if (!bet) {
      return res.json({ success: true, data: null, hasSubmitted: false });
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
      data: { ...bet, groupMatches: gm },
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
router.post('/save', protect, checkPaid, async (req, res) => {
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

/**
 * ℹ️ Status
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
    res.status(500).json({ success: false, message: 'Erro ao verificar status' });
  }
});

/**
 * 🏆 Leaderboard (Oficial + Parcial LIVE)
 */
router.get('/leaderboard', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const isPartial = req.query.type === 'partial';

    const [bets, matches] = await Promise.all([
      Bet.find({ hasSubmitted: true }).populate('user', 'name avatar').lean(),
      Match.find().select('matchId status scoreA scoreB phase qualifiedSide').lean()
    ]);

    const matchMap = new Map(matches.map(m => [m.matchId, m]));

    const getWinner = (a, b) => {
      if (a === null || b === null || isNaN(a) || isNaN(b)) return null;
      if (a > b) return 'A';
      if (b > a) return 'B';
      return 'draw';
    };

    const ranked = bets.map((b) => {
      let totalPoints = 0;
      let groupPhasePoints = 0;
      let knockoutPoints = 0;

      // --- RANKING OFICIAL ---
      if (!isPartial) {
        (b.groupMatches || []).forEach(gm => {
          const m = matchMap.get(gm.matchId);
          if (m && m.status === 'finished') {
            if (m.phase === 'group') {
              groupPhasePoints += (gm.points || 0);
            } else {
              // CORREÇÃO: Usamos apenas gm.points (máximo 2)
              knockoutPoints += (gm.points || 0);
            }
          }
        });

        return {
          user: b.user,
          totalPoints: b.totalPoints || 0,
          groupPhasePoints,
          knockoutPoints,
          podiumPoints: b.podiumPoints || 0,
          bonusPoints: b.bonusPoints || 0,
          lastUpdate: b.lastUpdate
        };
      }

      // --- RANKING PARCIAL (LIVE) ---
      (b.groupMatches || []).forEach(gm => {
        const m = matchMap.get(gm.matchId);
        if (!m || m.status === 'scheduled') return;

        const realWinner = getWinner(m.scoreA, m.scoreB);
        let matchPoints = 0;
        
        if (realWinner && gm.winner === realWinner) {
          matchPoints += 1;
        }

        if (m.phase !== 'group') {
          const realQual = m.qualifiedSide || (realWinner !== 'draw' ? realWinner : null);
          if (gm.qualifier && realQual && gm.qualifier === realQual) {
            matchPoints += 1;
          }
        }

        totalPoints += matchPoints;
        if (m.phase === 'group') groupPhasePoints += matchPoints;
        else knockoutPoints += matchPoints;
      });

      const finalPoints = totalPoints + (b.podiumPoints || 0) + (b.bonusPoints || 0);

      return {
        user: b.user,
        totalPoints: finalPoints,
        groupPhasePoints,
        knockoutPoints,
        podiumPoints: b.podiumPoints || 0,
        bonusPoints: b.bonusPoints || 0,
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

    res.json({ success: true, data: finalData, count: finalData.length, isPartial });

  } catch (e) {
    console.error('Leaderboard Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao processar ranking' });
  }
});

/**
 * 👁️ Todos os palpites
 */
router.get('/all-bets', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { search, matchId, group, sortBy = 'user' } = req.query;
    const isAdmin = req.user?.isAdmin === true;

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

    const enriched = bets.map(b => {
      let gm = b.groupMatches || [];
      if (groupMatchIds) gm = gm.filter(x => groupMatchIds.includes(x.matchId));
      if (matchIdNum) gm = gm.filter(x => x.matchId === matchIdNum);

      const viewBets = gm.map(g => {
        const m = matches.find(x => x.matchId === g.matchId);
        const teamA = m?.teamA || 'Time A';
        const teamB = m?.teamB || 'Time B';
        
        let isLocked = !isAdmin;
        if (!isLocked) { /* Admin sempre vê */ } 
        else if (m?.phase === 'group') {
            isLocked = !unlockedPhases.includes('group');
        } else if (m?.phase === 'knockout') {
            isLocked = !unlockedPhases.includes(m.group);
        }

        return {
          matchId: g.matchId,
          choice: isLocked ? '🔒' : g.winner,
          qualifier: isLocked ? (g.qualifier ? '🔒' : null) : (g.qualifier || null),
          choiceLabel: isLocked ? 'Bloqueado' : toWinnerLabel(g.winner, teamA, teamB),
          matchName: m ? `${m.teamA} vs ${m.teamB}` : `Jogo ${g.matchId}`,
          teamA,
          teamB,
          status: m?.status || 'scheduled'
        };
      });

      const isFinalUnlocked = unlockedPhases.some(p => p && p.toLowerCase() === 'final');

      return {
        userName: b.user?.name || 'Usuário',
        podium: (isAdmin || isFinalUnlocked) ? b.podium : { first: '🔒', second: '🔒', third: '🔒', fourth: '🔒' },
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
 * 🔍 Filtros
 */
router.get('/matches-for-filter', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const matches = await Match.find().select('matchId teamA teamB group date').sort('matchId').lean();
    res.json({ success: true, data: matches });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erro ao buscar partidas' });
  }
});

router.get('/users-for-filter', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const users = await User.find().select('_id name').sort('name').lean();
    res.json({ success: true, data: users });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários' });
  }
});

/**
 * Admin: Resets
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
