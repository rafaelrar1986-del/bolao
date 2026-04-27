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
 * 🛠️ HELPERS
 */
const getConfigId = (leagueId) => {
  const id = leagueId || '1';
  return `league_${id}`;
};

function toWinnerLabel(choice, teamA, teamB) {
  if (choice === 'A') return teamA || 'Time A';
  if (choice === 'B') return teamB || 'Time B';
  if (choice === 'draw') return 'Empate';
  return '-';
}

/**
 * 🧠 ESTRATÉGIA: Caminho da Liderança (Versão Final Refatorada)
 * Inclui: Probabilidade Real, Verificação de Times Vivos e Teto de Pontos.
 */
router.get('/leadership-path', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { leagueId, userId: targetUserId } = req.query;
    if (!leagueId) return res.status(400).json({ success: false, message: 'ID da liga obrigatório' });

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);
    
    // Suporte para ver estratégia de outros (ou a própria)
    const activeUserId = targetUserId || req.user._id.toString();
    const isAdmin = req.user?.isAdmin === true;

    // 1. Carga de Dados
    const configId = `league_${leagueId}`;
    const [settings, matches, bets] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: lIdNum }).lean(),
      Bet.find({ hasSubmitted: true, leagueId: lIdStr }).populate('user', 'name').lean()
    ]);

    const unlockedPhases = settings?.unlockedPhases || [];
    const targetBet = bets.find(b => b.user._id.toString() === activeUserId);
    if (!targetBet) return res.status(404).json({ success: false, message: 'Aposta não encontrada' });

    // 2. Lógica de Times Vivos (Ajustada para entender Pênaltis com .lean())
