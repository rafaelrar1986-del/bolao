// routes/bets.js

const express = require('express');
const Bet = require('../models/Bet');
const Match = require('../models/Match');
const User = require('../models/User');
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
        // rótulo amigável do palpite
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
 * Espera:
 * {
 *   groupMatches: { [matchId]: 'A'|'B'|'draw', ... },
 *   podium: { first, second, third },
 *   knockoutQualifiers: { [matchId]: 'A'|'B' } // apenas mata-mata
 * }
 */
router.post('/save', protect, async (req, res) => {
  try {
    const { groupMatches, podium, knockoutQualifiers } = req.body;
    console.log('[bets.save] payload groupMatches=', JSON.stringify(groupMatches));
    console.log('[bets.save] payload knockoutQualifiers=', JSON.stringify(knockoutQualifiers));

    if (!groupMatches || typeof groupMatches !== 'object') {
      return res.status(400).json({ success: false, message: 'groupMatches inválido' });
    }

    // Busca aposta existente (se houver)
    const existing = await Bet.findOne({ user: req.user._id });

    /**
     * PÓDIO
     * - Primeiro envio: exige pódio completo.
     * - Envios posteriores: mantém o pódio já salvo e ignora mudanças.
     */
    let podiumPayload;
    const hasExistingPodium =
      existing &&
      existing.podium &&
      existing.podium.first &&
      existing.podium.second &&
      existing.podium.third;

    if (hasExistingPodium) {
      // Mantém pódio anterior (frontend já trava edição)
      podiumPayload = {
        first: existing.podium.first,
        second: existing.podium.second,
        third: existing.podium.third,
        fourth: existing.podium.fourth || ''
      };
    } else {
      // Primeiro envio: exige pódio completo
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

    /**
     * GROUP MATCHES (fase de grupos + mata-mata)
     * - Começa com o que já existe no banco.
     * - Adiciona apenas novos palpites.
     * - Nunca sobrescreve um palpite antigo com valor diferente.
     */
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

    // Mescla novos palpites (resultado + qualifier)
    Object.entries(groupMatches).forEach(([matchId, choice]) => {
      if (!['A', 'B', 'draw'].includes(choice)) {
        throw new Error(`Escolha inválida para matchId ${matchId}: ${choice}`);
      }
      const idNum = Number(matchId);
      if (!idNum) return;

      const existingBet = gmMap.get(idNum);
      if (existingBet) {
        // Se já existe e é igual, mantém; se é diferente, ignoramos (não deixamos editar palpite antigo)
        if (existingBet.winner !== choice) {
          return;
        }

        // Podemos atualizar o classificado se vier no payload
        if (knockoutQualifiers && Object.prototype.hasOwnProperty.call(knockoutQualifiers, String(idNum))) {
          const qExisting = knockoutQualifiers[String(idNum)];
          if (qExisting === 'A' || qExisting === 'B') {
            existingBet.qualifier = qExisting;
          }
        }

        gmMap.set(idNum, existingBet);
        return;
      }

      // Novo palpite: já pode vir com classificado (apenas mata-mata)
      let qualifier = null;
      if (knockoutQualifiers && Object.prototype.hasOwnProperty.call(knockoutQualifiers, String(idNum))) {
        const qNew = knockoutQualifiers[String(idNum)];
        if (qNew === 'A' || qNew === 'B') {
          qualifier = qNew;
        }
      }

      gmMap.set(idNum, {
        matchId: idNum,
        winner: choice,
        points: 0,
        qualifier,
        qualifierPoints: 0
      });
    });

    // 🔐 Garantir que knockoutQualifiers sejam aplicados (reforço)
    if (knockoutQualifiers && typeof knockoutQualifiers === 'object') {
      Object.entries(knockoutQualifiers).forEach(([k, v]) => {
        const idn = Number(k);
        if (!idn) return;
        const eb = gmMap.get(idn);
        if (eb) {
          if (v === 'A' || v === 'B') {
            eb.qualifier = v;
          } else {
            eb.qualifier = null;
          }
          if (typeof eb.qualifierPoints === 'undefined') eb.qualifierPoints = 0;
          gmMap.set(idn, eb);
        }
      });
    }

    console.log('[bets.save] after merge gmMap =', Array.from(gmMap.values()).slice(0, 5));

    const gmArray = Array.from(gmMap.values());

    const now = new Date();
    const payload = {
      user: req.user._id,
      groupMatches: gmArray,
      podium: podiumPayload,
      hasSubmitted: true,
      firstSubmission: existing?.firstSubmission || now,
      lastUpdate: now,
       // 🔒 PRESERVA PONTUAÇÃO EXISTENTE (CORREÇÃO DEFINITIVA)
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
    if (e.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: 'Dados inválidos', errors: e.errors });
    }
    return res.status(500).json({ success: false, message: e.message || 'Erro ao salvar palpites' });
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
    console.error('GET /status error:', e);
    res.status(500).json({ success: false, message: 'Erro ao verificar status' });
  }
});

