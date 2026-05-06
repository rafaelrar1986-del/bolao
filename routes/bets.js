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
 * 🧠 ESTRATÉGIA: Caminho da Liderança (Versão 2026 - Ultra Precision)
 * Sincronizada 100% com a lógica de pontos do leaderboard.js
 */
router.get('/leadership-path', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { leagueId, userId: targetUserId, mode } = req.query; // mode: 'official' ou 'live'
    if (!leagueId) return res.status(400).json({ success: false, message: 'ID da liga obrigatório' });

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);
    const activeUserId = targetUserId || req.user._id.toString();
    const isAdmin = req.user?.isAdmin === true;
    const isLive = mode === 'live';

    // 1. Carga de Dados
    const configId = `league_${leagueId}`;
    const [settings, matches, bets] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: lIdNum }).select('matchId status scoreA scoreB phase teamA teamB group qualifiedSide').lean(),
      Bet.find({ hasSubmitted: true, leagueId: lIdStr }).populate('user', 'name').lean()
    ]);

    const unlockedPhases = settings?.unlockedPhases || [];
    const targetBet = bets.find(b => b.user._id.toString() === activeUserId);
    if (!targetBet) return res.status(404).json({ success: false, message: 'Aposta não encontrada' });

    // Helper de Vencedor (Idêntico ao seu leaderboard)
    const getWinner = (a, b) => {
      if (a === undefined || b === undefined || a === null || b === null) return null;
      if (a > b) return 'A';
      if (b > a) return 'B';
      return 'draw';
    };

    // Helper para converter Winner em Nome do Time (Evita 'undefined' no palpite)
    const toWinnerLabel = (winner, teamA, teamB) => {
      if (winner === 'A') return teamA;
      if (winner === 'B') return teamB;
      if (winner === 'draw') return 'Empate';
      return 'N/D';
    };

    // 2. Lógica de Times Vivos e Cálculo de Pontos Atuais (Dinâmico)
    const eliminatedTeams = new Set();
    const matchMap = new Map(matches.map(m => [Number(m.matchId), m]));

    const currentRanking = bets.map(b => {
      let pts = 0;
      (b.groupMatches || []).forEach(gm => {
        const m = matchMap.get(Number(gm.matchId));
        if (!m) return;

        // Filtro de status idêntico ao seu ranking.js para evitar "limbo"
        if (isLive) {
          if (m.status === 'scheduled') return;
        } else {
          if (m.status !== 'finished') return;
        }

        const realWinner = getWinner(m.scoreA, m.scoreB);
        if (realWinner && gm.winner === realWinner) pts += 1;
        
        const realQual = m.qualifiedSide || (realWinner !== 'draw' ? realWinner : null);
        if (gm.qualifier && realQual && gm.qualifier === realQual) pts += 1;

        // Regra de Eliminação: Perdedores de mata-mata saem (exceto semi, que disputam 3º)
        if (m.status === 'finished' && m.phase === 'knockout' && m.group !== 'semifinal') {
          const loser = realWinner === 'A' ? m.teamB : (realWinner === 'B' ? m.teamA : null);
          if (loser) eliminatedTeams.add(loser);
        }
      });

      return { userId: b.user._id.toString(), points: pts + (b.podiumPoints || 0) };
    });

    const myCurrentPoints = currentRanking.find(r => r.userId === activeUserId)?.points || 0;
    const leaderPoints = Math.max(...currentRanking.map(r => r.points), 0);

    // 3. Projeção de Futuro (O que ainda pode ser ganho)
    const futureMatches = matches
      .filter(m => isLive ? m.status === 'scheduled' : m.status !== 'finished')
      .sort((a, b) => a.matchId - b.matchId);

    const podiumWeights = { first: 7, second: 4, third: 2, fourth: 2 };
    let myPodiumPotential = 0;
    
    // Calcula potencial de pódio APENAS se os pontos ainda não foram distribuídos pelo ADM
    if (!settings?.podium?.first && targetBet.podium) {
      const p = targetBet.podium;
      if (p.first && !eliminatedTeams.has(p.first)) myPodiumPotential += podiumWeights.first;
      if (p.second && !eliminatedTeams.has(p.second)) myPodiumPotential += podiumWeights.second;
      if (p.third && !eliminatedTeams.has(p.third)) myPodiumPotential += podiumWeights.third;
      if (p.fourth && !eliminatedTeams.has(p.fourth)) myPodiumPotential += podiumWeights.fourth;
    }

    // 4. Posição Máxima (Cenário de Ouro)
    const projectedRanking = currentRanking.map(r => {
      let projPts = r.points;
      const isTarget = r.userId === activeUserId;
      const bRef = bets.find(bet => bet.user._id.toString() === r.userId);

      futureMatches.forEach(m => {
        const targetPick = targetBet.groupMatches.find(gm => gm.matchId === m.matchId);
        const rivalPick = bRef?.groupMatches.find(gm => gm.matchId === m.matchId);

        if (isTarget) {
          // No seu cenário de ouro, você acerta tudo
          projPts += (m.phase === 'knockout' ? 2 : 1);
        } else if (targetPick && rivalPick) {
          // Rivais só pontuam se "copiaram" você no jogo futuro
          if (targetPick.winner === rivalPick.winner) projPts += 1;
          if (m.phase === 'knockout' && targetPick.qualifier === rivalPick.qualifier) projPts += 1;
        }
      });

      if (isTarget) projPts += myPodiumPotential;
      return { userId: r.userId, totalPoints: projPts, name: bRef?.user?.name || "" };
    });

    // Ordenação com critério de desempate por nome (Idêntico ao ranking)
    projectedRanking.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
    const myMaxPosition = projectedRanking.findIndex(r => r.userId === activeUserId) + 1;

    // 5. Probabilidade Estatística
    const matchPointsLeft = futureMatches.reduce((acc, m) => acc + (m.phase === 'knockout' ? 2 : 1), 0);
    const totalPotential = matchPointsLeft + myPodiumPotential;
    const gap = leaderPoints - myCurrentPoints;
    const myMaxTotal = myCurrentPoints + totalPotential;

    let probability = 0;
    if (myMaxTotal >= leaderPoints) {
      if (gap <= 0) {
        // Se já é líder, probabilidade alta que cresce com a vantagem
        probability = Math.min(99, 75 + (Math.abs(gap) * 5));
      } else {
        // Se é desafiante, a probabilidade cai conforme o gap aumenta em relação ao potencial
        const reachability = totalPotential > 0 ? (totalPotential - gap) / totalPotential : 0;
        probability = Math.max(1, Math.round(reachability * 70));
      }
    }

    // 6. Análise de Secagem (Tabela de Impacto)
    const matchesAnalysis = futureMatches.map(m => {
      const isLocked = !isAdmin && (m.phase === 'group' ? !unlockedPhases.includes('group') : !unlockedPhases.includes(m.group));
      const myPick = targetBet.groupMatches.find(gm => gm.matchId === m.matchId);
      const rivalsAbove = currentRanking.filter(r => r.points > myCurrentPoints);

      const opponentsToWatch = isLocked ? ["Conteúdo Bloqueado 🔒"] : rivalsAbove.filter(ra => {
        const rb = bets.find(b => b.user._id.toString() === ra.userId);
        const rp = rb?.groupMatches.find(gm => gm.matchId === m.matchId);
        // Secagem: Rivais que apostaram DIFERENTE de você
        return rp && (rp.winner !== myPick?.winner || (m.phase === 'knockout' && rp.qualifier !== myPick?.qualifier));
      }).map(ra => bets.find(b => b.user._id.toString() === ra.userId)?.user.name);

      return {
        matchId: m.matchId,
        teams: `${m.teamA} x ${m.teamB}`,
        status: m.status,
        hasImpact: opponentsToWatch.length > 0,
        isLocked,
        myChoice: { 
          winner: myPick?.winner || null, 
          label: toWinnerLabel(myPick?.winner, m.teamA, m.teamB), // Resolve o 'undefined' no palpite
          qualifier: myPick?.qualifier || null 
        },
        opponentsToWatch
      };
    });

    // 7. Resposta Final
    res.json({
      success: true,
      data: {
        summary: { 
          maxPosition: myMaxPosition, 
          probability, 
          currentPoints: myCurrentPoints, 
          maxPoints: myMaxTotal,
          podiumPotential: myPodiumPotential || 0, // Resolve o '+undefined pts' no card
          totalMatches: futureMatches.length
        },
        matches: matchesAnalysis
      }
    });
  } catch (e) {
    console.error('Leadership Error:', e);
    res.status(500).json({ success: false });
  }
});
//🎯 Meus palpites (Filtrado por Liga)
 
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
 * ⚠️ Admin: Reset Total (Bets, Histórico e Vínculos)
 * Atualizado para garantir que nenhum rastro de pontuação antiga permaneça.
 */