const eliminatedTeams = new Set();
matches.forEach(m => {
  if (m.status === 'finished' && m.phase === 'knockout') {
    // Como o .lean() remove o virtual 'winner', calculamos a lógica aqui:
    let winnerSide;
    if (m.penaltiesA !== null && m.penaltiesB !== null) {
      winnerSide = m.penaltiesA > m.penaltiesB ? 'A' : 'B';
    } else {
      winnerSide = m.scoreA > m.scoreB ? 'A' : (m.scoreA < m.scoreB ? 'B' : null);
    }

    const loser = winnerSide === 'A' ? m.teamB : (winnerSide === 'B' ? m.teamA : null);

    // Times que perdem a semi ainda disputam 3º, logo não estão "mortos" para o pódio
    if (loser && m.group !== 'semifinal') eliminatedTeams.add(loser);
  }
});
    const futureMatches = matches
      .filter(m => m.status === 'scheduled')
      .sort((a, b) => a.matchId - b.matchId);

    // 3. Cálculo do Potencial de Pódio (Baseado no PointService)
    const leaguePodium = settings?.podium || {};
    const podiumWeights = { first: 7, second: 4, third: 2, fourth: 2 };
    let myPodiumPotential = 0;

    // Só calculamos potencial se o pódio oficial da liga ainda não foi definido pelo ADM
    if (!leaguePodium.first && targetBet.podium) {
        const p = targetBet.podium;
        if (p.first && !eliminatedTeams.has(p.first)) myPodiumPotential += podiumWeights.first;
        if (p.second && !eliminatedTeams.has(p.second)) myPodiumPotential += podiumWeights.second;
        if (p.third && !eliminatedTeams.has(p.third)) myPodiumPotential += podiumWeights.third;
        if (p.fourth && !eliminatedTeams.has(p.fourth)) myPodiumPotential += podiumWeights.fourth;
    }

    // 4. Projeção de Ranking (Cenário de Ouro)
    const projectedRanking = bets.map(b => {
      let projectedPoints = b.totalPoints || 0;
      const isTarget = b.user._id.toString() === activeUserId;

      futureMatches.forEach(m => {
        const targetPick = targetBet.groupMatches.find(gm => gm.matchId === m.matchId);
        const rivalPick = b.groupMatches.find(gm => gm.matchId === m.matchId);

        if (isTarget) {
          // No seu cenário de ouro, você acerta vencedor (1) e se for mata-mata, classificado (+1)
          projectedPoints += 1;
          if (m.phase === 'knockout') projectedPoints += 1;
        } else if (targetPick && rivalPick) {
          // Rivais só pontuam se copiaram sua aposta exata
          if (targetPick.winner === rivalPick.winner) projectedPoints += 1;
          if (m.phase === 'knockout' && targetPick.qualifier === rivalPick.qualifier) projectedPoints += 1;
        }
      });

      // Soma o pódio vivo apenas para o alvo da análise
      if (isTarget) projectedPoints += myPodiumPotential;

      return { userId: b.user?._id.toString(), name: b.user?.name, totalPoints: projectedPoints };
    });

    // 5. Ordenação e Posição Máxima
    projectedRanking.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
    
    let lastPoints = null, position = 0, myMaxPosition = 0;
    projectedRanking.forEach((item, index) => {
      if (lastPoints === null || item.totalPoints !== lastPoints) {
        position = index + 1;
        lastPoints = item.totalPoints;
      }
      if (item.userId === activeUserId) myMaxPosition = position;
    });

    // 6. Cálculo da Probabilidade Estatística e Teto
    const leaderPoints = Math.max(...bets.map(b => b.totalPoints || 0), 0);
    let matchPointsLeft = 0;
    futureMatches.forEach(m => {
      matchPointsLeft += 1;
      if (m.phase === 'knockout') matchPointsLeft += 1;
    });

    const totalPotentialDisputed = matchPointsLeft + myPodiumPotential;
    const myMaxTotal = (targetBet.totalPoints || 0) + totalPotentialDisputed;
    const gap = leaderPoints - (targetBet.totalPoints || 0);

    let probability = 0;
    if (myMaxTotal >= leaderPoints) {
      if (gap <= 0) {
        const advantage = Math.abs(gap);
        probability = Math.min(99, 75 + (advantage * 5)); 
      } else {
        // Proteção contra divisão por zero se não houver mais jogos
        const reachability = totalPotentialDisputed > 0 ? (totalPotentialDisputed - gap) / totalPotentialDisputed : 0;
        probability = Math.max(1, Math.round(reachability * 70));
      }
    }

    // 7. Mapeamento de Impacto (Secagem)
    const matchesAnalysis = futureMatches.map(m => {
      let isLocked = !isAdmin;
      if (m.phase === 'group') {
        isLocked = !unlockedPhases.includes('group');
      } else {
        isLocked = !unlockedPhases.includes(m.group);
      }

      const myPick = targetBet.groupMatches.find(gm => gm.matchId === m.matchId);
      const rivalsAbove = bets.filter(b => (b.totalPoints || 0) > (targetBet.totalPoints || 0));
      
      const opponentsToWatch = isLocked 
        ? ["Conteúdo Bloqueado 🔒"] 
        : rivalsAbove.filter(rb => {
            const rp = rb.groupMatches.find(gm => gm.matchId === m.matchId);
            if (!rp) return false;
            const diffWin = rp.winner !== myPick?.winner;
            const diffQualy = m.phase === 'knockout' && rp.qualifier !== myPick?.qualifier;
            return diffWin || diffQualy;
          }).map(rb => rb.user?.name);

      return {
        matchId: m.matchId,
        teams: `${m.teamA} x ${m.teamB}`,
        hasImpact: opponentsToWatch.length > 0,
        isLocked,
        myChoice: { 
          winner: myPick?.winner, 
          label: toWinnerLabel(myPick?.winner, m.teamA, m.teamB),
          qualifier: myPick?.qualifier 
        },
        opponentsToWatch
      };
    });

    res.json({
      success: true,
      data: {
        summary: { 
          maxPosition: myMaxPosition, 
          canReachFirst: myMaxPosition === 1, 
          probability: probability,
          totalMatches: futureMatches.length,
          currentPoints: targetBet.totalPoints || 0,
          podiumPotential: myPodiumPotential,
          maxPoints: myMaxTotal // << ADICIONADO PARA O FRONTEND
        },
        matches: matchesAnalysis
      }
    });

  } catch (e) {
    console.error('Leadership Path Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao calcular estratégia' });
  }
});

