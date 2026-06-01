/ routes/matches.js
const express = require('express');
const router = express.Router();

// ==========================================
// MODELS & MIDDLEWARES
// ==========================================
const Match = require('../models/Match');
const Bet = require('../models/Bet');
const Settings = require('../models/Settings');
const User = require('../models/User'); // Necessário para buscar e-mails na auditoria
const { protect, admin } = require('../middleware/auth');

// ==========================================
// SERVICES
// ==========================================
const { trySaveDailyPoints } = require('../services/dailyHistoryService');
const auditService = require('../services/auditService'); // Necessário para auditoria do Admin
const emailService = require('../services/emailService'); // Necessário para envio de e-mails do Admin
const { recalculateAllPoints } = require('../services/pointsService'); // Descomente e ajuste o caminho se a função for global

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
// ==========================================
// 1. GET /api/matches/leagues (Ligas Disponíveis)
// ==========================================
router.get('/leagues', async (req, res) => {
  try {
    const leagues = await Match.aggregate([
      {
        // 1. Removemos o filtro de status para que a liga não suma quando tudo terminar
        $match: { leagueId: { $ne: null } }
      },
      {
        // 2. Agrupamos por Liga e guardamos os detalhes das partidas
        $group: {
          _id: "$leagueId",
          name: { $first: "$leagueName" },
          // Contamos apenas partidas 'scheduled' para o 'count' de apostas disponíveis
          totalMatches: { 
            $sum: { $cond: [{ $eq: ["$status", "scheduled"] }, 1, 0] } 
          },
          allMatches: {
            $push: {
              date: "$date",
              time: "$time",
              teamA: "$teamA",
              teamB: "$teamB",
              status: "$status" // Adicionado para filtrar o próximo jogo abaixo
            }
          }
        }
      },
      { $sort: { name: 1 } }
    ]);

    const data = leagues.map(l => {
      // Filtramos apenas as partidas que ainda vão acontecer para definir o 'nextMatchDate'
      const scheduledMatches = l.allMatches.filter(m => m.status === 'scheduled');

      // Ordenamos as partidas agendadas da liga para garantir que a primeira seja a mais próxima
      const sortedMatches = scheduledMatches.sort((a, b) => {
        const [da, ma, ya] = a.date.split('/');
        const [db, mb, yb] = b.date.split('/');
        return new Date(`${ya}-${ma}-${da}T${a.time}`) - new Date(`${yb}-${mb}-${db}T${b.time}`);
      });

      const next = sortedMatches[0]; // A partida agendada mais próxima
      let isoDate = null;

      if (next) {
        const [d, m, y] = next.date.split('/');
        isoDate = `${y}-${m}-${d}T${next.time}:00`;
      }

      return {
        id: l._id,
        name: l.name || `Liga ${l._id}`,
        // count agora reflete apenas jogos abertos (0 se a rodada acabou)
        count: l.totalMatches,
        nextMatchDate: isoDate,
        // Se não houver próximo jogo, o ternário mantém o seu padrão de string
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
// GET /api/matches/match-technical/:matchId
// ======================
router.get('/match-technical/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const { leagueId } = req.query;

    // .lean() para performance (retorna objeto JS puro)
    const match = await Match.findOne({
      matchId: Number(matchId),
      leagueId: Number(leagueId)
    }).lean();

    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'Partida não encontrada'
      });
    }

    // 🕒 Timeline ordenada por minuto (incluindo tempo extra)
    const timeline = (match.goalsDetail || []).sort((a, b) => {
      const minA = (a.min || 0) + (a.extra || 0);
      const minB = (b.min || 0) + (b.extra || 0);
      return minA - minB;
    });

    // 🔥 MAPEAMENTO DE ESCALAÇÕES (Sincroniza Banco -> Front-end)
    const lineupHome = match.lineups?.home || {};
    const lineupAway = match.lineups?.away || {};

    res.json({
      success: true,
      data: {
        matchId: match.matchId,
        status: match.status,
        apiStatus: match.apiStatus,
        currentTime: match.minute || "0",

        // 🔢 PLACAR E DECISÕES
        score: {
          teamA: match.scoreA ?? 0,
          teamB: match.scoreB ?? 0,
          penaltiesA: match.penaltiesA ?? null,
          penaltiesB: match.penaltiesB ?? null,
          qualifiedSide: match.qualifiedSide ?? null
        },

        // 📈 DADOS AVANÇADOS (SPATIAL API)
        advanced: {
          xg: match.xg || { home: 0, away: 0 },
          odds: match.odds || { home: null, draw: null, away: null },
          aiAnalysis: match.ai_analysis || '',
          videoUrl: match.video_url || ''
        },

        // ⏱️ EVENTOS DA PARTIDA
        timeline,

        // 📋 ESCALAÇÕES (Trata a mudança de 'players' para 'titulares' no JSON)
        lineups: {
          teamA: {
            formation: lineupHome.formation || "",
            titulares: lineupHome.players || [],       // Vem de 'players' no banco
            reservas: lineupHome.substitutes || []     // Vem de 'substitutes' no banco
          },
          teamB: {
            formation: lineupAway.formation || "",
            titulares: lineupAway.players || [],       // Vem de 'players' no banco
            reservas: lineupAway.substitutes || []     // Vem de 'substitutes' no banco
          },
          confirmed: match.lineups?.confirmed || false,
          unavailable: match.unavailable || []
        },

        // 📊 RESUMO DE ESTATÍSTICAS
        summary: {
          possession: {
            teamA: match.possession?.home ?? 50,
            teamB: match.possession?.away ?? 50
          },
          // STATISTICS agora é o objeto live_stats completo
          stats: match.statistics || {}
        },

        // 📍 INFORMAÇÕES ADICIONAIS
        venue: match.stadium || 'Não informado'
      }
    });

  } catch (e) {
    console.error('Match Technical Error:', e);
    res.status(500).json({
      success: false,
      message: 'Erro ao carregar detalhes técnicos'
    });
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
    if (updates.phaseName) updates.phaseName = String(updates.phaseName).trim(); 
    if (updates.group) updates.group = String(updates.group).trim();
    if (updates.leagueId) updates.leagueId = Number(updates.leagueId);

    // 1. BUSCA A PARTIDA ANTES DA ATUALIZAÇÃO (Essencial para saber o status antigo)
    const oldMatch = await Match.findOne({ matchId });
    if (!oldMatch) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    // Ajuste inteligente do minuto baseado no novo status enviado pelo Admin
    if (updates.status === 'finished') {
      updates.minute = "Fim";
    } else if (updates.status === 'ao_vivo' && !updates.minute) {
      updates.minute = "0'";
    }

    // 2. ATUALIZA A PARTIDA NO BANCO
    const updatedMatch = await Match.findOneAndUpdate(
      { matchId }, 
      { $set: updates }, 
      { new: true }
    );

    // 3. GATILHO DAS TRAVAS, VISIBILIDADE E AUDITORIA
    // Verifica se o status mudou de 'scheduled' para um status válido de jogo iniciado
    if (updates.status && oldMatch.status === 'scheduled' && !['scheduled', 'cancelled'].includes(updates.status)) {
      const configId = `league_${updatedMatch.leagueId || 1}`;
      const lockIdentifier = updatedMatch.phaseName || updatedMatch.group;

      // Executa a mesma trava do Settings que o robô faria
      const settingsUpdated = await Settings.findOneAndUpdate(
        { _id: configId, lockedPhases: { $ne: lockIdentifier } },
        {
          $addToSet: { 
            lockedPhases: lockIdentifier, 
            unlockedPhases: { $each: [lockIdentifier, 'podium'] } 
          },
          $set: { statsLocked: false, blockSaveBets: true, blockSaveKnockout: true }
        },
        { new: true }
      );

      // Se for a primeira partida da rodada a iniciar, gera o Excel e dispara os e-mails
      if (settingsUpdated) {
        try {
          const csv = await auditService.generateAuditCSV(updatedMatch.leagueId || 1, lockIdentifier);
          if (csv) {
            const users = await User.find({ leagues: Number(updatedMatch.leagueId || 1) }, 'email');
            const emails = users.map((u) => u.email).filter(Boolean);
            
            if (emails.length > 0) {
              await emailService.sendBroadcastEmail(
                emails, 
                `🔒 Auditoria Manual (Painel Admin): ${lockIdentifier}`, 
                `A rodada/fase foi trancada manualmente pelo administrador. Partida disparadora: ${updatedMatch.teamA} x ${updatedMatch.teamB}.`, 
                csv
              );
            }
          }
        } catch (auditErr) {
          console.error('❌ [ADMIN AUDIT]: Erro na auditoria manual:', auditErr.message);
        }
      }
    }

    // 4. GATILHO DE RECALCULO DE PONTOS E HISTÓRICO DIÁRIO (Se o admin encerrou o jogo manualmente)
    if (updates.status === 'finished' && oldMatch.status !== 'finished') {
      try {
        // Executa a sua função/lógica padrão de pontuação do sistema
        if (typeof recalculateAllPoints === 'function') {
          await recalculateAllPoints(updatedMatch.leagueId || 1);
        }

        // 🌟 Injeção do mini-delay de 3s e chamada do Snapshot Diário
        const normalizedDate = parseMatchDate(updatedMatch.date);
        if (normalizedDate) {
          console.log(`⏳ [ADMIN EDIT] Aguardando persistência dos dados no MongoDB (3s)...`);
          await new Promise(resolve => setTimeout(resolve, 3000));

          console.log(`🚀 [ADMIN EDIT] Iniciando checagem de snapshot diário para Liga: ${updatedMatch.leagueId || 1}`);
          await trySaveDailyPoints(normalizedDate, updatedMatch.leagueId || 1); 
        }
      } catch (pointsErr) {
        console.error('❌ [ADMIN POINTS/SNAPSHOT]: Erro ao processar pontos ou histórico diário:', pointsErr.message);
      }
    }

    res.json({ success: true, data: updatedMatch });
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
      await new Promise(resolve => setTimeout(resolve, 3000));
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
// 7. REABRIR (UNFINISH) - ÚNICA, GRUPO OU LIGA (ATUALIZADO)
// ============================================================
router.post('/admin/unfinish-bulk', protect, admin, async (req, res) => {
  try {
    const { matchId, leagueName, groupName } = req.body;
    let filter = {};

    // Define o escopo da reabertura (Mantido original)
    if (matchId) filter = { matchId: Number(matchId) };
    else if (leagueName && groupName) filter = { leagueName, group: groupName };
    else if (leagueName) filter = { $or: [{ leagueName }, { group: leagueName }] };
    else return res.status(400).json({ success: false, message: 'Parâmetros insuficientes' });

    // Busca as partidas afetadas pelo filtro
    const matches = await Match.find(filter).select('matchId');
    const ids = matches.map(m => m.matchId);

    if (ids.length === 0) {
      return res.status(404).json({ success: false, message: 'Nenhuma partida encontrada' });
    }

    // 1. Resetar Partidas uma a uma usando o método estático atualizado do seu Model
    // Isso garante que os minutos, cronômetros, xg e lineups sejam limpos e dispara o SSE/ChangeStream
    for (const id of ids) {
      await Match.unfinishMatch(id, 'scheduled');
    }

    console.log(`[🔄 UNFINISH BULK] ${ids.length} partida(s) limpa(s) e reaberta(s) para 'scheduled'. IDs:`, ids);

    // 2. Resetar Pontos nos Palpites (Atualizado para garantir compatibilidade de tipos)
    const cursor = Bet.find({ 'groupMatches.matchId': { $in: ids } }).cursor();
    
    for await (const bet of cursor) {
      let betAlterada = false;

      bet.groupMatches = (bet.groupMatches || []).map(gm => {
        // Força a comparação segura convertendo ambos para Number
        if (ids.includes(Number(gm.matchId))) {
          gm.points = 0;
          gm.qualifierPoints = 0;
          betAlterada = true;
        }
        return gm;
      });

      // Só salva e recalcula se a aposta realmente possuía algum dos jogos afetados
      if (betAlterada) {
        if (typeof recalculateBetPoints === 'function') {
          await recalculateBetPoints(bet);
        }
        await bet.save();
      }
    }

    res.json({ 
      success: true, 
      message: `${ids.length} partida(s) reaberta(s). Placar, cronômetros e pontos dos usuários foram expurgados.` 
    });

  } catch (err) {
    console.error('❌ Erro no unfinish-bulk:', err);
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
