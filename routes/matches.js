// routes/matches.js
const express = require('express');
const router = express.Router();

const Match = require('../models/Match');
const Bet    = require('../models/Bet');
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');
const { trySaveDailyPoints } = require('../services/dailyHistoryService');

// ---- helpers
function calcWinner(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
  if (na > nb) return 'A';
  if (nb > na) return 'B';
  return 'draw';
}

function parseMatchDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [day, month, year] = dateStr.split('/');
  if (!day || !month || !year) return null;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0));
}

// ==========================================
// 1. GET /api/matches/leagues (Ligas Disponíveis)
// ==========================================
router.get('/leagues', async (req, res) => {
  try {
    const leagues = await Match.aggregate([
      {
        $group: {
          _id: "$leagueId",
          name: { $first: "$leagueName" },
          totalMatches: { $sum: 1 }
        }
      },
      { $sort: { name: 1 } }
    ]);

    const data = leagues.map(l => ({
      id: l._id,
      name: l.name || `Liga ${l._id}`,
      count: l.totalMatches
    })).filter(l => l.id !== null);

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
    if (leagueId) {
      filtro.leagueId = Number(leagueId);
    }

    const matches = await Match.find(filtro).sort({ date: 1, time: 1 }).lean();
    res.json({ success: true, data: matches });
  } catch (err) {
    console.error('Erro ao listar partidas:', err);
    res.status(500).json({ success: false, message: 'Erro ao listar partidas' });
  }
});
// ======================
// 2.1 GET /api/matches/match-technical/:matchId (Alinhado com o Schema Real)
// ======================
router.get('/match-technical/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const { leagueId } = req.query;

    const match = await Match.findOne({ 
      matchId: Number(matchId), 
      leagueId: Number(leagueId) 
    }).lean();

    if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });

    // 🕒 Timeline: Note que no seu Schema o campo é 'min' e não 'minute'
    // E no seu Schema, o goalsDetail já parece conter cartões e substituições (pelo comentário)
    const timeline = (match.goalsDetail || []).sort((a, b) => (Number(a.min) || 0) - (Number(b.min) || 0));

    res.json({
      success: true,
      data: {
        matchId: match.matchId,
        status: match.status,
        
        // ⏱️ Tempo Real (Usando seus campos apiStatus e minute)
        currentTime: match.minute || "0", 
        apiStatus: match.apiStatus, 

        // 🔢 Placar e Penalidades
        score: {
          teamA: match.scoreA ?? 0,
          teamB: match.scoreB ?? 0,
          penaltiesA: match.penaltiesA,
          penaltiesB: match.penaltiesB
        },

        // ⏱️ Cronologia (Gols, Cartões, Subs)
        timeline, 

        // 📋 Escalações (Usando home/away como está no seu Schema)
        lineups: {
          teamA: match.lineups?.home || {},
          teamB: match.lineups?.away || {}
        },

        // 📊 Estatísticas e Posse
        summary: {
          possession: {
            teamA: `${match.possession?.home || 50}%`,
            teamB: `${match.possession?.away || 50}%`
          },
          // No seu Schema, statistics é um Array bruto da API
          rawStatistics: match.statistics || []
        }
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
    let filtro = {};
    if (leagueId) filtro.leagueId = Number(leagueId);

    const matches = await Match.find(filtro).sort({ date: 1, time: 1 }).lean();

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
// 4. POST /api/matches/admin/add (Admin)
// ======================
router.post('/admin/add', protect, admin, async (req, res) => {
  try {
    // Adicionado phaseName na desestruturação
    const { 
      matchId, teamA, teamB, date, time, group, phaseName, 
      stadium, phase, apiId, leagueId, leagueName 
    } = req.body;

    if (!matchId || !teamA || !teamB || !date || !time || (phase !== 'knockout' && !group)) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios ausentes' });
    }

    const idNum = Number(matchId);
    const exists = await Match.findOne({ matchId: idNum });
    if (exists) return res.status(409).json({ success: false, message: 'matchId já existe' });

    const m = await Match.create({
      matchId: idNum,
      apiId: apiId ? Number(apiId) : undefined,
      leagueId: leagueId ? Number(leagueId) : undefined,
      leagueName: leagueName ? String(leagueName).trim() : undefined,
      teamA: String(teamA).trim(),
      teamB: String(teamB).trim(),
      date: String(date).trim(),
      time: String(time).trim(),
      group: String(group).trim(),
      phaseName: phaseName ? String(phaseName).trim() : undefined, // ✨ Atualizado: Suporte a Rodadas
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
    const updates = {};
    
    // Lista de campos expandida para incluir phaseName
    const fields = [
      'teamA', 'teamB', 'date', 'time', 'group', 'phaseName', 
      'stadium', 'phase', 'status', 'scoreA', 'scoreB', 
      'apiId', 'penaltiesA', 'penaltiesB', 'leagueId', 'leagueName'
    ];

    fields.forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });

    // Tratamento de tipos e limpeza de strings
    if (updates.leagueName) updates.leagueName = String(updates.leagueName).trim();
    if (updates.phaseName) updates.phaseName = String(updates.phaseName).trim(); // ✨ Atualizado
    if (updates.group) updates.group = String(updates.group).trim();
    if (updates.leagueId) updates.leagueId = Number(updates.leagueId);

    const match = await Match.findOneAndUpdate(
      { matchId }, 
      { $set: updates }, 
      { new: true }
    );

    if (!match) return res.status(404).json({ success: false, message: 'Partida não encontrada' });

    res.json({ success: true, data: match });
  } catch (err) {
    console.error('Erro ao editar partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao editar partida' });
  }
});
// ======================
// 6. POST /api/matches/admin/finish/:matchId (Admin)
// ======================
router.post('/admin/finish/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const { scoreA, scoreB, penaltiesA, penaltiesB, qualifiedSide } = req.body;

    if (!Number.isFinite(matchId) || scoreA === undefined || scoreB === undefined) {
      return res.status(400).json({ success: false, message: 'matchId, scoreA e scoreB são obrigatórios' });
    }

    const match = await Match.finishMatch(
      matchId, 
      scoreA, 
      scoreB, 
      penaltiesA !== undefined ? penaltiesA : null, 
      penaltiesB !== undefined ? penaltiesB : null
    );

    if (qualifiedSide) {
      match.qualifiedSide = qualifiedSide;
      await match.save();
    }

    const resultWinner = match.winner; 

    const cursor = Bet.find({ 
      'groupMatches.matchId': matchId,
      leagueId: match.leagueId // 👈 Garante que só atualiza apostas da liga correta
    }).cursor();

    for await (const bet of cursor) {
      bet.groupMatches = (bet.groupMatches || []).map(gm => {
        if (gm.matchId === matchId) {
          const hitResult = gm.winner && gm.winner === resultWinner;
          gm.points = hitResult ? 1 : 0;

          let hitQualifier = false;
          const realQualifier = match.qualifiedSide || (resultWinner !== 'draw' ? resultWinner : null);
          
          if (gm.qualifier && (gm.qualifier === 'A' || gm.qualifier === 'B')) {
            if (realQualifier && gm.qualifier === realQualifier) hitQualifier = true;
          }
          gm.qualifierPoints = hitQualifier ? 1 : 0;
        }
        return gm;
      });

      bet.groupPoints = (bet.groupMatches || []).reduce((sum, gm) => sum + (gm.points || 0) + (gm.qualifierPoints || 0), 0);
      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
      bet.lastUpdate = new Date();
      await bet.save();
    }

    // 🔥 GATILHO CORRIGIDO: Agora enviamos a data E o leagueId
    const normalizedDate = parseMatchDate(match.date);
    if (normalizedDate) {
      console.log(`🚀 Iniciando checagem de snapshot diário para Liga: ${match.leagueId}`);
      await trySaveDailyPoints(normalizedDate, match.leagueId); 
    }

    res.json({ success: true, message: 'Partida finalizada e pontos atualizados', data: match });
  } catch (err) {
    console.error('Erro ao finalizar partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao finalizar partida' });
  }
});
// ============================================================
// AUXILIAR: RECALCULAR PONTOS DE UMA BET
// ============================================================
const recalculateBetPoints = (bet) => {
  bet.groupPoints = (bet.groupMatches || []).reduce((s, gm) => s + (gm.points || 0) + (gm.qualifierPoints || 0), 0);
  bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
  return bet;
};