function toWinnerLabel(winner, teamA, teamB) {
  if (winner === 'A') return teamA;
  if (winner === 'B') return teamB;
  if (winner === 'draw') return 'Empate';
  return 'N/D';
}
/**
 * 🎯 Meus palpites (Filtrado por Liga)
 * Corrigido para evitar conflito entre ligas
 */
router.get('/my-bets', protect, checkPaid, async (req, res) => {
  try {
    const { leagueId } = req.query;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga é obrigatório' });
    }

    // Convertemos para Number e String para garantir compatibilidade
    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);

    const [bet, matches] = await Promise.all([
      // AQUI ESTAVA O ERRO: Adicionamos o leagueId na busca da aposta
      Bet.findOne({ 
        user: req.user._id, 
        leagueId: lIdStr 
      }).lean(),
      
      Match.find({ leagueId: lIdNum }).lean()
    ]);

    // Se não encontrou aposta para ESTA LIGA específica
    if (!bet) {
      return res.json({ success: true, data: null, hasSubmitted: false });
    }

    // Criamos um Set de IDs de partidas da liga atual (para performance e comparação segura)
    const matchIdsDaLiga = new Set(matches.map(m => Number(m.matchId)));

    // Filtramos os palpites que pertencem APENAS a esta liga
    const gm = (bet.groupMatches || [])
      .filter(b => matchIdsDaLiga.has(Number(b.matchId))) // Comparação Number vs Number
      .map((b) => {
        const m = matches.find(x => Number(x.matchId) === Number(b.matchId));
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

    // O status de submissão agora é real por liga
    return res.json({
      success: true,
      data: { ...bet, groupMatches: gm },
      hasSubmitted: gm.length > 0
    });

  } catch (e) {
    console.error('GET /my-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar palpites' });
  }
});/**
 * 💾 Salvar palpites (ATUALIZADO COM TRAVA DE GRADE AUTOMÁTICA E SUPORTE A RODADAS)
 */
router.post('/save', protect, checkPaid, async (req, res) => {
  try {
    const { groupMatches, podium, knockoutQualifiers, leagueId } = req.body;
    
    // 1. Validação crítica do leagueId
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });
    }

    const configId = `league_${leagueId}`;
    const Settings = require('../models/Settings'); 
    const Match = require('../models/Match');
    const Bet = require('../models/Bet');
    const User = require('../models/User');

    const settings = await Settings.findById(configId).lean();

    const matchIdsEnviados = Object.keys(groupMatches || {}).map(Number);
    
    // 2. Valida se as partidas pertencem à liga e busca identificadores de fase/rodada
    // 🛡️ CORREÇÃO: Adicionado 'phaseName' no select para que o bloqueio de rodadas funcione
    const dbMatches = await Match.find({ 
      matchId: { $in: matchIdsEnviados }, 
      leagueId: Number(leagueId) 
    }).select('matchId group phaseName').lean();

    const validMatchIds = new Set(dbMatches.map(m => m.matchId));

    // ============================================================
    // 🛡️ VALIDAÇÃO DE GRADE TRANCADA (Suporte a Rodadas e Grupos)
    // ============================================================
    if (settings && settings.lockedPhases && settings.lockedPhases.length > 0) {
      for (const matchId of matchIdsEnviados) {
        const matchData = dbMatches.find(m => m.matchId === matchId);
        
        if (matchData) {
          // 💡 EXPLICAÇÃO: Se for pontos corridos, a trava usa phaseName (ex: Rodada 6).
          // Se for Copa, usa o group (ex: Grupo A).
          const gradeDaPartida = matchData.phaseName || matchData.group;
          
          if (settings.lockedPhases.includes(gradeDaPartida)) {
            return res.status(403).json({ 
              success: false, 
              message: `As apostas para a grade "${gradeDaPartida}" já foram encerradas!` 
            });
          }
        }
      }
    }
    // ============================================================

    // 3. Busca a aposta ESPECÍFICA desta liga para manter o histórico
    const existing = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) });
    const gmMap = new Map();

    if (existing && Array.isArray(existing.groupMatches)) {
      existing.groupMatches.forEach((b) => gmMap.set(b.matchId, b));
    }

    // 4. Atualiza apenas palpites que pertencem à liga atual e não estão trancados
    Object.entries(groupMatches || {}).forEach(([matchId, choice]) => {
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
      leagueId: String(leagueId), 
      groupMatches: Array.from(gmMap.values()),
      hasSubmitted: true,
      lastUpdate: now,
      firstSubmission: existing?.firstSubmission || now,
    };

    // 5. Trata o pódio se enviado
    if (podium && podium.first) {
      payload.podium = {
        first: String(podium.first).trim(),
        second: String(podium.second).trim(),
        third: String(podium.third).trim(),
        fourth: podium.fourth ? String(podium.fourth).trim() : ''
      };
    }

    // 6. Atualiza ou Cria a Aposta
    const bet = await Bet.findOneAndUpdate(
      { user: req.user._id, leagueId: String(leagueId) },
      { $set: payload },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    // ============================================================
    // 🔥 O CARIMBO: VÍNCULO DO USUÁRIO COM A LIGA
    // ============================================================
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { leagues: Number(leagueId) }
    });

    return res.json({ 
      success: true, 
      message: 'Palpites salvos e participação confirmada!', 
      data: { id: bet._id } 
    });

  } catch (e) {
    console.error('POST /save error:', e);
    return res.status(500).json({ success: false, message: 'Erro ao salvar palpites' });
  }
});