/**
 * 🏆 Leaderboard
 * (Somente ordena por totalPoints desc; cálculo dos pontos é feito em outros fluxos)
 */
router.get(
  '/leaderboard',
  protect,
  blockStatsIfLocked,
  async (req, res) => {
  try {
    const bets = await Bet.find({ hasSubmitted: true })
      .populate('user', 'name')
      .select('user totalPoints groupPoints podiumPoints bonusPoints lastUpdate podium groupMatches')
      .sort({ totalPoints: -1 }) // 🔥 só pontos
      .lean();
// 🔥 BUSCA A FASE REAL DE CADA PARTIDA
const matches = await Match.find()
  .select('matchId phase')
  .lean();

const matchPhaseMap = new Map(
  matches.map(m => [m.matchId, m.phase])
);

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
  if (phase === 'group') {
    return sum + (gm.points || 0);
  }
  return sum;
}, 0);

const knockoutPoints = (b.groupMatches || []).reduce((sum, gm) => {
  const phase = matchPhaseMap.get(gm.matchId);
  if (phase === 'knockout') {
    return sum + (gm.points || 0);
  }
  return sum;
}, 0);


      return {
        position,
        user: b.user,
        totalPoints: b.totalPoints || 0,
groupPoints: groupPhasePoints,
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
router.get(
  '/all-bets',
  protect,
  blockStatsIfLocked,
  async (req, res) => {
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
  choice: g.winner,
  qualifier: g.qualifier,   // ✅ AQUI
  choiceLabel: toWinnerLabel(g.winner, teamA, teamB),
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
router.get(
  '/matches-for-filter',
  protect,
  blockStatsIfLocked,
  async (req, res) => {
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
router.get(
  '/users-for-filter',
  protect,
  blockStatsIfLocked,
  async (req, res) => {
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
/**
 * 🏆 Admin: resetar SOMENTE o pódio oficial
 * - Não apaga apostas
 * - Não mexe em grupo ou mata-mata
 * - Zera apenas podiumPoints
 */
router.post('/admin/reset-podium', protect, admin, async (req, res) => {
  try {
    const result = await Bet.updateMany(
      {},
      {
        $set: {
          'podium.first': '',
          'podium.second': '',
          'podium.third': '',
          'podium.fourth': '',
          podiumPoints: 0
        }
      }
    );

    res.json({
      success: true,
      message: 'Pódio oficial resetado com sucesso',
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    console.error('Erro ao resetar pódio:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao resetar pódio'
    });
  }
});

// =========================
// 🔐 PERMISSÃO PARA MENU "MORE"
// =========================
router.get('/more-access', protect, async (req, res) => {
  try {
    // 🟢 ADMIN sempre tem acesso (compatível com isAdmin e role)
    const isAdminUser =
      req.user?.isAdmin === true ||
      req.user?.role === 'admin';

    if (isAdminUser) {
      return res.json({
        success: true,
        canAccessMore: true
      });
    }
    // 👤 usuário comum → precisa ter palpites salvos
    const hasBets = await Bet.exists({
      user: req.user._id,
      hasSubmitted: true
    });

    res.json({
      success: true,
      canAccessMore: !!hasBets
    });

  } catch (err) {
    console.error('Erro ao verificar acesso ao MORE', err);
    res.status(500).json({
      success: false,
      canAccessMore: false
    });
  }
});


module.exports = router;
