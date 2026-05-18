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
 * 🧠 ESTRATÉGIA: Caminho da Liderança (VERSÃO DEBUG COMPLETA - 2026)
 * Mantém 100% da lógica original + Debug de IDs
 */
router.get('/leadership-path', protect, checkPaid, blockStatsIfLocked, async (req, res) => {
  try {
    const { leagueId, userId: targetUserId, mode } = req.query;
    
    console.log('\n--- 🚀 [INÍCIO DEBUG LEADERSHIP-PATH] ---');
    console.log('1. PARÂMETROS:', { leagueId, targetUserId, mode });

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);
    const activeUserId = (targetUserId || req.user._id).toString();
    const isAdmin = req.user?.isAdmin === true;
    const isLive = mode === 'live';

    // 1. Carga de Dados (Busca flexível como no seu Duelo)
    const configId = `league_${leagueId}`;
    const [settings, matches, bets] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: lIdNum }).select('matchId status scoreA scoreB phase teamA teamB group qualifiedSide').lean(),
      Bet.find({ 
        hasSubmitted: true, 
        $or: [ { leagueId: lIdStr }, { leagueId: lIdNum } ] 
      }).populate('user', 'name').lean()
    ]);

    console.log('2. CARGA DB:', { partidas: matches.length, apostas: bets.length });

    const unlockedPhases = settings?.unlockedPhases || [];
    
    // Busca a aposta do alvo
    const targetBet = bets.find(b => b.user?._id?.toString() === activeUserId || b.user === activeUserId);
    if (!targetBet) {
        console.log('❌ ERRO: targetBet não encontrado para:', activeUserId);
        return res.status(404).json({ success: false, message: 'Aposta não encontrada' });
    }

    console.log('3. ALVO LOCALIZADO:', { nome: targetBet.user?.name, totalPalpites: targetBet.groupMatches?.length });

    // 🔑 MAP DE PALPITES COM LOG DE TIPO
    const matchIdsDaLiga = new Set(matches.map(m => String(m.matchId)));
    const targetPicksMap = new Map();
    
    (targetBet.groupMatches || []).forEach((gm, i) => {
      const midStr = String(gm.matchId);
      if (i === 0) console.log('4. DEBUG TIPO PALPITE:', { matchId: gm.matchId, tipo: typeof gm.matchId });
      if (matchIdsDaLiga.has(midStr)) {
        targetPicksMap.set(midStr, gm);
      }
    });
    console.log('Palpites mapeados para esta liga:', targetPicksMap.size);

    // Helpers Originais
    const getWinner = (a, b) => {
      if (a === undefined || b === undefined || a === null || b === null) return null;
      if (a > b) return 'A';
      if (b > a) return 'B';
      return 'draw';
    };

    const toWinnerLabel = (winner, teamA, teamB) => {
      if (winner === 'A') return teamA;
      if (winner === 'B') return teamB;
      if (winner === 'draw') return 'Empate';
      return 'Sem Palpite'; 
    };

    const eliminatedTeams = new Set();
    const matchMap = new Map(matches.map(m => [String(m.matchId), m]));

    // 2. Ranking Atual (Lógica Original Preservada)
    const currentRanking = bets.map(b => {
      let pts = 0;
      (b.groupMatches || []).forEach(gm => {
        const midStr = String(gm.matchId);
        if (!matchIdsDaLiga.has(midStr)) return;
        const m = matchMap.get(midStr);
        if (!m) return;
        if (isLive) { if (m.status === 'scheduled') return; } 
        else { if (m.status !== 'finished') return; }

        const realWinner = getWinner(m.scoreA, m.scoreB);
        if (realWinner && gm.winner === realWinner) pts += 1;
        const realQual = m.qualifiedSide || (realWinner !== 'draw' ? realWinner : null);
        if (gm.qualifier && realQual && gm.qualifier === realQual) pts += 1;

        if (m.status === 'finished' && m.phase === 'knockout' && m.group !== 'semifinal') {
          const loser = realWinner === 'A' ? m.teamB : (realWinner === 'B' ? m.teamA : null);
          if (loser) eliminatedTeams.add(loser);
        }
      });
      return { userId: b.user._id.toString(), points: pts + (b.podiumPoints || 0) };
    });

    const targetPoints = currentRanking.find(r => r.userId === activeUserId)?.points || 0;
    const leaderPoints = Math.max(...currentRanking.map(r => r.points), 0);

    const futureMatches = matches
      .filter(m => isLive ? m.status === 'scheduled' : m.status !== 'finished')
      .sort((a, b) => Number(a.matchId) - Number(b.matchId));

    // 3. Potencial de Pódio (Lógica Original)
    const podiumWeights = { first: 7, second: 5, third: 4, fourth: 3 };
    let targetPodiumPotential = 0;
    if (!settings?.podium?.first && targetBet.podium) {
      const p = targetBet.podium;
      if (p.first && !eliminatedTeams.has(p.first)) targetPodiumPotential += podiumWeights.first;
      if (p.second && !eliminatedTeams.has(p.second)) targetPodiumPotential += podiumWeights.second;
      if (p.third && !eliminatedTeams.has(p.third)) targetPodiumPotential += podiumWeights.third;
      if (p.fourth && !eliminatedTeams.has(p.fourth)) targetPodiumPotential += podiumWeights.fourth;
    }

    // 4. Posição Máxima (Cenário de Ouro)
    const projectedRanking = currentRanking.map(r => {
      let projPts = r.points;
      const isTarget = r.userId === activeUserId;
      const bRef = bets.find(bet => bet.user._id.toString() === r.userId);

      futureMatches.forEach(m => {
        const midStr = String(m.matchId);
        const targetPick = targetPicksMap.get(midStr);
        const rivalPick = (bRef?.groupMatches || []).find(gm => String(gm.matchId) === midStr);

        if (isTarget) {
          projPts += (m.phase === 'knockout' ? 2 : 1);
        } else if (targetPick && rivalPick) {
          if (targetPick.winner && targetPick.winner === rivalPick.winner) projPts += 1;
          if (m.phase === 'knockout' && targetPick.qualifier && targetPick.qualifier === rivalPick.qualifier) projPts += 1;
        }
      });
      if (isTarget) projPts += targetPodiumPotential;
      return { userId: r.userId, totalPoints: projPts, name: bRef?.user?.name || "" };
    });

    projectedRanking.sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));
    const targetMaxPosition = projectedRanking.findIndex(r => r.userId === activeUserId) + 1;

    // 5. Probabilidade (Lógica Original)
    const matchPointsLeft = futureMatches.reduce((acc, m) => acc + (m.phase === 'knockout' ? 2 : 1), 0);
    const totalPotential = matchPointsLeft + targetPodiumPotential;
    const gap = leaderPoints - targetPoints;
    const targetMaxTotal = targetPoints + totalPotential;
    let probability = 0;
    if (targetMaxTotal >= leaderPoints) {
      if (gap <= 0) probability = Math.min(99, 75 + (Math.abs(gap) * 5));
      else {
        const reachability = totalPotential > 0 ? (totalPotential - gap) / totalPotential : 0;
        probability = Math.max(1, Math.round(reachability * 70));
      }
    }

    // 6. Análise de Secagem com Log de Match
    const matchesAnalysis = futureMatches.map((m, index) => {
      const midStr = String(m.matchId);
      const isLocked = !isAdmin && (m.phase === 'group' ? !unlockedPhases.includes('group') : !unlockedPhases.includes(m.group));
      const targetPick = targetPicksMap.get(midStr);

      if (index < 2) console.log(`5. ANALISANDO JOGO ${midStr}:`, targetPick ? '✅ ENCONTRADO' : '❌ SEM PALPITE');

      const rivalsAboveTarget = currentRanking.filter(r => r.points > targetPoints);
      const opponentsToWatch = isLocked ? ["Conteúdo Bloqueado 🔒"] : rivalsAboveTarget.filter(ra => {
        const rb = bets.find(b => b.user._id.toString() === ra.userId);
        const rp = (rb?.groupMatches || []).find(gm => String(gm.matchId) === midStr);
        return rp && (rp.winner !== targetPick?.winner || (m.phase === 'knockout' && rp.qualifier !== targetPick?.qualifier));
      }).map(ra => bets.find(b => b.user._id.toString() === ra.userId)?.user.name);

      return {
        matchId: m.matchId,
        teams: `${m.teamA} x ${m.teamB}`,
        status: m.status,
        hasImpact: opponentsToWatch.length > 0,
        isLocked,
        myChoice: { 
          winner: targetPick?.winner || null, 
          label: toWinnerLabel(targetPick?.winner, m.teamA, m.teamB),
          qualifier: targetPick?.qualifier || null,
          qualifierName: targetPick?.qualifier === 'A' ? m.teamA : (targetPick?.qualifier === 'B' ? m.teamB : (m.phase === 'knockout' ? 'Sem Palpite' : null))
        },
        opponentsToWatch
      };
    });

    console.log('--- 🏁 [FIM DEBUG COMPLETO] ---\n');

    res.json({
      success: true,
      data: {
        summary: { maxPosition: targetMaxPosition, probability, currentPoints: targetPoints, maxPoints: targetMaxTotal, podiumPotential: targetPodiumPotential, totalMatches: futureMatches.length },
        matches: matchesAnalysis
      }
    });
  } catch (e) {
    console.error('❌ ERRO CRÍTICO:', e);
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
/* =========================================================================
   💾 Salvar palpites (ATUALIZADO, CORRIGIDO E ORDENADO POR GRUPO NO EMAIL)
   ========================================================================= */
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
    const { sendBetsConfirmationEmail } = require('../services/emailService');

    const settings = await Settings.findById(configId).lean();

    const matchIdsEnviados = Object.keys(groupMatches || {}).map(Number);
    
    // 2. Busca as partidas no banco de dados
    const dbMatches = await Match.find({ 
      matchId: { $in: matchIdsEnviados }, 
      leagueId: Number(leagueId) 
    }).select('matchId group phaseName teamA teamB logoA logoB').lean();

    const validMatchIds = new Set(dbMatches.map(m => m.matchId));

   // ============================================================
    // 🛡️ VALIDAÇÃO DE GRADE TRANCADA (Suporte Inteligente a Grupos e Mata-Mata)
    // ============================================================
    if (settings && settings.lockedPhases && settings.lockedPhases.length > 0) {
      // 1. Puxa os palpites antigos que o usuário já tinha guardados no banco de dados antes
      const existing = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) }).lean();
      const palpitesAntigosMap = new Map();
      if (existing && Array.isArray(existing.groupMatches)) {
        existing.groupMatches.forEach(b => palpitesAntigosMap.set(Number(b.matchId), b));
      }

      for (const matchId of matchIdsEnviados) {
        const idNum = Number(matchId); // Garante a chave comparativa sempre como Number
        const matchData = dbMatches.find(m => Number(m.matchId) === idNum);
        
        if (matchData) {
          const gradeDaPartida = matchData.phaseName || matchData.group;
          
          if (settings.lockedPhases.includes(gradeDaPartida)) {
            // Palpites extraídos do payload vindo do Front-end nesta requisição
            const palpiteEnviado = groupMatches[matchId] || groupMatches[String(matchId)];
            const classificadoEnviado = knockoutQualifiers ? (knockoutQualifiers[matchId] || knockoutQualifiers[String(matchId)]) : null;

            // Dados correspondentes recuperados do histórico do banco
            const dadosAntigos = palpitesAntigosMap.get(idNum);
            const palpiteJaSalvo = dadosAntigos ? dadosAntigos.winner : null;
            const classificadoJaSalvo = dadosAntigos ? dadosAntigos.qualifier : null;

            // 💡 CRITÉRIO DE LIBERAÇÃO (BYPASS):
            // Se o palpite do jogo E a escolha de classificação forem EXATAMENTE idênticos
            // ao que já estava na base de dados, ignoramos o bloqueio porque não houve alteração.
            const naoAlterouVencedor = palpiteEnviado === palpiteJaSalvo;
            const naoAlterouClassificado = String(classificadoEnviado || '') === String(classificadoJaSalvo || '');

            if (naoAlterouVencedor && naoAlterouClassificado) {
              continue; // Pula esta iteração com segurança, o usuário não mexeu neste jogo trancado!
            }

            // Se o fluxo chegar aqui, significa que o usuário tentou de fato modificar um jogo trancado
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

    // 4. Atualiza apenas palpites válidos
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
    const listaFinalGrupoMatches = Array.from(gmMap.values());

    const payload = {
      user: req.user._id,
      leagueId: String(leagueId), 
      groupMatches: listaFinalGrupoMatches,
      hasSubmitted: true,
      lastUpdate: now,
      firstSubmission: existing?.firstSubmission || now,
    };

    // 5. Trata o pódio
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

    // Vínculo do usuário com a liga
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { leagues: Number(leagueId) }
    });

    // ============================================================
    // 📧 GERAÇÃO E ENVIO DO COMPROVANTE POR E-MAIL (BREVO API)
    // ============================================================
    try {
      const userEmail = req.user.email;
      const userName = req.user.name || 'Participante';
      const leagueName = settings?.title || `Liga #${leagueId}`;

      // 🌟 NOVA LÓGICA DE ORDENAÇÃO:
      // Vamos criar uma lista nova que junta o palpite do usuário com os dados reais do jogo.
      // Isso nos permite ordenar por "phaseName" ou por "group" antes de desenhar a tabela.
      const palpitesCompletos = [];

      listaFinalGrupoMatches.forEach((userBet) => {
        const matchInfo = dbMatches.find(m => Number(m.matchId) === Number(userBet.matchId));
        if (matchInfo && matchInfo.teamA && matchInfo.teamB) {
          palpitesCompletos.push({
            ...userBet,
            gameData: matchInfo
          });
        }
      });

      // Ordena por fase/rodada e depois por grupo alfabeticamente
      palpitesCompletos.sort((a, b) => {
        const gradeA = a.gameData.phaseName || a.gameData.group || '';
        const gradeB = b.gameData.phaseName || b.gameData.group || '';
        return gradeA.localeCompare(gradeB, undefined, { numeric: true, sensitivity: 'base' });
      });

      let betsHtml = `
        <table style="width: 100%; border-collapse: collapse; font-family: sans-serif; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f4f6f7; border-bottom: 2px solid #bdc3c7;">
              <th style="padding: 12px; text-align: left; color: #34495e;">Confronto / Grupo</th>
              <th style="padding: 12px; text-align: center; color: #34495e; width: 160px;">Seu Palpite</th>
            </tr>
          </thead>
          <tbody>
      `;

      let ultimaGrade = '';

      // Varre a lista que já está perfeitamente ordenada por grupo/rodada
      palpitesCompletos.forEach((item) => {
        const matchInfo = item.gameData;
        const gradeAtual = matchInfo.phaseName || matchInfo.group || 'Geral';

        // Cria uma linha divisória visual cinza toda vez que mudar de grupo/rodada
        if (gradeAtual !== ultimaGrade) {
          betsHtml += `
            <tr style="background-color: #eaeded;">
              <td colspan="2" style="padding: 8px 12px; font-weight: bold; color: #2c3e50; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">
                📂 ${gradeAtual}
              </td>
            </tr>
          `;
          ultimaGrade = gradeAtual;
        }

        let traducaoPalpite = '';
        if (item.winner === 'A') traducaoPalpite = `Vitória: ${matchInfo.teamA}`;
        if (item.winner === 'B') traducaoPalpite = `Vitória: ${matchInfo.teamB}`;
        if (item.winner === 'draw') traducaoPalpite = 'Empate';

        if (item.qualifier) {
          const timeClassificado = item.qualifier === 'A' ? matchInfo.teamA : matchInfo.teamB;
          traducaoPalpite += ` <br><span style="font-size: 11px; color: #e67e22; font-weight: normal;">(Classifica: ${timeClassificado})</span>`;
        }

        betsHtml += `
          <tr style="border-bottom: 1px solid #ecf0f1;">
            <td style="padding: 12px; color: #2c3e50;">
              <strong>${matchInfo.teamA}</strong> vs <strong>${matchInfo.teamB}</strong>
            </td>
            <td style="padding: 12px; text-align: center; font-weight: bold; color: #27ae60; background-color: #fafdfb;">
              ${traducaoPalpite}
            </td>
          </tr>
        `;
      });

      betsHtml += `</tbody></table>`;

      // Bloco do pódio
      if (payload.podium && payload.podium.first) {
        betsHtml += `
          <div style="margin-top: 25px; padding: 15px; background-color: #fcf8e3; border: 1px solid #faebcc; border-radius: 4px; font-family: sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #8a6d3b;">🏆 Seus Palpites de Pódio:</h4>
            <p style="margin: 4px 0;"><strong>1º Lugar:</strong> ${payload.podium.first}</p>
            <p style="margin: 4px 0;"><strong>2º Lugar:</strong> ${payload.podium.second}</p>
            <p style="margin: 4px 0;"><strong>3º Lugar:</strong> ${payload.podium.third}</p>
            ${payload.podium.fourth ? `<p style="margin: 4px 0;"><strong>4º Lugar:</strong> ${payload.podium.fourth}</p>` : ''}
          </div>
        `;
      }

      sendBetsConfirmationEmail(userEmail, userName, leagueName, betsHtml)
        .catch(err => console.error('❌ Falha assíncrona ao enviar e-mail de palpites:', err.message));

    } catch (emailSetupError) {
      console.error('❌ Erro na preparação do e-mail de palpites:', emailSetupError);
    }
    // ============================================================

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