/**
 * 🏆 Leaderboard (Filtrado por LIGA)
 * Totalmente alinhado com ranking.js
 */
router.get('/leaderboard', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    // Captura os parâmetros exatamente como o seu frontend envia
    const { leagueId, type } = req.query; 
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);
    
    // Define se é parcial baseado no que o ranking.js enviou
    const isPartialRequest = type === 'partial';

    const [matches, bets] = await Promise.all([
      Match.find({ leagueId: lIdNum }).select('matchId status scoreA scoreB phase qualifiedSide').lean(),
      Bet.find({ 
        hasSubmitted: true, 
        leagueId: lIdStr 
      }).populate('user', 'name avatar').lean()
    ]);

    const matchMap = new Map(matches.map(m => [Number(m.matchId), m]));
    const matchIdsDaLiga = new Set(matches.map(m => Number(m.matchId)));

    const getWinner = (a, b) => {
      if (a === undefined || b === undefined || a === null || b === null) return null;
      if (a > b) return 'A';
      if (b > a) return 'B';
      return 'draw';
    };

    const ranked = bets.map((b) => {
      let totalPoints = 0;
      let groupPhasePoints = 0;
      let knockoutPoints = 0;

      const userBetsDaLiga = (b.groupMatches || []).filter(gm => matchIdsDaLiga.has(Number(gm.matchId)));

      userBetsDaLiga.forEach(gm => {
        const m = matchMap.get(Number(gm.matchId));
        if (!m) return;

        // --- LÓGICA DE FILTRAGEM POR TIPO ---
        if (isPartialRequest) {
          // No modo PARCIAL: Ignora apenas o que ainda não começou (scheduled)
          if (m.status === 'scheduled') return;
        } else {
          // No modo OFICIAL: Ignora tudo que não está FINALIZADO
          if (m.status !== 'finished') return;
        }
        // ------------------------------------

        const realWinner = getWinner(m.scoreA, m.scoreB);
        
        // 1. Ponto por acertar o vencedor/empate
        if (realWinner && gm.winner === realWinner) {
          totalPoints += 1;
          if (m.phase === 'group') groupPhasePoints += 1;
          else knockoutPoints += 1;
        }

        // 2. Ponto por acertar quem classifica (Mata-mata)
        const realQual = m.qualifiedSide || (realWinner !== 'draw' ? realWinner : null);
        if (gm.qualifier && realQual && gm.qualifier === realQual) {
          totalPoints += 1;
          knockoutPoints += 1;
        }
      });

      return {
        user: b.user,
        totalPoints, // O frontend usa este campo para os pontos
        groupPhasePoints,
        knockoutPoints,
        podiumPoints: b.podiumPoints || 0, // Mantido para o card de detalhes do mobile
        lastUpdate: b.lastUpdate
      };
    });

    // Ordenação: Pontos Descendente -> Nome Ascendente
    ranked.sort((a, b) => b.totalPoints - a.totalPoints || (a.user?.name || "").localeCompare(b.user?.name || ""));

    // Atribuição de posições
    let lastPoints = null;
    let position = 0;
    const finalData = ranked.map((item, index) => {
      if (lastPoints === null || item.totalPoints !== lastPoints) {
        position = index + 1;
        lastPoints = item.totalPoints;
      }
      return { ...item, position };
    });

    res.json({ success: true, data: finalData, leagueId: lIdNum });
  } catch (e) {
    console.error('Leaderboard Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao processar ranking' });
  }
});

