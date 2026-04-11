// routes/matches.js
const express = require('express');
const router = express.Router();

const Match = require('../models/Match');
const Bet   = require('../models/Bet');
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');
const { trySaveDailyPoints } = require('../services/dailyHistoryService');

// ---- helper
function calcWinner(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
  if (na > nb) return 'A';
  if (nb > na) return 'B';
  return 'draw';
}
/**
 * Converte "DD/MM/YYYY" → Date UTC (00:00)
 * Evita erro MM/DD e dia > 12
 */
function parseMatchDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const [day, month, year] = dateStr.split('/');
  if (!day || !month || !year) return null;

  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    0, 0, 0
  ));
}

// ======================
// GET /api/matches  (público)
// ======================
router.get('/', async (req, res) => {
  try {
    const matches = await Match.find().sort({ matchId: 1 }).lean();
    res.json({ success: true, data: matches });
  } catch (err) {
    console.error('Erro ao listar partidas:', err);
    res.status(500).json({ success: false, message: 'Erro ao listar partidas' });
  }
});

// ======================
// GET /api/matches/admin/all  (admin)
// ======================
router.get('/admin/all', protect, admin, async (req, res) => {
  try {
    const matches = await Match.find().sort({ matchId: 1 }).lean();

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
// POST /api/matches/admin/add  (admin)
// ======================
router.post('/admin/add', protect, admin, async (req, res) => {
  try {
    const { matchId, teamA, teamB, date, time, group, stadium, phase, apiId } = req.body;

    if (!matchId || !teamA || !teamB || !date || !time || (phase !== 'knockout' && !group)) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios ausentes' });
    }

    const idNum = Number(matchId);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ success: false, message: 'matchId inválido' });
    }

    const exists = await Match.findOne({ matchId: idNum });
    if (exists) {
      return res.status(409).json({ success: false, message: 'matchId já existe' });
    }

    const m = await Match.create({
      matchId: idNum,
      apiId: apiId ? Number(apiId) : undefined, // Suporte ao ID da API externa
      teamA: String(teamA).trim(),
      teamB: String(teamB).trim(),
      date: String(date).trim(),
      time: String(time).trim(),
      group: String(group).trim(),
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
// PUT /api/matches/admin/edit/:matchId  (admin)
// ======================
router.put('/admin/edit/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    if (!Number.isFinite(matchId)) {
      return res.status(400).json({ success: false, message: 'matchId inválido' });
    }

    const updates = {};
    const fields = [
      'teamA','teamB','date','time','group','stadium',
      'phase','status','scoreA','scoreB','apiId','penaltiesA','penaltiesB'
    ];

    fields.forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });

    // Sanitização de Strings
    if (updates.teamA) updates.teamA = String(updates.teamA).trim();
    if (updates.teamB) updates.teamB = String(updates.teamB).trim();
    if (updates.date)  updates.date  = String(updates.date).trim();
    if (updates.time)  updates.time  = String(updates.time).trim();
    if (updates.group) updates.group = String(updates.group).trim();
    if (updates.stadium) updates.stadium = String(updates.stadium).trim();

    // Coerção de Números
    if (updates.apiId !== undefined) updates.apiId = updates.apiId === '' ? null : Number(updates.apiId);
    if (updates.scoreA !== undefined) updates.scoreA = updates.scoreA === '' ? null : Number(updates.scoreA);
    if (updates.scoreB !== undefined) updates.scoreB = updates.scoreB === '' ? null : Number(updates.scoreB);
    if (updates.penaltiesA !== undefined) updates.penaltiesA = updates.penaltiesA === '' ? null : Number(updates.penaltiesA);
    if (updates.penaltiesB !== undefined) updates.penaltiesB = updates.penaltiesB === '' ? null : Number(updates.penaltiesB);

    // Validação de Status Finished
    if (updates.status === 'finished' && (updates.scoreA === null || updates.scoreB === null)) {
      return res.status(400).json({
        success: false,
        message: 'Para finalizar, informe scoreA e scoreB.'
      });
    }

    const match = await Match.findOneAndUpdate({ matchId }, { $set: updates }, { new: true });
    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    res.json({ success: true, data: match });
  } catch (err) {
    console.error('Erro ao editar partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao editar partida' });
  }
});

