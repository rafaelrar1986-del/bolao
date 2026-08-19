// routes/matches.js
const express = require('express');
const router = express.Router();

// ==========================================
// MODELS & MIDDLEWARES
// ==========================================
const Match = require('../models/Match');
const Bet = require('../models/Bet');
const Settings = require('../models/Settings');
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');

// ==========================================
// SERVICES
// ==========================================
const { trySaveDailyPoints } = require('../services/dailyHistoryService');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');
const pointsService = require('../services/pointsService');

// ---- helpers
function parseMatchDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [day, month, year] = dateStr.split('/');
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0));
}

function parseMatchTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.split(':');
  if (h == null || m == null) return 0;
  return (Number(h) * 60 + Number(m)) * 60 * 1000;
}

function getMatchTimestamp(dateStr, timeStr) {
  const d = parseMatchDate(dateStr);
  if (!d) return null;
  return d.getTime() + parseMatchTime(timeStr);
}

// 🆕 CORREÇÃO: Usa != null em vez de truthy check para aceitar leagueId = 0
function toLeagueId(leagueId) {
  return leagueId != null ? String(leagueId).trim() : 'default';
}

// ==========================================
// 1. GET /api/matches/leagues (Ligas Disponíveis)
// ==========================================
router.get('/leagues', async (req, res) => {
  try {
    const leagues = await Match.aggregate([
      { $match: { leagueId: { $ne: null } } },
      {
        $group: {
          _id: "$leagueId",
          name: { $first: "$leagueName" },
          scheduledCount: {
            $sum: { $cond: [{ $eq: ["$status", "scheduled"] }, 1, 0] }
          },
          allMatches: {
            $push: {
              date: "$date",
              time: "$time",
              teamA: "$teamA",
              teamB: "$teamB",
              status: "$status"
            }
          }
        }
      },
      { $sort: { name: 1 } }
    ]);

    const data = leagues.map(l => {
      const scheduledMatches = l.allMatches.filter(m => m.status === 'scheduled');

      // 🆕 CORREÇÃO: Ordenação consistente usando UTC (mesma base de parseMatchDate)
      const sortedMatches = scheduledMatches.sort((a, b) => {
        const tsA = getMatchTimestamp(a.date, a.time);
        const tsB = getMatchTimestamp(b.date, b.time);
        if (!tsA || !tsB) return 0;
        return tsA - tsB;
      });

      const next = sortedMatches[0];
      let isoDate = null;
      if (next) {
        const [day, month, year] = next.date.split('/');
        const [h, min] = next.time.split(':');
        if (day && month && year && h != null && min != null) {
          // 🆕 CORREÇÃO: Retorna ISO local sem 'Z' para evitar shift de timezone no front
          isoDate = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${h.padStart(2, '0')}:${min.padStart(2, '0')}:00`;
        }
      }

      return {
        id: l._id,
        name: l.name || `Liga ${l._id}`,
        count: l.scheduledCount,
        nextMatchDate: isoDate,
        nextMatchTeams: next ? `${next.teamA} x ${next.teamB}` : "Rodada encerrada"
      };
    }).filter(l => l.id !== null);

    res.json({ success: true, data });
  } catch (err) {
    console.error('Erro ao buscar ligas:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar ligas' });
  }
});

// ======================
// 2. GET /api/matches (Público - com filtro de liga)
// ======================
router.get('/', async (req, res) => {
  try {
    const { leagueId } = req.query;
    let filtro = {};
    // 🆕 CORREÇÃO: Normaliza leagueId para evitar filtro com string vazia
    const normalizedLeagueId = toLeagueId(leagueId);
    if (normalizedLeagueId !== 'default') filtro.leagueId = normalizedLeagueId;

    const matches = await Match.find(filtro).sort({ date: 1, time: 1 }).lean();
    res.json({ success: true, data: matches });
  } catch (err) {
    console.error('Erro ao listar partidas:', err);
    res.status(500).json({ success: false, message: 'Erro ao listar partidas' });
  }
});

// ======================
// GET /api/matches/match-technical/:matchId
// ======================
router.get('/match-technical/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;

    // 🆕 CORREÇÃO: matchId é unique no schema; filtro por leagueId é redundante
    // e causa 404 falsos quando o cliente passa leagueId errado.
    const match = await Match.findOne({ matchId: Number(matchId) }).lean();

    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    const timeline = (match.goalsDetail || []).sort((a, b) => {
      const minA = (a.min || 0) + (a.extra || 0);
      const minB = (b.min || 0) + (b.extra || 0);
      return minA - minB;
    });

    const lineupHome = match.lineups?.home || {};
    const lineupAway = match.lineups?.away || {};

    res.json({
      success: true,
      data: {
        matchId: match.matchId,
        status: match.status,
        apiStatus: match.apiStatus,
        currentTime: match.minute || "0",
        score: {
          // Preserva null para partidas não iniciadas
          teamA: match.scoreA,
          teamB: match.scoreB,
          penaltiesA: match.penaltiesA ?? null,
          penaltiesB: match.penaltiesB ?? null,
          qualifiedSide: match.qualifiedSide ?? null,
          regularTimeScoreA: match.regularTimeScoreA ?? null,
          regularTimeScoreB: match.regularTimeScoreB ?? null
        },
        advanced: {
          xg: match.xg || { home: 0, away: 0 },
          odds: match.odds || { home: null, draw: null, away: null },
          aiAnalysis: match.ai_analysis || '',
          videoUrl: match.video_url || ''
        },
        timeline,
        lineups: {
          teamA: {
            formation: lineupHome.formation || "",
            titulares: lineupHome.players || [],
            reservas: lineupHome.substitutes || []
          },
          teamB: {
            formation: lineupAway.formation || "",
            titulares: lineupAway.players || [],
            reservas: lineupAway.substitutes || []
          },
          confirmed: match.lineups?.confirmed || false,
          unavailable: match.unavailable || []
        },
        summary: {
          possession: {
            teamA: match.possession?.home ?? null,
            teamB: match.possession?.away ?? null
          },
          // statistics é Array no schema — retorna array consistentemente
          stats: match.statistics || []
        },
        venue: match.stadium || 'Não informado'
      }
    });
  } catch (e) {
    console.error('Match Technical Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar detalhes técnicos' });
  }
});

// ======================
// 3. GET /api/matches/admin/all (Admin)
// ======================
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const { leagueId } = req.query;

    // leagueId é obrigatório para evitar contaminação de apostas entre ligas
    if (leagueId == null) { // 🆕 != null
      return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });
    }

    const filtro = { leagueId: String(leagueId) };

    const matches = await Match.find(filtro).sort({ date: 1, time: 1 }).lean();

    const betPipeline = [
      { $match: { leagueId: String(leagueId) } },
      { $unwind: '$groupMatches' },
      { $group: { _id: '$groupMatches.matchId', count: { $sum: 1 } } }
    ];

    const betCounts = await Bet.aggregate(betPipeline);

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
// 4. POST /api/matches/admin/add (Admin)
// ======================
router.post('/admin/add', protect, admin, async (req, res) => {
  try {
    const {
      matchId, teamA, teamB, date, time, group, phaseName,
      stadium, phase, apiId, leagueId, leagueName
    } = req.body;

    // group é required no schema para TODAS as fases, incluindo knockout
    // 🆕 CORREÇÃO: leagueId agora é obrigatório para evitar partidas órfãs
    if (!matchId || !teamA || !teamB || !date || !time || !group || leagueId == null) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios ausentes' });
    }

    // 🆕 CORREÇÃO: Validação numérica rigorosa para matchId e apiId
    const idNum = Number(matchId);
    const apiNum = Number(apiId);

    if (!Number.isFinite(idNum)) {
      return res.status(400).json({ success: false, message: 'matchId deve ser um número válido' });
    }
    if (apiId === undefined || apiId === null || apiId === '' || !Number.isFinite(apiNum)) {
      return res.status(400).json({ success: false, message: 'apiId é obrigatório e deve ser um número válido' });
    }

    const exists = await Match.findOne({ matchId: idNum });
    if (exists) return res.status(409).json({ success: false, message: 'matchId já existe' });

    const apiExists = await Match.findOne({ apiId: apiNum });
    if (apiExists) return res.status(409).json({ success: false, message: 'apiId já existe' });

    const m = await Match.create({
      matchId: idNum,
      apiId: apiNum,
      leagueId: toLeagueId(leagueId), // 🆕 != null (normalizado)
      leagueName: leagueName ? String(leagueName).trim() : undefined,
      teamA: String(teamA).trim(),
      teamB: String(teamB).trim(),
      date: String(date).trim(),
      time: String(time).trim(),
      group: String(group).trim(),
      phaseName: phaseName ? String(phaseName).trim() : undefined,
      stadium: stadium ? String(stadium).trim() : undefined,
      phase: phase || 'group',
      status: 'scheduled',
      scoreA: null,
      scoreB: null,
      penaltiesA: null,
      penaltiesB: null
    });

    res.json({ success: true, data: m });
  } catch (err) {
    console.error('Erro ao adicionar partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao adicionar partida' });
  }
});

// ======================
// 5. PUT /api/matches/admin/edit/:matchId (Admin)
// ======================
router.put('/admin/edit/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);

    if (!Number.isFinite(matchId)) {
      return res.status(400).json({ success: false, message: 'matchId inválido' });
    }

    const match = await Match.findOne({ matchId });
    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    const oldStatus = match.status;

    const updates = {};
    const fields = [
      'teamA', 'teamB', 'date', 'time', 'group', 'phaseName',
      'stadium', 'phase', 'status', 'scoreA', 'scoreB',
      'apiId', 'penaltiesA', 'penaltiesB', 'leagueId', 'leagueName',
      'regularTimeScoreA', 'regularTimeScoreB', 'qualifiedSide'
    ];

    fields.forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });

    if (updates.teamA) updates.teamA = String(updates.teamA).trim();
    if (updates.teamB) updates.teamB = String(updates.teamB).trim();
    if (updates.date) updates.date = String(updates.date).trim();
    if (updates.time) updates.time = String(updates.time).trim();
    if (updates.leagueName) updates.leagueName = String(updates.leagueName).trim();
    if (updates.phaseName) updates.phaseName = String(updates.phaseName).trim();
    if (updates.group) updates.group = String(updates.group).trim();
    if (updates.stadium) updates.stadium = String(updates.stadium).trim();
    if (updates.leagueId) updates.leagueId = String(updates.leagueId).trim();

    // Se o admin está alterando manualmente o qualifiedSide,
    // sincroniza a flag qualifiedSideManuallySet para que o pre('save') não sobrescreva.
    if (updates.qualifiedSide !== undefined) {
      if (['A', 'B'].includes(updates.qualifiedSide)) {
        updates.qualifiedSideManuallySet = true;
      } else if (updates.qualifiedSide === null) {
        updates.qualifiedSideManuallySet = false;
      }
    }

    // 🆕 CORREÇÃO CRÍTICA: Guarda os valores antigos dos campos de placar
    // ANTES do match.set(), para que a comparação de mudança seja confiável.
    const scoreFields = [
      'scoreA', 'scoreB', 'penaltiesA', 'penaltiesB',
      'regularTimeScoreA', 'regularTimeScoreB', 'qualifiedSide'
    ];
    const oldValues = {};
    scoreFields.forEach(k => {
      oldValues[k] = match[k];
    });

    // 🆕 CORREÇÃO: Usa match.set() em vez de atribuição direta por loop.
    // O Mongoose filtra campos do schema, aplica casting e validações.
    match.set(updates);

    // 🆕 CORREÇÃO CRÍTICA: Valida unicidade de apiId ao editar
    if (updates.apiId !== undefined) {
      const apiNum = Number(updates.apiId);
      if (!Number.isFinite(apiNum)) {
        return res.status(400).json({ success: false, message: 'apiId deve ser um número válido' });
      }
      const apiExists = await Match.findOne({ apiId: apiNum, matchId: { $ne: match.matchId } });
      if (apiExists) {
        return res.status(409).json({ success: false, message: 'apiId já existe em outra partida' });
      }
    }

    // 🆕 CORREÇÃO CRÍTICA: Se o status mudou de finished para não-jogando, limpa todos os scores
    const nonPlayingStatuses = ['scheduled', 'cancelled', 'postponed'];
    if (oldStatus === 'finished' && nonPlayingStatuses.includes(match.status)) {
      match.scoreA = null;
      match.scoreB = null;
      match.regularTimeScoreA = null;
      match.regularTimeScoreB = null;
      match.penaltiesA = null;
      match.penaltiesB = null;
      match.qualifiedSide = null;
      match.qualifiedSideManuallySet = false;
      match.minute = '';
      match.processed = false;
      match.scoutsConsolidated = false;
      match.goalsDetail = [];
      match.statistics = [];
      match.shootoutDetail = [];
      match.possession = { home: 0, away: 0 };
      match.xg = { home: 0, away: 0 };
      match.odds = { home: null, draw: null, away: null };
      match.unavailable = [];
      match.ai_analysis = '';
      match.video_url = '';
      match.apiStatus = 'NS';
      match.lineups = {
        home: { formation: "", players: [], substitutes: [] },
        away: { formation: "", players: [], substitutes: [] },
        confirmed: false
      };
    }

    if (match.status === 'finished') {
      match.minute = "Fim";
    } else if (match.status === '1_tempo' && !match.minute) {
      match.minute = "0'";
    }

    await match.save();

    // Trava de grade e auditoria
    if (updates.status && oldStatus === 'scheduled' && !['scheduled', 'cancelled'].includes(updates.status)) {
      const configId = toLeagueId(match.leagueId);
      const lockIdentifier = match.phaseName || match.group;

      if (lockIdentifier) {
        const settingsUpdated = await Settings.findOneAndUpdate(
          { _id: configId, lockedPhases: { $ne: lockIdentifier } },
          {
            $addToSet: { lockedPhases: lockIdentifier },
            // Remove de unlockedPhases para evitar estado simultâneo
            $pull: { unlockedPhases: lockIdentifier },
            $set: { statsLocked: false, blockSaveBets: true, blockSaveKnockout: true }
          },
          { new: true }
        );

        if (settingsUpdated) {
          try {
            const csv = await auditService.generateAuditCSV(match.leagueId || 'default', lockIdentifier);
            if (csv) {
              const users = await User.find({ leagues: String(match.leagueId || 'default') }, 'email');
              const emails = users.map((u) => u.email).filter(Boolean);
              if (emails.length > 0) {
                await emailService.sendBroadcastEmail(
                  emails,
                  `🔒 Auditoria Manual (Painel Admin): ${lockIdentifier}`,
                  `A rodada/fase foi trancada manualmente pelo administrador. Partida disparadora: ${match.teamA} x ${match.teamB}.`,
                  csv
                );
              }
            }
          } catch (auditErr) {
            console.error('❌ [ADMIN AUDIT]: Erro na auditoria manual:', auditErr.message);
          }
        }
      }
    }

    // 🆕 CORREÇÃO CRÍTICA: Usa oldValues para detectar mudança real de placar,
    // evitando recálculos desnecessários e garantindo detecção em partidas já finalizadas.
    // 🆕 CORREÇÃO: Trata null explicitamente para evitar falso negativo quando
    // Number(null) === Number(0) → 0 === 0 (falso negativo).
    const scoreChanged = scoreFields.some(k => {
      if (updates[k] === undefined) return false;
      const oldVal = oldValues[k];
      const newVal = updates[k];
      // Se ambos são null/undefined, não mudou
      if ((oldVal === null || oldVal === undefined) && (newVal === null || newVal === undefined)) {
        return false;
      }
      // Se um dos lados é null/undefined e o outro não, mudou
      if (oldVal === null || oldVal === undefined || newVal === null || newVal === undefined) {
        return true;
      }
      return Number(oldVal) !== Number(newVal);
    });

    const becameFinished = updates.status === 'finished' && oldStatus !== 'finished';
    const wasAlreadyFinished = oldStatus === 'finished' && scoreChanged;
    const statusChangedFromFinished = oldStatus === 'finished' && updates.status && updates.status !== 'finished';

    if (becameFinished || wasAlreadyFinished || statusChangedFromFinished) {
      try {
        const configId = toLeagueId(match.leagueId);
        await pointsService.recalculateAllPoints(configId);

        const normalizedDate = parseMatchDate(match.date);
        if (normalizedDate) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          await trySaveDailyPoints(normalizedDate, String(match.leagueId || 'default'));
        }
      } catch (pointsErr) {
        console.error('❌ [ADMIN EDIT]: Erro ao recalcular pontos:', pointsErr.message);
      }
    }

    // Usa o documento match diretamente (já reflete pre('save') e save)
    res.json({ success: true, data: match });
  } catch (err) {
    console.error('Erro ao editar partida:', err);
    res.status(500).json({ success: false, message: err.message || 'Erro ao editar partida' });
  }
});

// ======================
// 6. POST /api/matches/admin/finish/:matchId (Admin)
// ======================
router.post('/admin/finish/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const {
      scoreA, scoreB, penaltiesA, penaltiesB,
      regularTimeScoreA, regularTimeScoreB, qualifiedSide
    } = req.body;

    // 🆕 CORREÇÃO CRÍTICA: Rejeita null, undefined e string vazia nos scores obrigatórios
    if (!Number.isFinite(matchId) || scoreA == null || scoreB == null) {
      return res.status(400).json({ success: false, message: 'matchId, scoreA e scoreB são obrigatórios' });
    }

    // 🆕 CORREÇÃO CRÍTICA: Rejeita string vazia e NaN silencioso vindos do body
    // Number('') === 0 (finite), então precisamos checar explicitamente
    const numScoreA = scoreA !== '' && scoreA != null ? Number(scoreA) : NaN;
    const numScoreB = scoreB !== '' && scoreB != null ? Number(scoreB) : NaN;
    if (!Number.isFinite(numScoreA) || !Number.isFinite(numScoreB)) {
      return res.status(400).json({ success: false, message: 'scoreA e scoreB devem ser números válidos' });
    }
    const numPenA = penaltiesA !== undefined && penaltiesA !== '' ? Number(penaltiesA) : null;
    const numPenB = penaltiesB !== undefined && penaltiesB !== '' ? Number(penaltiesB) : null;
    if (penaltiesA !== undefined && penaltiesA !== '' && !Number.isFinite(numPenA)) {
      return res.status(400).json({ success: false, message: 'penaltiesA deve ser um número válido' });
    }
    if (penaltiesB !== undefined && penaltiesB !== '' && !Number.isFinite(numPenB)) {
      return res.status(400).json({ success: false, message: 'penaltiesB deve ser um número válido' });
    }
    const numRegA = regularTimeScoreA !== undefined && regularTimeScoreA !== '' ? Number(regularTimeScoreA) : null;
    const numRegB = regularTimeScoreB !== undefined && regularTimeScoreB !== '' ? Number(regularTimeScoreB) : null;
    if (regularTimeScoreA !== undefined && regularTimeScoreA !== '' && !Number.isFinite(numRegA)) {
      return res.status(400).json({ success: false, message: 'regularTimeScoreA deve ser um número válido' });
    }
    if (regularTimeScoreB !== undefined && regularTimeScoreB !== '' && !Number.isFinite(numRegB)) {
      return res.status(400).json({ success: false, message: 'regularTimeScoreB deve ser um número válido' });
    }

    // 🆕 CORREÇÃO: Busca a partida e as regras da liga para validar regularTimeScore em knockout
    const preMatch = await Match.findOne({ matchId });
    if (!preMatch) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    if (preMatch.phase === 'knockout') {
      const configId = toLeagueId(preMatch.leagueId);
      const settings = await Settings.findById(configId).lean();
      const drawIncludesExtraTime = settings?.championshipRules?.drawIncludesExtraTime ?? false;

      if (!drawIncludesExtraTime) {
        // 🆕 CORREÇÃO: Usa os valores JÁ CONVERTIDOS (numRegA/B) para validar,
        // garantindo que string vazia seja tratada como ausente.
        if (numRegA == null || numRegB == null) {
          return res.status(400).json({
            success: false,
            message: 'Para partidas de mata-mata com regra de 90 minutos isolados, regularTimeScoreA e regularTimeScoreB são obrigatórios.'
          });
        }
      }
    }

    // 🆕 CORREÇÃO: Early return se a partida já está no estado exato solicitado,
    // evitando recálculo desnecessário de pontos.
    const qSideWillChange = qualifiedSide !== undefined && ['A', 'B'].includes(qualifiedSide) && preMatch.qualifiedSide !== qualifiedSide;
    const alreadyFinished =
      preMatch.status === 'finished' &&
      preMatch.scoreA === Number(scoreA) &&
      preMatch.scoreB === Number(scoreB) &&
      preMatch.penaltiesA === (penaltiesA != null ? Number(penaltiesA) : null) &&
      preMatch.penaltiesB === (penaltiesB != null ? Number(penaltiesB) : null) &&
      preMatch.regularTimeScoreA === (regularTimeScoreA != null ? Number(regularTimeScoreA) : null) &&
      preMatch.regularTimeScoreB === (regularTimeScoreB != null ? Number(regularTimeScoreB) : null) &&
      !qSideWillChange;

    if (alreadyFinished) {
      return res.json({
        success: true,
        message: 'Partida já estava finalizada com os mesmos dados. Nenhuma ação necessária.',
        data: preMatch,
        recalculated: 0
      });
    }

    // Match.finishMatch agora aceita qualifiedSide como 8º parâmetro e gerencia
    // a flag qualifiedSideManuallySet internamente.
    // 🆕 CORREÇÃO CRÍTICA: Passa os valores JÁ CONVERTIDOS (numScoreA, numPenA, etc.)
    // em vez dos valores brutos do body, para evitar que string vazia vire 0.
    const match = await Match.finishMatch(
      matchId,
      numScoreA,
      numScoreB,
      numPenA,
      numPenB,
      numRegA,
      numRegB,
      qualifiedSide !== undefined ? qualifiedSide : null
    );

    const configId = toLeagueId(match.leagueId);
    const recalcResult = await pointsService.recalculateAllPoints(configId);

    const normalizedDate = parseMatchDate(match.date);
    if (normalizedDate) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      await trySaveDailyPoints(normalizedDate, String(match.leagueId || 'default'));
    }

    res.json({
      success: true,
      message: 'Partida finalizada e pontos recalculados',
      data: match,
      recalculated: recalcResult?.updated || 0
    });
  } catch (err) {
    console.error('Erro ao finalizar partida:', err);
    res.status(500).json({ success: false, message: err.message || 'Erro ao finalizar partida' });
  }
});

// ======================
// 7. POST /api/matches/admin/unfinish-bulk (Admin)
// ======================
router.post('/admin/unfinish-bulk', protect, admin, async (req, res) => {
  try {
    const { matchId, leagueName, groupName } = req.body;
    let filter = {};

    if (matchId) filter = { matchId: Number(matchId) };
    else if (leagueName && groupName) filter = { leagueName, group: groupName };
    else if (leagueName) filter = { leagueName };
    else return res.status(400).json({ success: false, message: 'Parâmetros insuficientes' });

    const matches = await Match.find(filter).select('matchId leagueId');
    const ids = matches.map(m => m.matchId);
    const affectedLeagueIds = [...new Set(matches.map(m => m.leagueId).filter(Boolean))];

    if (ids.length === 0) {
      return res.status(404).json({ success: false, message: 'Nenhuma partida encontrada' });
    }

    for (const id of ids) {
      await Match.unfinishMatch(id, 'scheduled');
    }

    for (const lid of affectedLeagueIds) {
      try {
        await pointsService.recalculateAllPoints(toLeagueId(lid));
      } catch (e) {
        console.error(`Erro ao recalcular liga ${lid}:`, e.message);
      }
    }

    res.json({
      success: true,
      message: `${ids.length} partida(s) reaberta(s) e pontos recalculadas.`
    });
  } catch (err) {
    console.error('❌ Erro no unfinish-bulk:', err);
    res.status(500).json({ success: false, message: 'Erro ao reabrir partidas' });
  }
});

// ======================
// 8. DELETE /api/matches/admin/delete-bulk (Admin)
// ======================
router.delete('/admin/delete-bulk', protect, admin, async (req, res) => {
  try {
    const { matchId, leagueName, groupName } = req.body;
    let filter = {};

    if (matchId) filter = { matchId: Number(matchId) };
    else if (leagueName && groupName) filter = { leagueName, group: groupName };
    else if (leagueName) filter = { leagueName };
    else return res.status(400).json({ success: false, message: 'Parâmetros insuficientes' });

    const matchesToDelete = await Match.find(filter).select('matchId leagueId');
    const ids = matchesToDelete.map(m => m.matchId);
    const affectedLeagueIds = [...new Set(matchesToDelete.map(m => m.leagueId).filter(Boolean))];

    if (ids.length === 0) return res.status(404).json({ success: false, message: 'Nada para excluir' });

    await Match.deleteMany({ matchId: { $in: ids } });

    // Remove as partidas das apostas e força recálculo para garantir consistência
    await Bet.updateMany(
      { 'groupMatches.matchId': { $in: ids } },
      { $pull: { groupMatches: { matchId: { $in: ids } } } }
    );

    for (const lid of affectedLeagueIds) {
      try {
        await pointsService.recalculateAllPoints(toLeagueId(lid));
      } catch (e) {
        console.error(`Erro ao recalcular liga ${lid}:`, e.message);
      }
    }

    res.json({ success: true, message: `${ids.length} partida(s) excluída(s) e pontos recalculados.` });
  } catch (err) {
    console.error('❌ Erro no delete-bulk:', err);
    res.status(500).json({ success: false, message: 'Erro ao excluir partidas' });
  }
});

// ======================
// 9. GET /api/matches/admin/settings/:leagueId (Admin)
// ======================
router.get('/admin/settings/:leagueId', protect, admin, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    const settings = await Settings.findById(leagueId).lean();

    if (!settings) {
      return res.status(404).json({ success: false, message: 'Configurações não encontradas para esta liga' });
    }

    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('Erro ao buscar settings:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar settings' });
  }
});

// ======================
// 10. PUT /api/matches/admin/settings/:leagueId (Admin)
// ======================
router.put('/admin/settings/:leagueId', protect, admin, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    const update = req.body;

    let settings = await Settings.findById(leagueId);

    if (!settings) {
      settings = new Settings({ _id: leagueId, leagueId });
    }

    const allowedFields = [
      'scoringRules',
      'championshipRules',
      'championshipResults',
      'status',
      'cron_interval',
      'api_leagues',
      'api_season',
      'blockSaveBets',
      'blockSaveKnockout',
      'requireAllBets',
      'unlockedPhases',
      'lockedPhases',
      'statsLocked',
      'lockedReason',
      'unlockAt'
    ];

    // 🆕 CORREÇÃO CRÍTICA: Para objetos aninhados, faz merge (spread) em vez de
    // sobrescrever o objeto inteiro, evitando apagar campos não enviados.
    allowedFields.forEach(field => {
      if (update[field] !== undefined) {
        if (field === 'scoringRules' || field === 'championshipRules' || field === 'championshipResults') {
          settings[field] = { ...(settings[field] || {}), ...update[field] };
        } else {
          settings[field] = update[field];
        }
      }
    });

    if (update.unlockAt) {
      settings.unlockAt = new Date(update.unlockAt);
    }

    await settings.save();

    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('Erro ao atualizar settings:', err);
    res.status(400).json({ success: false, message: err.message || 'Erro ao atualizar settings' });
  }
});

// ======================
// 11. POST /api/matches/admin/podium/:leagueId (Admin)
// ======================
router.post('/admin/podium/:leagueId', protect, admin, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    const { podium } = req.body;

    if (!Array.isArray(podium)) {
      return res.status(400).json({ success: false, message: 'Pódio deve ser um array de strings' });
    }

    const result = await pointsService.setPodium(leagueId, podium);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Erro ao definir pódio:', err);
    res.status(400).json({ success: false, message: err.message || 'Erro ao definir pódio' });
  }
});

// ======================
// 12. POST /api/matches/admin/podium/:leagueId/reset (Admin)
// ======================
router.post('/admin/podium/:leagueId/reset', protect, admin, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    const result = await pointsService.resetPodium(leagueId);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Erro ao resetar pódio:', err);
    res.status(400).json({ success: false, message: err.message || 'Erro ao resetar pódio' });
  }
});

// ======================
// 13. PUT /api/matches/admin/championship-results/:leagueId (Admin)
// ======================
router.put('/admin/championship-results/:leagueId', protect, admin, async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);
    const { topScorer, bestAttack, worstDefense, upset } = req.body;

    const settings = await Settings.findById(leagueId);
    if (!settings) {
      return res.status(404).json({ success: false, message: 'Configurações não encontradas' });
    }

    if (!settings.championshipResults) settings.championshipResults = {};
    if (topScorer !== undefined) settings.championshipResults.topScorer = topScorer ? String(topScorer).trim() : null;
    if (bestAttack !== undefined) settings.championshipResults.bestAttack = bestAttack ? String(bestAttack).trim() : null;
    if (worstDefense !== undefined) settings.championshipResults.worstDefense = worstDefense ? String(worstDefense).trim() : null;
    if (upset !== undefined) settings.championshipResults.upset = upset ? String(upset).trim() : null;

    await settings.save();

    const recalcResult = await pointsService.recalculateAllPoints(leagueId);

    res.json({
      success: true,
      message: 'Resultados oficiais atualizados e pontos recalculados',
      data: settings.championshipResults,
      recalculated: recalcResult?.updated || 0
    });
  } catch (err) {
    console.error('Erro ao atualizar resultados do campeonato:', err);
    res.status(400).json({ success: false, message: err.message || 'Erro ao atualizar resultados' });
  }
});

// ======================
// 14. GET /api/matches/stats (Público)
// ======================
router.get('/stats', async (req, res) => {
  try {
    const { leagueId } = req.query;

    let filtro = { status: 'finished' };

    // Normaliza leagueId
    const normalizedLeagueId = toLeagueId(leagueId);

    if (normalizedLeagueId !== 'default') {
      filtro.leagueId = normalizedLeagueId;
    }

    // Busca as regras da liga
    const settings = await Settings.findById(normalizedLeagueId).lean();

    // Mesma lógica de fallback usada no cálculo real de pontos
    const scoringRules = {
      exactScore: 5,
      scoreTeamA: 1,
      scoreTeamB: 1,
      winner: 2,
      qualifier: 3,
      ...(settings?.scoringRules || {})
    };

    // Garante valores numéricos válidos
    const exactScore = Math.max(0, Number(scoringRules.exactScore) || 0);
    const scoreTeamA = Math.max(0, Number(scoringRules.scoreTeamA) || 0);
    const scoreTeamB = Math.max(0, Number(scoringRules.scoreTeamB) || 0);
    const winner = Math.max(0, Number(scoringRules.winner) || 0);
    const qualifier = Math.max(0, Number(scoringRules.qualifier) || 0);

    // Máximo possível por partida:
    // Grupos / pontos corridos NÃO usam classificado.
    const groupPointsPerMatch =
      exactScore +
      scoreTeamA +
      scoreTeamB +
      winner;

    // Mata-mata usa também o classificado.
    const knockoutPointsPerMatch =
      exactScore +
      scoreTeamA +
      scoreTeamB +
      winner +
      qualifier;

    const groupFinished = await Match.countDocuments({
      ...filtro,
      $or: [
        { phase: 'group' },
        { phase: 'pontos_corridos' }
      ]
    });

    const knockoutFinished = await Match.countDocuments({
      ...filtro,
      $or: [
        { phase: 'knockout' },
        { phase: 'mata-mata' }
      ]
    });

    // Mantém a informação separada de pontos corridos
    const pontosCorridosFinished = await Match.countDocuments({
      ...filtro,
      phase: 'pontos_corridos'
    });

    res.json({
      success: true,
      data: {
        group: {
          finished: groupFinished,
          pointsPerMatch: groupPointsPerMatch
        },
        knockout: {
          finished: knockoutFinished,
          pointsPerMatch: knockoutPointsPerMatch
        },
        pontos_corridos: {
          finished: pontosCorridosFinished,
          pointsPerMatch: groupPointsPerMatch
        }
      }
    });

  } catch (err) {
    console.error('Match Stats Error:', err);

    res.status(500).json({
      success: false,
      message: 'Erro ao buscar estatísticas'
    });
  }
});

// ======================
// 15. GET /api/matches/rules/:leagueId (Público — Regras de Pontuação)
// ======================
router.get('/rules/:leagueId', async (req, res) => {
  try {
    const leagueId = toLeagueId(req.params.leagueId);

    const settings = await Settings.findById(leagueId).lean();

    if (!settings) {
      return res.status(404).json({ success: false, message: 'Configurações não encontradas para esta liga' });
    }

    res.json({
      success: true,
      data: {
        status: settings.status,
        scoringRules: settings.scoringRules || {},
        championshipRules: settings.championshipRules || {},
        podium: settings.podium || [],
        championshipResults: settings.status === 'finished'
          ? (settings.championshipResults || {})
          : null
      }
    });
  } catch (err) {
    console.error('Erro ao buscar regras da liga:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar regras da liga' });
  }
});

module.exports = router;