// 👁️ Todos os palpites (Com trava de visibilidade por liga)
router.get('/all-bets', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { search, matchId, group, leagueId } = req.query;
    const isAdmin = req.user?.isAdmin === true;

    // 1. Busca configurações específicas da liga para saber o que desbloquear
    const configId = getConfigId(leagueId);
    const settings = await Settings.findById(configId).lean();
    const unlockedPhases = settings?.unlockedPhases || [];
    
    let matchFilter = {};
    if (leagueId) matchFilter.leagueId = Number(leagueId);
    
    // ✨ CORREÇÃO CRÍTICA: Se vier um "group" na query (ex: Rodada 6), 
    // buscamos tanto no campo 'group' quanto no 'phaseName'.
    if (group) {
      matchFilter.$or = [
        { group: { $regex: group, $options: 'i' } },
        { phaseName: { $regex: group, $options: 'i' } }
      ];
    }
    
    if (matchId) matchFilter.matchId = Number(matchId);

    const matches = await Match.find(matchFilter).lean();
    const matchIdsFilter = matches.map(m => m.matchId);

    // Se não achar partidas para esse filtro, já retornamos vazio para evitar erros
    if (matchIdsFilter.length === 0) {
      return res.json({ success: true, data: [] });
    }

    let query = { hasSubmitted: true };
    if (search) {
      const users = await User.find({ name: { $regex: search, $options: 'i' } }).select('_id').lean();
      query.user = { $in: users.map(u => u._id) };
    }
    
    // Garantimos que o leagueId na busca das Bets também seja filtrado (se fornecido)
    if (leagueId) {
      query.$or = [
        { leagueId: String(leagueId) },
        { leagueId: Number(leagueId) }
      ];
    }

    query['groupMatches.matchId'] = { $in: matchIdsFilter };

    // Buscamos as apostas (incluindo o campo podium)
    const bets = await Bet.find(query).populate('user', 'name').lean();

    const enriched = bets.map(b => {
      // Filtramos apenas os palpites que pertencem aos jogos da rodada/grupo atual
      const gm = (b.groupMatches || []).filter(x => matchIdsFilter.includes(x.matchId));

      const viewBets = gm.map(g => {
        const m = matches.find(x => x.matchId === g.matchId);
        
        let isLocked = !isAdmin;

        if (m?.phase === 'group' || m?.phase === 'pontos_corridos') {
            // Lógica Híbrida: Liberta se tiver a chave mestra 'group' OU a rodada específica OU o phaseName
            const groupUnlocked = unlockedPhases.includes('group');
            const specificGroupUnlocked = unlockedPhases.includes(m?.group);
            const phaseNameUnlocked = unlockedPhases.includes(m?.phaseName);

            isLocked = !isAdmin && !groupUnlocked && !specificGroupUnlocked && !phaseNameUnlocked;
        } else {
            // Mata-mata (oitavas, etc)
            isLocked = !isAdmin && !unlockedPhases.includes(m?.group);
        }

        return {
          matchId: g.matchId,
          choice: isLocked ? '🔒' : g.winner,
          choiceLabel: isLocked ? 'Bloqueado' : toWinnerLabel(g.winner, m?.teamA, m?.teamB),
          matchName: m ? `${m.teamA} vs ${m.teamB}` : `Jogo ${g.matchId}`,
          status: m?.status || 'scheduled',
          qualifier: isLocked ? null : g.qualifier
        };
      });

      // 🎯 CONTROLE DO PÓDIO
      const isPodiumLocked = !isAdmin && !unlockedPhases.includes('podium');
      const finalPodium = (b.podium && !isPodiumLocked) ? b.podium : (b.podium ? { first: '🔒', second: '🔒', third: '🔒', fourth: '🔒' } : null);

      return {
        userName: b.user?.name || 'Usuário',
        totalPoints: b.totalPoints || 0,
        bets: viewBets,
        podium: finalPodium
      };
    });

    res.json({ success: true, data: enriched });
  } catch (e) {
    console.error('All-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar apostas' });
  }
});
/**
 * 🔍 Partidas para filtro (Filtrado por Liga)
 */