// ======================
// POST /api/matches/admin/finish/:matchId
// ======================
router.post('/admin/finish/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    const { scoreA, scoreB, penaltiesA, penaltiesB, qualifiedSide } = req.body;

    if (!Number.isFinite(matchId) || scoreA === undefined || scoreB === undefined) {
      return res.status(400).json({ success: false, message: 'matchId, scoreA e scoreB são obrigatórios' });
    }

    // Usamos o método estático finishMatch definido no Model para garantir consistência
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

    // O Virtual 'winner' agora resolve se foi A, B ou Draw (D) considerando pênaltis
    const resultWinner = match.winner; 

    // Atualiza apostas desse jogo
    const cursor = Bet.find({ 'groupMatches.matchId': matchId }).cursor();
    
    for await (const bet of cursor) {
      bet.groupMatches = (bet.groupMatches || []).map(gm => {
        if (gm.matchId === matchId) {
          // 1. Acertou o vencedor/empate no tempo regulamentar? (1 ponto)
          // Nota: Ajuste se seu bolão pontua o vencedor APÓS pênaltis ou só tempo normal
          const hitResult = gm.winner && gm.winner === resultWinner;
          gm.points = hitResult ? 1 : 0;

          // 2. Acertou o classificado? (1 ponto)
          let hitQualifier = false;
          const realQualifier = match.qualifiedSide || (resultWinner !== 'D' ? resultWinner : null);
          
          if (gm.qualifier && (gm.qualifier === 'A' || gm.qualifier === 'B')) {
            if (realQualifier && gm.qualifier === realQualifier) {
              hitQualifier = true;
            }
          }
          gm.qualifierPoints = hitQualifier ? 1 : 0;
        }
        return gm;
      });

      // 3. Recálculo dos totais da aposta
      bet.groupPoints = (bet.groupMatches || []).reduce((sum, gm) => {
        return sum + (gm.points || 0) + (gm.qualifierPoints || 0);
      }, 0);

      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
      bet.lastUpdate = new Date();

      await bet.save();
    }

    // TENTA SALVAR O HISTÓRICO DIÁRIO
    const normalizedDate = parseMatchDate(match.date);
    if (normalizedDate) {
      await trySaveDailyPoints(normalizedDate);
    }

    res.json({
      success: true,
      message: 'Partida finalizada e pontos atualizados',
      data: {
        matchId: match.matchId,
        scoreA: match.scoreA,
        scoreB: match.scoreB,
        penaltiesA: match.penaltiesA,
        penaltiesB: match.penaltiesB,
        winner: resultWinner,
      },
    });
  } catch (err) {
    console.error('Erro ao finalizar partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao finalizar partida' });
  }
});