router.post('/admin/reset-all', protect, admin, async (req, res) => {
  try {
    const { leagueId } = req.body;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'Informe o leagueId para resetar' });
    }

    const lidStr = String(leagueId);
    const lidNum = Number(leagueId);

    // Importar os modelos necessários
    const User = require('../models/User');
    const Bet = require('../models/Bet');
    const PointsHistory = require('../models/PointsHistory'); // Verifique se o nome do arquivo/model está correto

    // 1. Deleta permanentemente os documentos de aposta desta liga
    const deleteBets = await Bet.deleteMany({ leagueId: lidStr });

    // 2. Deleta o histórico de pontos/evolução desta liga (O que faltava)
    const deleteHistory = await PointsHistory.deleteMany({ leagueId: lidStr });

    // 3. Remove o ID da liga do array 'leagues' de todos os usuários
    // Isso evita que o front-end carregue dados inexistentes para o usuário
    const userUpdate = await User.updateMany(
      { leagues: lidNum }, 
      { $pull: { leagues: lidNum } }
    );

    console.log(`[Reset Liga ${leagueId}] Apostas: ${deleteBets.deletedCount} | Histórico: ${deleteHistory.deletedCount}`);

    res.json({ 
      success: true, 
      message: `Reset concluído com sucesso!`,
      details: {
        betsRemoved: deleteBets.deletedCount,
        historyRecordsRemoved: deleteHistory.deletedCount,
        usersUnlinked: userUpdate.modifiedCount
      }
    });

  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ success: false, message: 'Erro interno ao realizar reset total da liga' });
  }
});/**
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