router.get('/matches-for-filter', protect, checkPaid, async (req, res) => {
  try {
    const { leagueId } = req.query;
    let filter = {};
    if (leagueId) filter.leagueId = Number(leagueId);

    const matches = await Match.find(filter)
      .select('matchId teamA teamB group phase date leagueId')
      .sort('matchId')
      .lean();
      
    res.json({ success: true, data: matches });
  } catch (e) {
    console.error('Matches filter error:', e);
    res.status(500).json({ success: false, message: 'Erro ao buscar partidas' });
  }
});
/**
 * ⚠️ Admin: Reset (Protegido por leagueId)
 * Deleta as apostas e remove o vínculo dos usuários com a liga
 */
router.post('/admin/reset-all', protect, admin, async (req, res) => {
  try {
    const { leagueId } = req.body;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'Informe o leagueId para resetar' });
    }

    const lidStr = String(leagueId);
    const lidNum = Number(leagueId);

    // 1. Deleta permanentemente os documentos de aposta desta liga
    // Usamos String porque no schema de Bet o leagueId costuma ser String
    const deleteResult = await Bet.deleteMany({ leagueId: lidStr });

    // 2. Remove o ID da liga do array 'leagues' de todos os usuários
    // Isso garante que o site não ache que o usuário ainda participa da liga
    await User.updateMany(
      { leagues: lidNum }, 
      { $pull: { leagues: lidNum } }
    );

    console.log(`Reset da liga ${leagueId}: ${deleteResult.deletedCount} apostas removidas.`);

    res.json({ 
      success: true, 
      message: `Sucesso! ${deleteResult.deletedCount} apostas deletadas e vínculos de usuários removidos.` 
    });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ success: false, message: 'Erro interno ao resetar liga' });
  }
});
/**
 * 👥 Usuários para filtro (Filtrado por LeagueId)
 */
router.get('/users-for-filter', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { leagueId } = req.query;

    if (!leagueId) {
      return res.status(400).json({ 
        success: false, 
        message: 'O parâmeto leagueId é obrigatório para filtrar os usuários.' 
      });
    }

    // Filtramos os usuários que possuem o leagueId na sua lista de ligas/participações
    // O ajuste abaixo depende de como você estruturou o vínculo Usuário <-> Liga
    const query = { leagues: leagueId }; // Exemplo: se o usuário tem um array de IDs de ligas

    const users = await User.find(query)
      .select('_id name')
      .sort('name')
      .lean();

    res.json({ success: true, data: users });
  } catch (e) {
    console.error('Erro na rota users-for-filter:', e.message);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários da liga' });
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