// ======================
// POST /api/matches/admin/unfinish/:matchId  (admin)
// - volta para 'scheduled', zera placar
// - zera pontos desse jogo nas apostas e recalcula totais
// ======================
// ======================
// POST /api/matches/admin/unfinish/:matchId
// ======================
router.post('/admin/unfinish/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    if (!Number.isFinite(matchId)) {
      return res.status(400).json({ success: false, message: 'matchId inválido' });
    }

    // 1. Volta status, remove placares/qualificado e define pênaltis como null
    const match = await Match.findOneAndUpdate(
      { matchId },
      { 
        $set: { 
          status: 'scheduled',
          penaltiesA: null,    // Define como null conforme solicitado
          penaltiesB: null     // Define como null conforme solicitado
        }, 
        $unset: { 
          scoreA: 1, 
          scoreB: 1, 
          qualifiedSide: 1 
        } 
      },
      { new: true }
    );

    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    // 2. Limpa os pontos das apostas para este jogo específico
    const cursor = Bet.find({ 'groupMatches.matchId': matchId }).cursor();
    for await (const bet of cursor) {
      bet.groupMatches = (bet.groupMatches || []).map(gm => {
        if (gm.matchId === matchId) {
          gm.points = 0;           // Zera pontos de acerto de vencedor
          gm.qualifierPoints = 0;  // Zera pontos de quem passa de fase (mata-mata)
        }
        return gm;
      });

      // 3. Recalcula o total da aposta
      bet.groupPoints = (bet.groupMatches || []).reduce((s, gm) => {
        return s + (gm.points || 0) + (gm.qualifierPoints || 0);
      }, 0);

      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
      bet.lastUpdate = new Date();
      
      await bet.save();
    }

    res.json({ 
      success: true, 
      message: 'Partida reaberta: Placares removidos e Pênaltis definidos como null.' 
    });
  } catch (err) {
    console.error('Erro ao reabrir partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao reabrir partida' });
  }
});
// ======================
// DELETE /api/matches/admin/delete/:matchId  (admin)
// - remove a partida
// - remove o jogo das apostas e recalcula totais
// ======================
router.delete('/admin/delete/:matchId', protect, admin, async (req, res) => {
  try {
    const matchId = Number(req.params.matchId);
    if (!Number.isFinite(matchId)) {
      return res.status(400).json({ success: false, message: 'matchId inválido' });
    }

    const removed = await Match.findOneAndDelete({ matchId });
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    const cursor = Bet.find({ 'groupMatches.matchId': matchId }).cursor();
    for await (const bet of cursor) {
      bet.groupMatches = (bet.groupMatches || []).filter(gm => gm.matchId !== matchId);
      bet.groupPoints = (bet.groupMatches || []).reduce((s, gm) => s + (gm.points || 0), 0);
      bet.totalPoints = (bet.groupPoints || 0) + (bet.podiumPoints || 0) + (bet.bonusPoints || 0);
      bet.lastUpdate = new Date();
      await bet.save();
    }

    res.json({ success: true, message: 'Partida excluída e apostas ajustadas' });
  } catch (err) {
    console.error('Erro ao excluir partida:', err);
    res.status(500).json({ success: false, message: 'Erro ao excluir partida' });
  }
});


// ======================
// GET /api/matches/admin/settings  (admin)
// ======================
router.get('/admin/settings', protect, admin, async (req, res) => {
  try {
    const settings = await Settings.findById('global_settings').lean();

    res.json({
      success: true,
      data: settings || {
        statsLocked: false,
        lockedReason: null,
        unlockAt: null
      }
    });
  } catch (err) {
    console.error('Erro ao buscar settings:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar configurações globais'
    });
  }
});




// ======================
// PUT /api/matches/admin/settings  (admin)
// ======================
router.put('/admin/settings', protect, admin, async (req, res) => {
  try {
    const { statsLocked, lockedReason, unlockAt } = req.body;

    const update = {};

    if (typeof statsLocked === 'boolean') {
      update.statsLocked = statsLocked;
    }

    if (typeof lockedReason === 'string' || lockedReason === null) {
      update.lockedReason = lockedReason;
    }

    if (unlockAt) {
      update.unlockAt = new Date(unlockAt);
    } else if (unlockAt === null) {
      update.unlockAt = null;
    }

    const settings = await Settings.findByIdAndUpdate(
      'global_settings',
      { $set: update },
      { new: true, upsert: true }
    );

    res.json({
      success: true,
      message: 'Configurações atualizadas',
      data: settings
    });
  } catch (err) {
    console.error('Erro ao atualizar settings:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao atualizar configurações'
    });
  }
});




// ======================
// GET /api/matches/stats  (público ou protegido — você escolhe)
// Retorna total de partidas finalizadas por fase
// ======================
router.get('/stats', async (req, res) => {
  try {
    const groupFinished = await Match.countDocuments({
      status: 'finished',
      phase: 'group'
    });

    const knockoutFinished = await Match.countDocuments({
      status: 'finished',
      phase: 'knockout'
    });

    res.json({
      success: true,
      data: {
        group: {
          finished: groupFinished,
          pointsPerMatch: 1
        },
        knockout: {
          finished: knockoutFinished,
          pointsPerMatch: 2
        }
      }
    });
  } catch (err) {
    console.error('Erro ao buscar stats de partidas:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar estatísticas de partidas'
    });
  }
});


module.exports = router;
