const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const User = require('../models/User');


const {
  parseMatchDate,
  getBetLockMode,
  getMatchGrade,
  getBetLockState,
  isMatchStarted,
  isGradeLocked
} = require('../services/betLockService');

const {
  scoresAreEnabled,
  isValidScoreValue,
  isValidMatchIdValue,
  winnerFromScores,
  isValidWinner,
  normalizeQualifier,
  validateWinnerAgainstScore
} = require('../services/betValidationService');


const { toLeagueId } = require('../utils/leagueId');


function normalizeGroupPredictionsInput(input) {
  if (!Array.isArray(input)) return [];
  return input.map(item => ({
    group: String(item?.group || '').trim(),
    positions: Array.isArray(item?.positions)
      ? item.positions
          .map(p => ({
            position: Number(p?.position),
            team: String(p?.team || '').trim()
          }))
          .filter(p => Number.isInteger(p.position) && p.position > 0 && p.team)
      : [],
    additionalQualifiedTeams: Array.isArray(item?.additionalQualifiedTeams)
      ? [...new Set(item.additionalQualifiedTeams.map(t => String(t).trim()).filter(Boolean))]
      : []
  })).filter(item => item.group && item.positions.length);
}

async function saveBets(req, res) {
  try {
    const { groupMatches, podium, extras, groupPredictions, leagueId } = req.body;

    const submittedGroupMatches = groupMatches && typeof groupMatches === 'object'
      ? Object.values(groupMatches)
      : [];

    for (const submittedMatch of submittedGroupMatches) {
      if (!isValidScoreValue(submittedMatch?.scoreA) ||
          !isValidScoreValue(submittedMatch?.scoreB)) {
        return res.status(400).json({
          success: false,
          message: 'Placar inválido. scoreA e scoreB devem ser inteiros não negativos.'
        });
      }
    }

    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });
    }

    const configId = toLeagueId(leagueId);

    const [settings, dbMatches] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: toLeagueId(leagueId) }).select('matchId group phaseName teamA teamB date time status').lean()
    ]);

    // 🛡️ Verificação de bloqueio global de apostas
    if (settings?.blockSaveBets && settings?.testMode !== true) {
      return res.status(403).json({
        success: false,
        message: 'O administrador bloqueou novas apostas nesta liga.'
      });
    }

    // Validação do pódio
    if (podium && Array.isArray(podium)) {
      const podiumSize = settings?.championshipRules?.podiumSize ?? 4;
      const validation = Bet.validatePodiumSize(podium, podiumSize);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error });
      }
    }


    const normalizedGroupPredictions = normalizeGroupPredictionsInput(groupPredictions);

    // A previsão de classificação pertence somente à fase de grupos.
    // Não aceitamos grupos inventados pelo cliente: eles precisam existir
    // nas partidas da própria liga.
    const validGroupNames = new Set(
      dbMatches
        .filter(m => String(m.phase || '').toLowerCase() === 'group')
        .map(m => String(m.group || '').trim())
        .filter(Boolean)
    );

    for (const prediction of normalizedGroupPredictions) {
      if (!validGroupNames.has(prediction.group)) {
        return res.status(400).json({
          success: false,
          message: `Grupo inválido na previsão de classificação: ${prediction.group}`
        });
      }

      const uniqueTeams = new Set(prediction.positions.map(p => p.team.toLowerCase()));
      if (uniqueTeams.size !== prediction.positions.length) {
        return res.status(400).json({
          success: false,
          message: `Há equipes repetidas na previsão do grupo ${prediction.group}.`
        });
      }
    }


    // 🛡️ requireAllBets também considera a previsão da classificação dos grupos.
    // O rascunho local nunca passa por esta validação; ela só ocorre no envio oficial.
    if (settings?.requireAllBets) {
      const groupRules = Array.isArray(settings?.scoringRules?.groupQualificationRules)
        ? settings.scoringRules.groupQualificationRules
        : [];

      if (groupRules.length > 0) {
        const groupTeams = {};
        dbMatches
          .filter(m => String(m.phase || '').toLowerCase() === 'group')
          .forEach(m => {
            const group = String(m.group || '').trim();
            if (!group) return;
            groupTeams[group] ||= new Set();
            if (m.teamA) groupTeams[group].add(String(m.teamA).trim());
            if (m.teamB) groupTeams[group].add(String(m.teamB).trim());
          });

        const qualification = settings?.championshipRules?.groupQualification || {};
        const totalTeams = Number(qualification.totalTeams || 0);
        const groupCount = Number(qualification.groupCount || 0);
        const totalQualified = Number(qualification.totalQualified || 0);
        const additionalCount =
          totalTeams > 0 && groupCount > 0 && totalQualified > 0 && totalTeams % groupCount === 0
            ? totalQualified % groupCount
            : 8;

        const predictionsByGroup = new Map(
          normalizedGroupPredictions.map(p => [p.group, p])
        );

        for (const [group, teams] of Object.entries(groupTeams)) {
          const prediction = predictionsByGroup.get(group);
          if (!prediction || prediction.positions.length !== teams.size) {
            return res.status(400).json({
              success: false,
              message: `Complete a classificação prevista do grupo ${group} antes de enviar as apostas.`
            });
          }

          const predictedTeams = new Set(prediction.positions.map(p => p.team.toLowerCase()));
          if (predictedTeams.size !== teams.size ||
              [...teams].some(team => !predictedTeams.has(String(team).toLowerCase()))) {
            return res.status(400).json({
              success: false,
              message: `A classificação prevista do grupo ${group} precisa conter todas as equipes uma única vez.`
            });
          }

          if (additionalCount > 0) {
            const selectedAdditional = [...new Set(prediction.additionalQualifiedTeams || [])];
            if (selectedAdditional.length !== additionalCount) {
              return res.status(400).json({
                success: false,
                message: `Defina exatamente ${additionalCount} classificados adicionais antes de enviar as apostas.`
              });
            }

            const baseQualified =
              totalTeams > 0 && groupCount > 0 && totalQualified > 0 && totalTeams % groupCount === 0
                ? Math.floor(totalQualified / groupCount)
                : 2;
            const additionalPosition = baseQualified + 1;
            const predictedAtAdditionalPosition = prediction.positions
              .find(p => Number(p.position) === additionalPosition)?.team;

            // A previsão adicional deve apontar somente para equipes que
            // o próprio usuário colocou na posição que disputa as vagas extras.
            const allowedAdditional = new Set(
              prediction.positions
                .filter(p => Number(p.position) === additionalPosition)
                .map(p => p.team.toLowerCase())
            );

            if (selectedAdditional.some(team => !allowedAdditional.has(String(team).toLowerCase()))) {
              return res.status(400).json({
                success: false,
                message: `Os classificados adicionais do grupo ${group} devem corresponder às posições que disputam as vagas extras.`
              });
            }
          }
        }
      }
    }

    const validMatchIds = new Set(dbMatches.map(m => m.matchId));
    const matchMap = new Map(dbMatches.map(m => [m.matchId, m]));

    // ============================================================
    // 🛡️ VALIDAÇÃO DE GRADE TRANCADA
    // ============================================================
    const rawMatchIdsEnviados = Object.keys(groupMatches || {});

    if (rawMatchIdsEnviados.some(matchId => !isValidMatchIdValue(matchId))) {
      return res.status(400).json({
        success: false,
        message: 'matchId inválido. O identificador da partida deve ser um inteiro positivo.'
      });
    }

    const matchIdsEnviados = rawMatchIdsEnviados.map(Number);

    // Garante que todos os matchIds enviados realmente pertencem
    // à liga informada. A validação numérica acima só verifica o formato.
    const matchIdsInvalidos = matchIdsEnviados.filter(
      id => !validMatchIds.has(id)
    );

    if (matchIdsInvalidos.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Uma ou mais partidas não pertencem à liga informada.'
      });
    }

    const betLockMode = getBetLockMode(settings);

    // Partidas de grades já bloqueadas que estão sendo reenviadas
    // exatamente como já estavam salvas. Elas não podem ser
    // rejeitadas novamente pela trava de horário abaixo.
    const matchesReenvioPermitido = new Set();

    if (
      betLockMode === 'grade' &&
      Array.isArray(settings?.lockedPhases) &&
      settings.lockedPhases.length > 0
    ) {
      const existing = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) }).lean();
      const palpitesAntigosMap = new Map();
      if (existing && Array.isArray(existing.groupMatches)) {
        existing.groupMatches.forEach(b => palpitesAntigosMap.set(Number(b.matchId), b));
      }

      for (const matchId of matchIdsEnviados) {
        const idNum = Number(matchId);
        const matchData = matchMap.get(idNum);

        if (matchData) {
          const gradeDaPartida = getMatchGrade(matchData);

          if (isGradeLocked(matchData, settings)) {
            const palpiteEnviado = groupMatches[matchId] || groupMatches[String(matchId)];
            const classificadoEnviado = palpiteEnviado?.qualifier || null;

            const dadosAntigos = palpitesAntigosMap.get(idNum);

            // Uma grade já encerrada pode ser reenviada somente com exatamente
            // o mesmo palpite que já estava salvo.
            //
            // IMPORTANTE:
            // - winner e qualifier fazem parte da aposta e continuam sendo
            //   comparados normalmente;
            // - scoreA/scoreB só fazem parte da comparação quando alguma
            //   categoria de pontuação de placar está habilitada.
            //   Se placar não gera pontos, a aposta legítima pode ter
            //   scoreA/scoreB = null e esses campos devem ser ignorados.
            if (!dadosAntigos) {
              return res.status(403).json({
                success: false,
                message: `As apostas para a grade "${gradeDaPartida}" já foram encerradas!`
              });
            }

            const palpiteJaSalvo = dadosAntigos.winner ?? null;
            const classificadoJaSalvo = dadosAntigos.qualifier ?? null;

            const naoAlterouVencedor =
              String(palpiteEnviado?.winner ?? '') === String(palpiteJaSalvo ?? '');

            const naoAlterouClassificado =
              String(classificadoEnviado ?? '') === String(classificadoJaSalvo ?? '');

            const scoringRulesLocked = settings?.scoringRules || {};
            const scoresEnabledLocked = scoresAreEnabled(scoringRulesLocked);

            let naoAlterouPlacar = true;

            if (scoresEnabledLocked) {
              const scoreEnviadoA =
                palpiteEnviado?.scoreA == null || palpiteEnviado?.scoreA === ''
                  ? null
                  : Number(palpiteEnviado.scoreA);

              const scoreEnviadoB =
                palpiteEnviado?.scoreB == null || palpiteEnviado?.scoreB === ''
                  ? null
                  : Number(palpiteEnviado.scoreB);

              const scoreSalvoA =
                dadosAntigos.scoreA == null || dadosAntigos.scoreA === ''
                  ? null
                  : Number(dadosAntigos.scoreA);

              const scoreSalvoB =
                dadosAntigos.scoreB == null || dadosAntigos.scoreB === ''
                  ? null
                  : Number(dadosAntigos.scoreB);

              naoAlterouPlacar =
                scoreEnviadoA === scoreSalvoA &&
                scoreEnviadoB === scoreSalvoB;
            }

            if (naoAlterouVencedor && naoAlterouClassificado && naoAlterouPlacar) {
              matchesReenvioPermitido.add(idNum);
              continue;
            }

            return res.status(403).json({
              success: false,
              message: `As apostas para a grade "${gradeDaPartida}" já foram encerradas!`
            });
          }
        }
      }
    }

    // 🆕 CORREÇÃO CRÍTICA: Verifica se alguma partida enviada já começou
    const checkNow = new Date();
    for (const matchId of matchIdsEnviados) {
      const matchData = matchMap.get(Number(matchId));
      if (
        settings?.testMode !== true &&
        matchData &&
        isMatchStarted(matchData, checkNow) &&
        !matchesReenvioPermitido.has(Number(matchId))
      ) {
        return res.status(403).json({
          success: false,
          message: `Aposta bloqueada: Partida ${matchData.teamA} x ${matchData.teamB} já foi iniciada ou encerrada.`
        });
      }
    }

    // ============================================================
    // 3. Busca a aposta ESPECÍFICA desta liga
    // ============================================================
    let bet = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) });
    const gmMap = new Map();

    if (bet && Array.isArray(bet.groupMatches)) {
      bet.groupMatches.forEach((b) => gmMap.set(b.matchId, b));
    }

    // 4. Valida TODOS os palpites antes de alterar o gmMap.
    //    Se um único palpite for inválido, o lote inteiro é rejeitado.
    for (const [matchId, data] of Object.entries(groupMatches || {})) {
      const idNum = Number(matchId);
      const matchData = matchMap.get(idNum);

      if (!validMatchIds.has(idNum)) {
        return res.status(400).json({
          success: false,
          message: `Partida inválida ou não encontrada: ${matchId}.`
        });
      }

      const choice = data?.winner;
      const scoreA = data?.scoreA;
      const scoreB = data?.scoreB;

      const scoringRules = settings?.scoringRules || {};
      const scoresEnabled = scoresAreEnabled(scoringRules);

      if (scoresEnabled && (scoreA == null || scoreB == null || scoreA === '' || scoreB === '')) {
        return res.status(400).json({
          success: false,
          message: `Placar obrigatório para a partida ${idNum}.`
        });
      }

      if (!isValidScoreValue(scoreA) || !isValidScoreValue(scoreB)) {
        return res.status(400).json({
          success: false,
          message: `Placar inválido para a partida ${idNum}. scoreA e scoreB devem ser inteiros não negativos.`
        });
      }

      let effectiveChoice = choice;

      if (
        scoresEnabled &&
        settings?.championshipRules?.winnerFromScore !== false
      ) {
        const validation =
          validateWinnerAgainstScore(
            choice,
            scoreA,
            scoreB
          );

        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            message:
              validation.message ||
              `Não foi possível validar o vencedor da partida ${idNum}.`
          });
        }

        effectiveChoice =
          validation.derivedWinner;
      }

      if (!isValidWinner(effectiveChoice)) {
        return res.status(400).json({
          success: false,
          message: `Palpite de vencedor inválido para a partida ${idNum}.`
        });
      }

      const qualifier =
        normalizeQualifier(data?.qualifier);

      const isKnockoutMatch =
        matchData?.phase === 'knockout' ||
        matchData?.phase === 'mata-mata';

      if (qualifier && !isKnockoutMatch) {
        return res.status(400).json({
          success: false,
          message: `Palpite de classificado não é permitido para a partida ${idNum}, pois ela não pertence ao mata-mata.`
        });
      }

      const existingGm = gmMap.get(idNum);

      // Se a partida já está encerrada e foi aceita apenas como reenvio
      // idêntico, preserva os pontos/breakdown já apurados. Para uma aposta
      // realmente editável, a nova versão começa novamente com zero pontos.
      const preserveScoring = matchesReenvioPermitido.has(idNum) && existingGm;

      gmMap.set(idNum, {
        matchId: idNum,
        winner: effectiveChoice,
        scoreA: scoreA == null || scoreA === '' ? null : Number(scoreA),
        scoreB: scoreB == null || scoreB === '' ? null : Number(scoreB),
        qualifier,
        points: preserveScoring ? Number(existingGm.points || 0) : 0,
        pointsBreakdown: preserveScoring
          ? {
              exactScore: Number(existingGm.pointsBreakdown?.exactScore || 0),
              scoreTeamA: Number(existingGm.pointsBreakdown?.scoreTeamA || 0),
              scoreTeamB: Number(existingGm.pointsBreakdown?.scoreTeamB || 0),
              winner: Number(existingGm.pointsBreakdown?.winner || 0),
              qualifier: Number(existingGm.pointsBreakdown?.qualifier || 0)
            }
          : {
              exactScore: 0,
              scoreTeamA: 0,
              scoreTeamB: 0,
              winner: 0,
              qualifier: 0
            }
      });
    }

    const now = new Date();
    const listaFinalGrupoMatches = Array.from(gmMap.values());

    const payload = {
      user: req.user._id,
      leagueId: String(leagueId),
      groupMatches: listaFinalGrupoMatches,

      // Os totais são recalculados a partir dos pontos/breakdowns que
      // permanecem em groupMatches e dos breakdowns já apurados de pódio/extras.
      hasSubmitted: true,
      lastUpdate: now,
      firstSubmission: bet?.firstSubmission || now,
    };

    // 4b. Trata a previsão da classificação dos grupos.
    // O cálculo oficial dos pontos ocorre no pointsService.
    if (groupPredictions !== undefined) {
      payload.groupPredictions = normalizedGroupPredictions;
    }

    // 5. Trata o pódio (array)
    if (podium && Array.isArray(podium)) {
      payload.podium = podium.map(t => String(t).trim()).filter(t => t.length > 0);
    }

    // 6. Trata os extras
    if (extras && typeof extras === 'object') {
      payload.extras = {
        topScorer: extras.topScorer ? String(extras.topScorer).trim() : null,
        bestAttack: extras.bestAttack ? String(extras.bestAttack).trim() : null,
        worstDefense: extras.worstDefense ? String(extras.worstDefense).trim() : null,
        upset: extras.upset ? String(extras.upset).trim() : null
      };
    }

    // 7. Atualiza ou cria a aposta.
    if (!bet) {
      bet = new Bet(payload);
    } else {
      bet.set(payload);
    }

    // Bet.js expõe recalculateTotals(), mas não possui hook pre-save.
    // Portanto precisamos recalcular explicitamente antes de persistir.
    bet.recalculateTotals();

    await bet.save();

    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { leagues: toLeagueId(leagueId) }
    });

    // ============================================================
    // 📧 E-MAIL DE COMPROVANTE
    // ============================================================
    try {
      const { sendBetsConfirmationEmail } = require('../services/emailService');
      const userEmail = req.user.email;
      const userName = req.user.name || 'Participante';
      const leagueName = settings?.title || `Liga #${leagueId}`;
      const protocolo = `${String(req.user._id).slice(-4).toUpperCase()}-${Date.now()}`;
      const dataEmissao = new Date().toLocaleString('pt-BR');

      const palpitesCompletos = [];
      listaFinalGrupoMatches.forEach((userBet) => {
        const matchInfo = dbMatches.find(m => Number(m.matchId) === Number(userBet.matchId));
        if (matchInfo && matchInfo.teamA && matchInfo.teamB) {
          palpitesCompletos.push({ ...userBet, gameData: matchInfo });
        }
      });

      const getPhaseWeight = (phaseName) => {
        const p = String(phaseName).toLowerCase();
        if (p.includes('3') || p.includes('terceiro')) return 60;
        if (p.includes('semi')) return 50;
        if (p.includes('quartas')) return 40;
        if (p.includes('oitavas')) return 30;
        if (p.includes('16') || p.includes('avos')) return 20;
        if (p.includes('final')) return 70;
        return 10;
      };

      palpitesCompletos.sort((a, b) => {
        const gradeA = a.gameData.phaseName || a.gameData.group || 'Geral';
        const gradeB = b.gameData.phaseName || b.gameData.group || 'Geral';
        const weightA = getPhaseWeight(gradeA);
        const weightB = getPhaseWeight(gradeB);
        if (weightA !== weightB) return weightB - weightA;
        return gradeA.localeCompare(gradeB, undefined, { numeric: true, sensitivity: 'base' });
      });

      let betsHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
          <div style="background-color: #2c3e50; padding: 15px; color: white; text-align: center; border-radius: 4px 4px 0 0;">
            <h2 style="margin: 0;">Comprovante de Palpites</h2>
            <p style="margin: 5px 0 0 0; font-size: 14px;">Protocolo: <strong>${protocolo}</strong></p>
            <p style="margin: 5px 0 0 0; font-size: 12px;">Emitido em: ${dataEmissao}</p>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-family: sans-serif; margin-top: 15px;">
            <thead>
              <tr style="background-color: #f4f6f7; border-bottom: 2px solid #bdc3c7;">
                <th style="padding: 12px; text-align: left; color: #34495e;">Confronto / Fase</th>
                <th style="padding: 12px; text-align: center; color: #34495e; width: 160px;">Seu Palpite</th>
              </tr>
            </thead>
            <tbody>
      `;

      let ultimaGrade = '';
      palpitesCompletos.forEach((item) => {
        const matchInfo = item.gameData;
        const gradeAtual = matchInfo.phaseName || matchInfo.group || 'Geral';

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

      if (payload.podium && payload.podium.length > 0) {
        betsHtml += `
          <div style="margin-top: 25px; padding: 15px; background-color: #fcf8e3; border: 1px solid #faebcc; border-radius: 4px; font-family: sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #8a6d3b;">🏆 Seus Palpites de Pódio:</h4>
            ${payload.podium.map((team, idx) => `<p style="margin: 4px 0;"><strong>${idx + 1}º Lugar:</strong> ${team}</p>`).join('')}
          </div>
        `;
      }

      if (payload.extras) {
        betsHtml += `
          <div style="margin-top: 15px; padding: 15px; background-color: #e8f6f3; border: 1px solid #a3e4d7; border-radius: 4px; font-family: sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #1e8449;">🌟 Palpites Extras:</h4>
            ${payload.extras.topScorer ? `<p style="margin: 4px 0;"><strong>Artilheiro:</strong> ${payload.extras.topScorer}</p>` : ''}
            ${payload.extras.bestAttack ? `<p style="margin: 4px 0;"><strong>Melhor Ataque:</strong> ${payload.extras.bestAttack}</p>` : ''}
            ${payload.extras.worstDefense ? `<p style="margin: 4px 0;"><strong>Pior Defesa:</strong> ${payload.extras.worstDefense}</p>` : ''}
            ${payload.extras.upset ? `<p style="margin: 4px 0;"><strong>Zebra:</strong> ${payload.extras.upset}</p>` : ''}
          </div>
        `;
      }

      betsHtml += `
          <div style="margin-top: 30px; padding: 15px; border-top: 1px dashed #bdc3c7; font-size: 12px; color: #7f8c8d; background-color: #f9f9f9; border-radius: 0 0 4px 4px;">
            <p><strong>⚠️ AVISO IMPORTANTE DE AUDITORIA:</strong></p>
            <p>Este comprovante reflete exclusivamente os palpites salvos no sistema no exato momento de sua emissão (<strong>${dataEmissao}</strong>).</p>
            <p>Nossa plataforma permite a edição individual de palpites até o horário de início oficial de cada partida. <strong>Caso você realize qualquer alteração no site após o recebimento deste e-mail, este comprovante perderá automaticamente sua validade legal para as partidas alteradas.</strong> Em caso de divergência, prevalecerá incondicionalmente o último registro gravado em nosso banco de dados antes do bloqueio do jogo.</p>
          </div>
        </div>
      `;

      sendBetsConfirmationEmail(userEmail, userName, leagueName, betsHtml)
        .catch(err => console.error('❌ Falha assíncrona ao enviar e-mail de palpites:', err.message));

    } catch (emailSetupError) {
      console.error('❌ Erro na preparação do e-mail de palpites:', emailSetupError);
    }

    return res.json({
      success: true,
      message: 'Palpites salvos e participação confirmada!',
      data: { id: bet._id }
    });

  } catch (e) {
    console.error('POST /save error:', e);
    return res.status(500).json({ success: false, message: 'Erro ao salvar palpites' });
  }
}

async function saveSingleBet(req, res) {
  try {
    const now = new Date();
    const { leagueId, matchId, winner, qualifier, scoreA, scoreB } = req.body;

    if (!leagueId || !matchId || !winner) {
      return res.status(400).json({ success: false, message: 'Dados insuficientes para salvar o palpite.' });
    }

    if (!isValidMatchIdValue(matchId)) {
      return res.status(400).json({
        success: false,
        message: 'matchId inválido. O identificador da partida deve ser um inteiro positivo.'
      });
    }

    if (!['A', 'B', 'draw'].includes(winner)) {
      return res.status(400).json({ success: false, message: 'Palpite inválido. Escolha permitida: A, B ou draw.' });
    }

    if (!isValidScoreValue(scoreA) || !isValidScoreValue(scoreB)) {
      return res.status(400).json({
        success: false,
        message: 'Placar inválido. scoreA e scoreB devem ser inteiros não negativos.'
      });
    }

    const idNum = Number(matchId);

    const match = await Match.findOne({ matchId: idNum, leagueId: toLeagueId(leagueId) }).lean();

    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada no sistema.' });
    }

    const validQualifier = normalizeQualifier(qualifier);

    const isKnockoutMatch =
      match.phase === 'knockout' ||
      match.phase === 'mata-mata';

    if (validQualifier && !isKnockoutMatch) {
      return res.status(400).json({
        success: false,
        message: 'Palpite de classificado não é permitido fora do mata-mata.'
      });
    }

    // ============================================================
    // 🛡️ SEGURANÇA 1: Trava de Horário Absoluta
    // ============================================================
    const matchDate = parseMatchDate(match.date, match.time);

    if (
      settings?.testMode !== true &&
      (match.status !== 'scheduled' || (matchDate && matchDate <= now))
    ) {
      return res.status(403).json({
        success: false,
        message: 'Aposta bloqueada: Esta partida já começou ou foi encerrada.'
      });
    }

    // ============================================================
    // 🛡️ SEGURANÇA 2: Trava de Fase/Grade
    // ============================================================
    const configId = toLeagueId(leagueId);
    const settings = await Settings.findById(configId).lean();

    const scoringRules = settings?.scoringRules || {};
    const scoresEnabled = scoresAreEnabled(scoringRules);

    if (scoresEnabled && (scoreA == null || scoreB == null || scoreA === '' || scoreB === '')) {
      return res.status(400).json({ success: false, message: 'Placar (scoreA e scoreB) é obrigatório.' });
    }

    let effectiveWinner = winner;
    if (
      scoresEnabled &&
      settings?.championshipRules?.winnerFromScore !== false
    ) {
      const validation =
        validateWinnerAgainstScore(
          winner,
          scoreA,
          scoreB
        );

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.message
        });
      }

      effectiveWinner =
        validation.derivedWinner;
    }

    // 🛡️ Verificação de bloqueio global de apostas
    if (settings?.blockSaveBets && settings?.testMode !== true) {
      return res.status(403).json({
        success: false,
        message: 'O administrador bloqueou novas apostas nesta liga.'
      });
    }

    const gradeDaPartida = getMatchGrade(match);
    const betLockMode = getBetLockMode(settings);
    const betLockState = getBetLockState(match, settings, now);

    if (betLockState.locked) {
      const message = betLockState.reason === 'grade_locked'
        ? `As apostas para a fase "${gradeDaPartida}" foram encerradas pelo Administrador!`
        : `Aposta bloqueada: a partida ${match.teamA} x ${match.teamB} já foi iniciada ou encerrada.`;

      return res.status(403).json({
        success: false,
        message
      });
    }

    // ============================================================
    // 💾 ATUALIZAÇÃO CIRÚRGICA
    // ============================================================
    let betDoc = await Bet.findOne({ user: req.user._id, leagueId: String(leagueId) });

    const novoPalpite = {
      matchId: idNum,
      winner: effectiveWinner,
      scoreA: scoreA == null || scoreA === '' ? null : Number(scoreA),
      scoreB: scoreB == null || scoreB === '' ? null : Number(scoreB),
      qualifier: validQualifier,
      points: 0,
      pointsBreakdown: {
        exactScore: 0, scoreTeamA: 0, scoreTeamB: 0, winner: 0, qualifier: 0
      }
    };

    if (!betDoc) {
      betDoc = new Bet({
        user: req.user._id,
        leagueId: String(leagueId),
        groupMatches: [novoPalpite],
        hasSubmitted: true,
        lastUpdate: now,
        firstSubmission: now
      });

      await User.findByIdAndUpdate(req.user._id, { $addToSet: { leagues: toLeagueId(leagueId) } });
    } else {
      const index = betDoc.groupMatches.findIndex(b => Number(b.matchId) === idNum);

      if (index !== -1) {
        betDoc.groupMatches[index].winner = effectiveWinner;
        betDoc.groupMatches[index].scoreA =
          scoreA == null || scoreA === '' ? null : Number(scoreA);
        betDoc.groupMatches[index].scoreB =
          scoreB == null || scoreB === '' ? null : Number(scoreB);
        betDoc.groupMatches[index].qualifier = validQualifier;
        betDoc.groupMatches[index].points = 0;
        betDoc.groupMatches[index].pointsBreakdown = novoPalpite.pointsBreakdown;
      } else {
        betDoc.groupMatches.push(novoPalpite);
      }

      betDoc.lastUpdate = now;
    }

    // O model não possui pre-save para recalcular totais.
    // Recalcula sem apagar os pontos das demais partidas já concluídas.
    betDoc.recalculateTotals();

    await betDoc.save();

    return res.json({
      success: true,
      message: 'Palpite individual salvo com sucesso!'
    });

  } catch (error) {
    console.error('POST /single error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao salvar palpite individual.' });
  }
}

module.exports = {
  saveBets,
  saveSingleBet
};
