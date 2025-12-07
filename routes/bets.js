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
  if (choice === 'draw') return 'Empate';
  return '-';
}

function sanitizeId(id) {
  if (!id) return null;
  return String(id).trim();
}

/**
 * GET /api/bets/my-bets
 * Retorna os palpites (groupMatches + podium + flags) do usuário logado
 */
router.get('/my-bets', protect, async (req, res) => {
  try {
    const bet = await Bet.findOne({ user: req.user._id }).lean();

    if (!bet) {
      return res.json({
        success: true,
        hasSubmitted: false,
        data: {
          groupMatches: [],
          podium: null
        }
      });
    }

    return res.json({
      success: true,
      hasSubmitted: !!bet.hasSubmitted,
      data: {
        groupMatches: bet.groupMatches || [],
        podium: bet.podium || null
      }
    });
  } catch (error) {
    console.error('GET /api/bets/my-bets error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao carregar palpites' });
  }
});

/**
 * GET /api/bets/status
 * Retorna se o usuário já enviou ou não
 */
router.get('/status', protect, async (req, res) => {
  try {
    const bet = await Bet.findOne({ user: req.user._id }).select('hasSubmitted').lean();
    return res.json({
      success: true,
      hasSubmitted: !!(bet && bet.hasSubmitted)
    });
  } catch (error) {
    console.error('GET /api/bets/status error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar status das apostas' });
  }
});

/**
 * GET /api/bets/ranking
 * Ranking geral de usuários, com paginação simples
 */
router.get('/ranking', protect, async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Math.min(Number(req.query.pageSize) || 50, 200);

    const skip = (page - 1) * pageSize;

    const [totalCount, bets] = await Promise.all([
      Bet.countDocuments({}),
      Bet.find({})
        .sort({ totalPoints: -1, lastUpdate: 1 })
        .skip(skip)
        .limit(pageSize)
        .populate('user', 'name email')
        .lean()
    ]);

    // Identificar posição do usuário logado
    let myPosition = null;
    if (req.user && req.user._id) {
      const myBets = await Bet.findOne({ user: req.user._id })
        .select('totalPoints lastUpdate')
        .lean();
      if (myBets) {
        const betterCount = await Bet.countDocuments({
          $or: [
            { totalPoints: { $gt: myBets.totalPoints } },
            {
              totalPoints: myBets.totalPoints,
              lastUpdate: { $lt: myBets.lastUpdate }
            }
          ]
        });
        myPosition = betterCount + 1;
      }
    }

    return res.json({
      success: true,
      page,
      pageSize,
      totalCount,
      data: bets.map((b, idx) => ({
        position: skip + idx + 1,
        userId: b.user?._id,
        name: b.user?.name || 'Usuário',
        totalPoints: b.totalPoints || 0,
        groupPoints: b.groupPoints || 0,
        podiumPoints: b.podiumPoints || 0,
        bonusPoints: b.bonusPoints || 0,
        lastUpdate: b.lastUpdate
      })),
      myPosition
    });
  } catch (error) {
    console.error('GET /api/bets/ranking error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar ranking' });
  }
});

/**
 * GET /api/bets/admin/summary
 * Resumo admin de apostas por partida
 */
router.get('/admin/summary', protect, admin, async (req, res) => {
  try {
    const matches = await Match.find({}).lean();
    const bets = await Bet.find({}).lean();

    const matchMap = new Map();
    matches.forEach((m) => {
      matchMap.set(m.matchId, m);
    });

    const summary = [];

    matches.forEach((m) => {
      const entry = {
        matchId: m.matchId,
        phase: m.phase,
        group: m.group,
        teamA: m.teamA,
        teamB: m.teamB,
        status: m.status,
        totalBets: 0,
        winnerA: 0,
        winnerB: 0,
        draw: 0
      };

      bets.forEach((b) => {
        (b.groupMatches || []).forEach((gm) => {
          if (gm.matchId === m.matchId) {
            entry.totalBets += 1;
            if (gm.winner === 'A') entry.winnerA += 1;
            if (gm.winner === 'B') entry.winnerB += 1;
            if (gm.winner === 'draw') entry.draw += 1;
          }
        });
      });

      summary.push(entry);
    });

    return res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('GET /api/bets/admin/summary error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar resumo admin' });
  }
});

/**
 * POST /api/bets/save
 * Salva/atualiza palpites do usuário.
 * Agora suporta classificado do mata-mata (qualifier) via knockoutQualifiers.
 */