// ============================================================
// 7. REABRIR (UNFINISH) - ÚNICA, GRUPO OU LIGA
// ============================================================
router.post('/admin/unfinish-bulk', protect, admin, async (req, res) => {
  try {
    const { matchId, leagueName, groupName } = req.body;
    let filter = {};

    // Define o escopo da reabertura
    if (matchId) filter = { matchId: Number(matchId) };
    else if (leagueName && groupName) filter = { leagueName, group: groupName };
    else if (leagueName) filter = { $or: [{ leagueName }, { group: leagueName }] };
    else return res.status(400).json({ success: false, message: 'Parâmetros insuficientes' });

    const matches = await Match.find(filter).select('matchId');
    const ids = matches.map(m => m.matchId);

    if (ids.length === 0) return res.status(404).json({ success: false, message: 'Nenhuma partida encontrada' });

    // 1. Resetar Partidas
    await Match.updateMany(filter, {
      $set: { status: 'scheduled', scoreA: null, scoreB: null, penaltiesA: null, penaltiesB: null },
      $unset: { qualifiedSide: 1 }
    });

    // 2. Resetar Pontos nos Palpites
    const cursor = Bet.find({ 'groupMatches.matchId': { $in: ids } }).cursor();
    for await (const bet of cursor) {
      bet.groupMatches = (bet.groupMatches || []).map(gm => {
        if (ids.includes(gm.matchId)) {
          gm.points = 0;
          gm.qualifierPoints = 0;
        }
        return gm;
      });
      await recalculateBetPoints(bet).save();
    }

    res.json({ success: true, message: `${ids.length} partida(s) reaberta(s).` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao reabrir partidas' });
  }
});

// ============================================================
// 8. EXCLUIR (DELETE) - ÚNICA, GRUPO OU LIGA
// ============================================================
router.delete('/admin/delete-bulk', protect, admin, async (req, res) => {
  try {
    const { matchId, leagueName, groupName } = req.body;
    let filter = {};

    if (matchId) filter = { matchId: Number(matchId) };
    else if (leagueName && groupName) filter = { leagueName, group: groupName };
    else if (leagueName) filter = { $or: [{ leagueName }, { group: leagueName }] };
    else return res.status(400).json({ success: false, message: 'Parâmetros insuficientes' });

    const matchesToDelete = await Match.find(filter).select('matchId');
    const ids = matchesToDelete.map(m => m.matchId);

    if (ids.length === 0) return res.status(404).json({ success: false, message: 'Nada para excluir' });

    // 1. Remover Partidas
    await Match.deleteMany({ matchId: { $in: ids } });

    // 2. Remover dos Palpites e Recalcular
    await Bet.updateMany(
      { 'groupMatches.matchId': { $in: ids } },
      { $pull: { groupMatches: { matchId: { $in: ids } } } }
    );

    const cursor = Bet.find({ 'groupMatches.matchId': { $in: ids } }).cursor(); // Otimizado: só quem tinha essas bets
    const allBetsCursor = Bet.find().cursor(); // Para garantir integridade, rodamos em todos
    
    for await (const bet of allBetsCursor) {
      await recalculateBetPoints(bet).save();
    }

    res.json({ success: true, message: `${ids.length} partida(s) excluída(s) e pontos atualizados.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao excluir bulk' });
  }
});
// ======================
// 9. GET & PUT /api/matches/admin/settings (Admin)
// ======================
router.get('/admin/settings', protect, admin, async (req, res) => {
  try {
    const settings = await Settings.findById('global_settings').lean();
    res.json({ success: true, data: settings || { statsLocked: false } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar settings' });
  }
});

router.put('/admin/settings', protect, admin, async (req, res) => {
  try {
    const update = req.body;
    if (update.unlockAt) update.unlockAt = new Date(update.unlockAt);
    const settings = await Settings.findByIdAndUpdate('global_settings', { $set: update }, { new: true, upsert: true });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar settings' });
  }
});

// ======================
// 10. GET /api/matches/stats (Público)
// ======================
router.get('/stats', async (req, res) => {
  try {
    const { leagueId } = req.query;
    let filtro = { status: 'finished' };
    if (leagueId) filtro.leagueId = Number(leagueId);

    const groupFinished = await Match.countDocuments({ ...filtro, phase: 'group' });
    const knockoutFinished = await Match.countDocuments({ ...filtro, phase: 'knockout' });

    res.json({
      success: true,
      data: {
        group: { finished: groupFinished, pointsPerMatch: 1 },
        knockout: { finished: knockoutFinished, pointsPerMatch: 2 }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao buscar estatísticas' });
  }
});

module.exports = router;
