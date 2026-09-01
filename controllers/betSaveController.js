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

function normalizeNullableScore(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function predictionWasChanged(existingBet, effectiveWinner, qualifier, scoreA, scoreB, scoresEnabled) {
  if (!existingBet) return true;

  const winnerChanged =
    String(existingBet.winner ?? '') !== String(effectiveWinner ?? '');

  const qualifierChanged =
    String(existingBet.qualifier ?? '') !== String(qualifier ?? '');

  if (winnerChanged || qualifierChanged) return true;

  if (scoresEnabled) {
    return (
      normalizeNullableScore(existingBet.scoreA) !== normalizeNullableScore(scoreA) ||
      normalizeNullableScore(existingBet.scoreB) !== normalizeNullableScore(scoreB)
    );
  }

  return false;
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
      Match.find({ leagueId: toLeagueId(leagueId) }).select('matchId group phase phaseName roundNumber roundName teamA teamB date time status').lean()
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


    const normalizedGroupPredictions = settings?.championshipRules?.hasGroupPhase === false
      ? []
      : normalizeGroupPredictionsInput(groupPredictions);

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
    if (settings?.requireAllBets && settings?.championshipRules?.hasGroupPhase !== false) {
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
          totalTeams > 0 &&
          groupCount > 0 &&
          totalQualified > 0 &&
          totalTeams % groupCount === 0 &&
          totalQualified <= totalTeams
            ? totalQualified % groupCount
            : 0;

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
              totalTeams > 0 &&
              groupCount > 0 &&
              totalQualified > 0 &&
              totalTeams % groupCount === 0 &&
              totalQualified <= totalTeams
                ? Math.floor(totalQualified / groupCount)
                : 0;
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

    // Carrega a aposta atual uma única vez para aplicar a política de edição
    // sem interferir nas regras de bloqueio/salvamento. A opção permite ou
    // impede apenas a alteração de uma aposta já existente; novas apostas
    // continuam podendo ser salvas normalmente enquanto o salvamento estiver aberto.
    const existingBetForEditPolicy = await Bet.findOne({
      user: req.user._id,
      leagueId: String(leagueId)
    }).lean();
    const existingBetsForEditPolicy = new Map(
      (existingBetForEditPolicy?.groupMatches || []).map(b => [Number(b.matchId), b])
    );

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

    // 🛡️ AUTORIDADE ÚNICA DE BLOQUEIO
    // Usa exatamente a mesma regra do frontend/backend de visibilidade.
    // No modo 'grade', o início de QUALQUER partida da grade bloqueia
    // todas as demais partidas daquela grade, inclusive em testMode.
    const checkNow = new Date();
    for (const matchId of matchIdsEnviados) {
      const matchData = matchMap.get(Number(matchId));
      if (!matchData) continue;

      const lockState = getBetLockState(
        matchData,
        settings,
        checkNow,
        dbMatches
      );

      if (lockState.locked && !matchesReenvioPermitido.has(Number(matchId))) {
        const gradeDaPartida = getMatchGrade(matchData);
        const isGradeLock =
          lockState.reason === 'grade_locked' ||
          lockState.reason === 'grade_started';

        return res.status(403).json({
          success: false,
          message: isGradeLock
            ? `As apostas para a fase "${gradeDaPartida}" foram encerradas!`
            : `Aposta bloqueada: Partida ${matchData.teamA} x ${matchData.teamB} já foi iniciada ou encerrada.`
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

      const existingGm = gmMap.get(idNum);
      const qualifier = Object.prototype.hasOwnProperty.call(data || {}, 'qualifier')
        ? normalizeQualifier(data?.qualifier)
        : existingGm?.qualifier ?? null;

      const isKnockoutMatch =
        matchData?.phase === 'knockout' ||
        matchData?.phase === 'mata-mata';

      if (qualifier && !isKnockoutMatch) {
        return res.status(400).json({
          success: false,
          message: `Palpite de classificado não é permitido para a partida ${idNum}, pois ela não pertence ao mata-mata.`
        });
      }

      // Política independente de bloqueio: quando desativada, uma aposta já
      // salva não pode ser modificada. A criação de novas apostas permanece
      // permitida enquanto as regras normais de salvamento permitirem.
      if (settings?.allowBetEditingBeforeLock === false) {
        const existingBetForMatch = existingBetsForEditPolicy.get(idNum);
        if (existingBetForMatch && predictionWasChanged(
          existingBetForMatch,
          effectiveChoice,
          qualifier,
          scoreA,
          scoreB,
          scoresEnabled
        )) {
          return res.status(403).json({
            success: false,
            message: 'A edição de palpites já salvos está desativada pelo administrador.'
          });
        }
      }

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
    // 📧 COMPROVANTE VERSIONADO
    // Cada salvamento efetivamente aceito gera um novo protocolo,
    // snapshot persistido e e-mail com o estado completo atual.
    // ============================================================
    try {
      const { createBetReceipt } = require('../services/betReceiptService');
      const { sendBetsConfirmationEmail } = require('../services/emailService');

      const receiptResult = await createBetReceipt({
        bet,
        matches: dbMatches,
        userId: req.user._id,
        leagueId,
        operation: bet.firstSubmission && bet.firstSubmission.getTime() !== now.getTime() ? 'edit' : 'save',
        userName: req.user.name || 'Participante',
        leagueName: settings?.title || `Liga #${leagueId}`
      });

      const emailAttemptedAt = new Date();
      await receiptResult.receipt.updateOne({
        $set: { 'email.attemptedAt': emailAttemptedAt }
      });

      sendBetsConfirmationEmail(
        req.user.email,
        req.user.name || 'Participante',
        settings?.title || `Liga #${leagueId}`,
        receiptResult.html
      ).then(async response => {
        const messageId = response?.messageId || response?.data?.messageId || null;
        await receiptResult.receipt.updateOne({
          $set: {
            'email.sentAt': new Date(),
            'email.messageId': messageId
          }
        });
      }).catch(async err => {
        console.error('❌ Falha assíncrona ao enviar e-mail de palpites:', err.message);
        try {
          await receiptResult.receipt.updateOne({
            $set: { 'email.error': String(err.message || err) }
          });
        } catch (_) {}
      });

      var generatedProtocol = receiptResult.protocol;
    } catch (receiptError) {
      // O salvamento da aposta não é desfeito por indisponibilidade do e-mail.
      // Mas falha na criação do comprovante deve ser visível no log para auditoria.
      console.error('❌ Erro ao criar comprovante versionado:', receiptError);
      return res.status(500).json({
        success: false,
        message: 'Aposta salva, mas não foi possível registrar o comprovante de auditoria. Contate o administrador.'
      });
    }

    return res.json({
      success: true,
      message: 'Palpites salvos e participação confirmada!',
      data: { id: bet._id, protocol: generatedProtocol }
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

    // Carrega as configurações antes de qualquer regra que dependa delas.
    // Isso é especialmente importante para testMode e para as travas de fase.
    const configId = toLeagueId(leagueId);
    // O modo `grade` precisa consultar todas as partidas da liga para saber
    // se qualquer partida da mesma grade já iniciou. Sem essa coleção,
    // getBetLockState não consegue aplicar corretamente o bloqueio da grade.
    const [settings, dbMatches] = await Promise.all([
      Settings.findById(configId).lean(),
      Match.find({ leagueId: configId })
        .select('matchId group phase phaseName roundNumber roundName teamA teamB date time status')
        .lean()
    ]);

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
    const betLockState = getBetLockState(match, settings, now, dbMatches);

    if (betLockState.locked) {
      const message = (betLockState.reason === 'grade_locked' || betLockState.reason === 'grade_started')
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
        if (settings?.allowBetEditingBeforeLock === false && predictionWasChanged(
          betDoc.groupMatches[index],
          effectiveWinner,
          validQualifier,
          scoreA,
          scoreB,
          scoresEnabled
        )) {
          return res.status(403).json({
            success: false,
            message: 'A edição de palpites já salvos está desativada pelo administrador.'
          });
        }

        betDoc.groupMatches[index].winner = effectiveWinner;
        betDoc.groupMatches[index].scoreA =
          scoreA == null || scoreA === '' ? null : Number(scoreA);
        betDoc.groupMatches[index].scoreB =
          scoreB == null || scoreB === '' ? null : Number(scoreB);
        if (Object.prototype.hasOwnProperty.call(req.body, 'qualifier')) {
          betDoc.groupMatches[index].qualifier = validQualifier;
        }
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

    // Qualquer salvamento individual aceito também gera uma nova versão
    // completa do comprovante, com todos os palpites atuais.
    let generatedProtocol = null;
    try {
      const { createBetReceipt } = require('../services/betReceiptService');
      const { sendBetsConfirmationEmail } = require('../services/emailService');

      const receiptResult = await createBetReceipt({
        bet: betDoc,
        matches: dbMatches,
        userId: req.user._id,
        leagueId,
        operation: 'edit',
        userName: req.user.name || 'Participante',
        leagueName: settings?.title || `Liga #${leagueId}`
      });

      generatedProtocol = receiptResult.protocol;
      await receiptResult.receipt.updateOne({
        $set: { 'email.attemptedAt': new Date() }
      });

      sendBetsConfirmationEmail(
        req.user.email,
        req.user.name || 'Participante',
        settings?.title || `Liga #${leagueId}`,
        receiptResult.html
      ).then(async response => {
        try {
          await receiptResult.receipt.updateOne({
            $set: {
              'email.sentAt': new Date(),
              'email.messageId': response?.messageId || response?.data?.messageId || null
            }
          });
        } catch (_) {}
      }).catch(async err => {
        console.error('❌ Falha assíncrona ao enviar e-mail da edição:', err.message);
        try {
          await receiptResult.receipt.updateOne({
            $set: { 'email.error': String(err.message || err) }
          });
        } catch (_) {}
      });
    } catch (receiptError) {
      console.error('❌ Erro ao criar comprovante da edição:', receiptError);
      return res.status(500).json({
        success: false,
        message: 'Palpite salvo, mas não foi possível registrar o comprovante de auditoria.'
      });
    }

    return res.json({
      success: true,
      message: 'Palpite individual salvo e comprovante atualizado com sucesso!',
      data: { protocol: generatedProtocol }
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