router.post('/save', protect, async (req, res) => {
  try {
    const body = req.body || {};
    const groupMatches = body.groupMatches || {};
    const podium = body.podium || {};
    const knockoutQualifiers = body.knockoutQualifiers || {};

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
    let podiumPayload = {
      first: '',
      second: '',
      third: ''
    };

    const hasExistingPodium =
      existing &&
      existing.podium &&
      existing.podium.first &&
      existing.podium.second &&
      existing.podium.third;

    if (hasExistingPodium) {
      // Mantém o pódio que já estava salvo
      podiumPayload = {
        first: existing.podium.first,
        second: existing.podium.second,
        third: existing.podium.third
      };
    } else {
      // Primeiro envio: exige pódio completo
      if (!podium || !podium.first || !podium.second || !podium.third) {
        return res.status(400).json({ success: false, message: 'Pódio incompleto' });
      }
      podiumPayload = {
        first: String(podium.first).trim(),
        second: String(podium.second).trim(),
        third: String(podium.third).trim()
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

    // Mescla novos palpites (resultado)
    Object.keys(groupMatches).forEach((matchId) => {
      const choice = groupMatches[matchId];
      if (['A', 'B', 'draw'].indexOf(choice) === -1) {
        throw new Error('Escolha inválida para matchId ' + matchId + ': ' + choice);
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
        qualifier: qualifier,
        qualifierPoints: 0
      });
    });

    // Reaplica knockoutQualifiers por garantia
    if (knockoutQualifiers && typeof knockoutQualifiers === 'object') {
      Object.keys(knockoutQualifiers).forEach((k) => {
        const v = knockoutQualifiers[k];
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

    console.log('[bets.save] after merge gmMap =', Array.from(gmMap.values()));

    const gmArray = Array.from(gmMap.values());

    const now = new Date();
    const payload = {
      user: req.user._id,
      groupMatches: gmArray,
      podium: podiumPayload,
      hasSubmitted: true,
      firstSubmission: existing && existing.firstSubmission ? existing.firstSubmission : now,
      lastUpdate: now,
      // pontos vão ser recalculados pelos serviços / admin
      totalPoints: existing && typeof existing.totalPoints === 'number' ? existing.totalPoints : 0,
      groupPoints: existing && typeof existing.groupPoints === 'number' ? existing.groupPoints : 0,
      podiumPoints: existing && typeof existing.podiumPoints === 'number' ? existing.podiumPoints : 0,
      bonusPoints: existing && typeof existing.bonusPoints === 'number' ? existing.bonusPoints : 0
    };

    let saved;
    if (existing) {
      saved = await Bet.findOneAndUpdate(
        { _id: existing._id },
        payload,
        { new: true, runValidators: true }
      );
    } else {
      saved = await Bet.create(payload);
    }

    return res.json({
      success: true,
      message: 'Palpites salvos com sucesso',
      hasSubmitted: true,
      data: saved
    });
  } catch (error) {
    console.error('POST /api/bets/save error:', error);
    if (error && error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: 'Dados inválidos', errors: error.errors });
    }
    return res.status(500).json({ success: false, message: error.message || 'Erro ao salvar palpites' });
  }
});

/**
 * POST /api/bets/admin/recalculate
 * Recalcula pontos de todos os usuários (admin)
 */
router.post('/admin/recalculate', protect, admin, async (req, res) => {
  try {
    const matches = await Match.find({}).lean();
    const bets = await Bet.find({}).lean();

    const matchMap = new Map();
    matches.forEach((m) => {
      matchMap.set(m.matchId, m);
    });

    const winnerFromScores = (scoreA, scoreB) => {
      if (scoreA > scoreB) return 'A';
      if (scoreB > scoreA) return 'B';
      return 'draw';
    };

    for (const bet of bets) {
      let groupPoints = 0;

      (bet.groupMatches || []).forEach((gm) => {
        const m = matchMap.get(gm.matchId);
        if (!m || m.status !== 'finished') {
          gm.points = 0;
          gm.qualifierPoints = 0;
          return;
        }

        const real = winnerFromScores(Number(m.scoreA), Number(m.scoreB));
        const hitResult = real && gm.winner && real === gm.winner;

        let hitQualifier = false;
        const realQualifier = m.qualifiedSide || real;
        if (gm.qualifier && (gm.qualifier === 'A' || gm.qualifier === 'B')) {
          if (realQualifier && realQualifier !== 'draw' && gm.qualifier === realQualifier) {
            hitQualifier = true;
          }
        }

        gm.qualifierPoints = hitQualifier ? 1 : 0;
        gm.points = (hitResult ? 1 : 0) + (hitQualifier ? 1 : 0);
        groupPoints += gm.points;
      });

      bet.groupPoints = groupPoints;
      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);

      await Bet.updateOne(
        { _id: bet._id },
        {
          $set: {
            groupMatches: bet.groupMatches,
            groupPoints: bet.groupPoints,
            totalPoints: bet.totalPoints,
            lastUpdate: new Date()
          }
        }
      );
    }

    return res.json({ success: true, message: 'Recalculo de pontos concluído' });
  } catch (error) {
    console.error('POST /api/bets/admin/recalculate error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao recalcular pontos' });
  }
});

/**
 * POST /api/bets/admin/reset-all
 * Zera todas as apostas (admin)
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
