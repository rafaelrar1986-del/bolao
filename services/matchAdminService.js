'use strict';

const Match = require('../models/Match');
const Bet = require('../models/Bet');
const Settings = require('../models/Settings');
const User = require('../models/User');

const {
  parseMatchDate,
  isValidMatchDate,
  isValidMatchTime,
  isKnockoutPhase,
  validatePhaseSpecificData,
  compareMatchesChronologically,
  toLeagueId,
  VALID_MATCH_PHASES
} = require('./matchValidationService');

const { parsePositiveInteger } = require('../utils/validation');
const { requireLeagueId } = require('../utils/leagueId');

const matchHistoryService = require('./matchHistoryService');
const auditService = require('./auditService');
const emailService = require('./emailService');

async function addMatch(ctx) {

  try {
    const {
      matchId, teamA, teamB, date, time, group, phaseName,
      stadium, phase, apiId, leagueId, leagueName
    } = ctx.req.body;

    // group é required no schema para TODAS as fases, incluindo knockout
    // leagueId é obrigatório e não pode ser vazio.
    const normalizedLeagueId = requireLeagueId(leagueId);

    if (!matchId || !teamA || !teamB || !date || !time || !group || !normalizedLeagueId) {
      return ctx.res.status(400).json({ success: false, message: 'Campos obrigatórios ausentes' });
    }

    if (!isValidMatchDate(String(date).trim())) {
      return ctx.res.status(400).json({
        success: false,
        message: 'date deve estar no formato DD/MM/AAAA e ser uma data válida'
      });
    }

    if (!isValidMatchTime(String(time).trim())) {
      return ctx.res.status(400).json({
        success: false,
        message: 'time deve estar no formato HH:mm e ser um horário válido'
      });
    }

    const normalizedPhase = phase || 'group';

    if (!VALID_MATCH_PHASES.has(normalizedPhase)) {
      return ctx.res.status(400).json({
        success: false,
        message: 'phase inválida. Use "group", "knockout" ou "pontos_corridos".'
      });
    }

    // Uma partida nova nunca pode nascer com dados de resultado incompatíveis
    // com a fase. O add atualmente não recebe placar/classificado, então basta
    // validar a própria fase aqui.
    // 🆕 CORREÇÃO: Validação numérica rigorosa para matchId e apiId
    const idNum = parsePositiveInteger(matchId);
    const apiNum = parsePositiveInteger(apiId);

    if (idNum === null) {
      return ctx.res.status(400).json({
        success: false,
        message: 'matchId deve ser um número inteiro positivo'
      });
    }

    if (apiNum === null) {
      return ctx.res.status(400).json({
        success: false,
        message: 'apiId é obrigatório e deve ser um número inteiro positivo'
      });
    }

    // matchId e apiId são identificadores globais, conforme as restrições
    // do MatchSchema; não podem se repetir entre ligas.
    const exists = await Match.findOne({ matchId: idNum })
      .select('_id leagueId')
      .lean();

    if (exists) {
      return ctx.res.status(409).json({
        success: false,
        message: `Já existe uma partida com esse matchId (${idNum}). O matchId deve ser único globalmente.`
      });
    }

    const apiExists = await Match.findOne({ apiId: apiNum })
      .select('_id leagueId')
      .lean();

    if (apiExists) {
      return ctx.res.status(409).json({
        success: false,
        message: `Já existe uma partida com esse apiId (${apiNum}). O apiId deve ser único globalmente.`
      });
    }

    const m = await Match.create({
      matchId: idNum,
      apiId: apiNum,
      leagueId: normalizedLeagueId, // 🆕 != null (normalizado)
      leagueName: leagueName ? String(leagueName).trim() : undefined,
      teamA: String(teamA).trim(),
      teamB: String(teamB).trim(),
      date: String(date).trim(),
      time: String(time).trim(),
      group: String(group).trim(),
      phaseName: phaseName ? String(phaseName).trim() : undefined,
      stadium: stadium ? String(stadium).trim() : undefined,
      phase: normalizedPhase,
      status: 'scheduled',
      scoreA: null,
      scoreB: null,
      penaltiesA: null,
      penaltiesB: null
    });

    ctx.res.json({ success: true, data: m });
  } catch (err) {
    console.error('Erro ao adicionar partida:', err);
    ctx.res.status(500).json({ success: false, message: 'Erro ao adicionar partida' });
  }


}

async function editMatch(ctx) {


  try {
    const matchId = parsePositiveInteger(ctx.req.params.matchId);
    const normalizedLeagueId = requireLeagueId(ctx.req.body?.leagueId);

    if (matchId === null) {
      return ctx.res.status(400).json({
        success: false,
        message: 'matchId deve ser um número inteiro positivo'
      });
    }

    if (!normalizedLeagueId) {
      return ctx.res.status(400).json({
        success: false,
        message: 'leagueId é obrigatório para editar a partida'
      });
    }

    const match = await Match.findOne({
      matchId,
      leagueId: normalizedLeagueId
    });

    if (!match) {
      return ctx.res.status(404).json({
        success: false,
        message: 'Partida não encontrada'
      });
    }

    const oldStatus = match.status;

    if (Object.prototype.hasOwnProperty.call(ctx.req.body, 'phase')) {
      return ctx.res.status(400).json({
        success: false,
        message: 'O phase da partida não pode ser alterado após a criação.'
      });
    }

    const updates = {};

    const fields = [
      'teamA',
      'teamB',
      'date',
      'time',
      'group',
      'phaseName',
      'stadium',
      'status',
      'scoreA',
      'scoreB',
      'apiId',
      'penaltiesA',
      'penaltiesB',
      'regularTimeScoreA',
      'regularTimeScoreB',
      'qualifiedSide'
    ];

    fields.forEach(k => {
      if (ctx.req.body[k] !== undefined) {
        updates[k] = ctx.req.body[k];
      }
    });

    if (updates.teamA) {
      updates.teamA = String(updates.teamA).trim();
    }

    if (updates.teamB) {
      updates.teamB = String(updates.teamB).trim();
    }

    if (updates.date !== undefined) {
      updates.date = String(updates.date).trim();

      if (!isValidMatchDate(updates.date)) {
        return ctx.res.status(400).json({
          success: false,
          message: 'date deve estar no formato DD/MM/AAAA e ser uma data válida'
        });
      }
    }

    // 🔒 Depois que a partida foi finalizada, sua data não pode mais ser alterada.
    // Isso preserva a referência temporal dos snapshots do PointsHistory.
    if (
      oldStatus === 'finished' &&
      updates.date !== undefined &&
      updates.date !== String(match.date || '').trim()
    ) {
      return ctx.res.status(400).json({
        success: false,
        message: 'A data da partida não pode ser alterada depois que ela foi finalizada.'
      });
    }

    if (updates.time !== undefined) {
      updates.time = String(updates.time).trim();

      if (!isValidMatchTime(updates.time)) {
        return ctx.res.status(400).json({
          success: false,
          message: 'time deve estar no formato HH:mm e ser um horário válido'
        });
      }
    }

    if (updates.phaseName) {
      updates.phaseName = String(updates.phaseName).trim();
    }

    if (updates.group) {
      updates.group = String(updates.group).trim();
    }

    if (updates.stadium) {
      updates.stadium = String(updates.stadium).trim();
    }

    // Se o admin está alterando manualmente o qualifiedSide,
    // sincroniza a flag qualifiedSideManuallySet para que o pre('save') não sobrescreva.
    if (updates.qualifiedSide !== undefined) {
      if (['A', 'B'].includes(updates.qualifiedSide)) {
        updates.qualifiedSideManuallySet = true;
      } else if (updates.qualifiedSide === null) {
        updates.qualifiedSideManuallySet = false;
      }
    }

    // ============================================================
    // GUARDA OS VALORES ANTIGOS DOS CAMPOS DE PLACAR
    // ANTES DO match.set()
    // ============================================================
    const scoreFields = [
      'scoreA',
      'scoreB',
      'penaltiesA',
      'penaltiesB',
      'regularTimeScoreA',
      'regularTimeScoreB',
      'qualifiedSide'
    ];

    const oldValues = {};

    scoreFields.forEach(k => {
      oldValues[k] = match[k];
    });

    // ============================================================
    // VALIDAÇÃO CENTRALIZADA DA FASE E DOS DADOS DE RESULTADO
    // ============================================================
    const effectivePhase = match.phase;

    const phaseValidation = validatePhaseSpecificData({
      phase: effectivePhase,
      scoreA: updates.scoreA !== undefined ? updates.scoreA : match.scoreA,
      scoreB: updates.scoreB !== undefined ? updates.scoreB : match.scoreB,
      penaltiesA: updates.penaltiesA !== undefined ? updates.penaltiesA : match.penaltiesA,
      penaltiesB: updates.penaltiesB !== undefined ? updates.penaltiesB : match.penaltiesB,
      regularTimeScoreA:
        updates.regularTimeScoreA !== undefined
          ? updates.regularTimeScoreA
          : match.regularTimeScoreA,
      regularTimeScoreB:
        updates.regularTimeScoreB !== undefined
          ? updates.regularTimeScoreB
          : match.regularTimeScoreB,
      qualifiedSide:
        updates.qualifiedSide !== undefined
          ? updates.qualifiedSide
          : match.qualifiedSide,
      requireRegularTime: effectivePhase === 'knockout' &&
        (updates.status === 'finished' || match.status === 'finished')
    });

    if (phaseValidation.error) {
      return ctx.res.status(400).json({
        success: false,
        message: phaseValidation.error
      });
    }

    // Normaliza os campos numéricos antes de persistir.
    const normalizedResult = phaseValidation.value;
    ['scoreA', 'scoreB', 'penaltiesA', 'penaltiesB',
      'regularTimeScoreA', 'regularTimeScoreB'].forEach(field => {
      if (updates[field] !== undefined) {
        updates[field] = normalizedResult[field];
      }
    });

    if (updates.qualifiedSide !== undefined) {
      updates.qualifiedSide = normalizedResult.qualifiedSide;
    }

    // ============================================================
    // VALIDAÇÃO DE API ID — ANTES DO match.set()
    // ============================================================
    if (updates.apiId !== undefined) {
      const apiNum = parsePositiveInteger(updates.apiId);

      if (apiNum === null) {
        return ctx.res.status(400).json({
          success: false,
          message: 'apiId deve ser um número inteiro positivo'
        });
      }

      updates.apiId = apiNum;

      const apiExists = await Match.findOne({
        apiId: apiNum,
        matchId: { $ne: match.matchId }
      });

      if (apiExists) {
        return ctx.res.status(409).json({
          success: false,
          message: 'apiId já existe em outra partida'
        });
      }
    }

    // ============================================================
    // APLICA ATUALIZAÇÕES
    // ============================================================
    match.set(updates);

    // ============================================================
    // SE SAIU DE FINISHED PARA NÃO-JOGANDO,
    // LIMPA OS DADOS DA PARTIDA
    // ============================================================
    const nonPlayingStatuses = [
      'scheduled',
      'cancelled',
      'postponed'
    ];

    if (
      oldStatus === 'finished' &&
      nonPlayingStatuses.includes(match.status)
    ) {
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

      match.possession = {
        home: 0,
        away: 0
      };

      match.xg = {
        home: 0,
        away: 0
      };

      match.odds = {
        home: null,
        draw: null,
        away: null
      };

      match.unavailable = [];

      match.ai_analysis = '';
      match.video_url = '';
      match.apiStatus = 'NS';

      match.lineups = {
        home: {
          formation: "",
          players: [],
          substitutes: []
        },

        away: {
          formation: "",
          players: [],
          substitutes: []
        },

        confirmed: false
      };
    }

    // ============================================================
    // MINUTO
    // ============================================================
    if (match.status === 'finished') {
      match.minute = 'Fim';
    } else if (
      match.status === '1_tempo' &&
      !match.minute
    ) {
      match.minute = "0'";
    }

    await match.save();

    // ============================================================
    // 🔒 TRAVA AUTOMÁTICA (GRADE OU PARTIDA) + 👁️ VISIBILIDADE + 📧 AUDITORIA
    //
    // SOMENTE A PRIMEIRA PARTIDA DA GRADE EXECUTA ESTE BLOCO.
    //
    // Ao iniciar a primeira partida:
    //   lockedPhases   -> adiciona a rodada/fase
    //   unlockedPhases -> adiciona a rodada/fase
    //   unlockedPhases -> mantém 'podium'
    //   envia 1 único e-mail
    //
    // As partidas seguintes da mesma grade não entram,
    // porque lockIdentifier já estará em lockedPhases.
    // ============================================================
    if (
      updates.status &&
      oldStatus === 'scheduled' &&
      !['scheduled', 'cancelled', 'postponed'].includes(updates.status)
    ) {
      const configId = toLeagueId(match.leagueId);

      const lockIdentifier =
        match.phaseName ||
        match.group;

      if (lockIdentifier) {

        const currentSettings =
          await Settings.findById(configId).lean();

        const betLockMode =
          currentSettings?.betLockMode || 'grade';

        let settingsUpdated = null;

        if (betLockMode === 'grade') {
          settingsUpdated =
            await Settings.findOneAndUpdate(
              {
                _id: configId,
                lockedPhases: { $ne: lockIdentifier }
              },
              {
                $addToSet: {
                  lockedPhases: lockIdentifier,
                  unlockedPhases: {
                    $each: [
                      lockIdentifier,
                      'podium'
                    ]
                  }
                },
                $set: {
                  statsLocked: false
                }
              },
              {
                new: true
              }
            );
        } else {
          // No modo por partida, o horário da própria partida
          // é a trava. Não bloqueamos a grade nem o salvamento global.
          await Settings.updateOne(
            { _id: configId },
            { $set: { statsLocked: false } }
          );
        }

        // ========================================================
        // E-MAIL SOMENTE SE ESTA FOI A PRIMEIRA PARTIDA
        // DA GRADE.
        //
        // Se lockedPhases já continha lockIdentifier,
        // settingsUpdated será null e nenhum e-mail será enviado.
        // ========================================================
        if (settingsUpdated) {

          try {

            const csv =
              await auditService.generateAuditCSV(
                match.leagueId || 'default',
                lockIdentifier
              );

            if (csv) {

              const users =
                await User.find(
                  {
                    leagues: String(
                      match.leagueId || 'default'
                    )
                  },
                  'email'
                );

              const emails =
                users
                  .map(u => u.email)
                  .filter(Boolean);

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

            console.error(
              '❌ [ADMIN AUDIT]: Erro na auditoria manual:',
              auditErr.message
            );
          }
        }
      }
    }

    // ============================================================
    // DETECÇÃO DE ALTERAÇÃO REAL DE PLACAR
    // ============================================================
    const resultChanged = scoreFields.some(k => {
      if (updates[k] === undefined) return false;

      const oldVal = oldValues[k];
      const newVal = updates[k];

      if (k === 'qualifiedSide') {
        const oldQualified = oldVal == null || oldVal === '' ? null : String(oldVal);
        const newQualified = newVal == null || newVal === '' ? null : String(newVal);
        return oldQualified !== newQualified;
      }

      if (
        (oldVal === null || oldVal === undefined) &&
        (newVal === null || newVal === undefined)
      ) {
        return false;
      }

      if (
        oldVal === null || oldVal === undefined ||
        newVal === null || newVal === undefined
      ) {
        return true;
      }

      return Number(oldVal) !== Number(newVal);
    });

    const becameFinished =
      updates.status === 'finished' &&
      oldStatus !== 'finished';

    const wasAlreadyFinished =
      oldStatus === 'finished' &&
      resultChanged;

    const statusChangedFromFinished =
      oldStatus === 'finished' &&
      updates.status &&
      updates.status !== 'finished';

    // ============================================================
    // RECÁLCULO DE PONTOS
    // ============================================================
    if (
      becameFinished ||
      wasAlreadyFinished ||
      statusChangedFromFinished
    ) {

      try {

        const configId =
          toLeagueId(match.leagueId);

        await matchHistoryService.recalculateAllPoints(
          configId
        );

        const normalizedDate =
          parseMatchDate(match.date);

        if (normalizedDate) {
          if (
            statusChangedFromFinished ||
            wasAlreadyFinished
          ) {
            // Qualquer alteração que afete uma partida que já estava
            // finalizada pode alterar o acumulado dessa data e de todos
            // os dias seguintes. O histórico inteiro da liga precisa ser
            // reconstruído.
            await matchHistoryService.rebuildHistory(
              configId
            );
          } else {
            // Finalização normal: basta atualizar o snapshot do dia.
            await matchHistoryService.saveDailyPoints(
              normalizedDate,
              configId
            );
          }
        }

      } catch (pointsErr) {

        console.error(
          '❌ [ADMIN EDIT]: Erro ao recalcular pontos:',
          pointsErr.message
        );

        return ctx.res.status(500).json({
          success: false,
          message: 'Partida atualizada, mas houve erro ao recalcular pontos/histórico'
        });
      }
    }

    // Usa o documento match diretamente
    // (já reflete pre('save') e save)
    ctx.res.json({
      success: true,
      data: match
    });

  } catch (err) {

    console.error(
      'Erro ao editar partida:',
      err
    );

    ctx.res.status(500).json({
      success: false,
      message:
        err.message ||
        'Erro ao editar partida'
    });
  }


}


async function finishMatch(ctx) {


  try {
    const matchId = parsePositiveInteger(ctx.req.params.matchId);
    const {
      scoreA, scoreB, penaltiesA, penaltiesB,
      regularTimeScoreA, regularTimeScoreB, qualifiedSide
    } = ctx.req.body;

    if (matchId === null) {
      return ctx.res.status(400).json({
        success: false,
        message: 'matchId deve ser um número inteiro positivo'
      });
    }

    const preMatch = await Match.findOne({ matchId });
    if (!preMatch) {
      return ctx.res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    const isKnockout = isKnockoutPhase(preMatch.phase);

    const toScore = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 ? n : NaN;
    };

    const numScoreA = toScore(scoreA);
    const numScoreB = toScore(scoreB);
    const numRegA = toScore(regularTimeScoreA);
    const numRegB = toScore(regularTimeScoreB);
    const numPenA = toScore(penaltiesA);
    const numPenB = toScore(penaltiesB);

    if (numScoreA === null || numScoreB === null || !Number.isInteger(numScoreA) || !Number.isInteger(numScoreB)) {
      return ctx.res.status(400).json({ success: false, message: 'O placar final A e B é obrigatório e deve conter inteiros não negativos.' });
    }

    if (Number.isNaN(numScoreA) || Number.isNaN(numScoreB)) {
      return ctx.res.status(400).json({ success: false, message: 'O placar final deve conter números inteiros não negativos.' });
    }

    if (Number.isNaN(numRegA) || Number.isNaN(numRegB)) {
      return ctx.res.status(400).json({ success: false, message: 'O placar dos 90 minutos deve conter números inteiros não negativos.' });
    }

    if (Number.isNaN(numPenA) || Number.isNaN(numPenB)) {
      return ctx.res.status(400).json({ success: false, message: 'O placar de pênaltis deve conter números inteiros não negativos.' });
    }

    if (numScoreA === null || numScoreB === null) {
      return ctx.res.status(400).json({
        success: false,
        message: 'O placar final A e B é obrigatório e deve conter inteiros não negativos.'
      });
    }

    const phaseValidation = validatePhaseSpecificData({
      phase: preMatch.phase,
      scoreA: numScoreA,
      scoreB: numScoreB,
      penaltiesA: numPenA,
      penaltiesB: numPenB,
      regularTimeScoreA: numRegA,
      regularTimeScoreB: numRegB,
      qualifiedSide,
      requireRegularTime: isKnockout
    });

    if (phaseValidation.error) {
      return ctx.res.status(400).json({
        success: false,
        message: phaseValidation.error
      });
    }

    const normalizedQualifiedSide =
      phaseValidation.value.qualifiedSide;

    // A finalização manual recebe sempre o placar final em scoreA/B.
    // Em grupos, o resultado dos 90 é o próprio placar final.
    const finalRegA = isKnockout ? numRegA : numScoreA;
    const finalRegB = isKnockout ? numRegB : numScoreB;

    const alreadyFinished =
      preMatch.status === 'finished' &&
      preMatch.scoreA === numScoreA &&
      preMatch.scoreB === numScoreB &&
      preMatch.penaltiesA === numPenA &&
      preMatch.penaltiesB === numPenB &&
      preMatch.regularTimeScoreA === finalRegA &&
      preMatch.regularTimeScoreB === finalRegB &&
      preMatch.qualifiedSide === normalizedQualifiedSide;

    if (alreadyFinished) {
      const normalizedDate = parseMatchDate(preMatch.date);

      if (normalizedDate) {
        try {
          await matchHistoryService.saveDailyPoints(
            normalizedDate,
            String(preMatch.leagueId || 'default')
          );
        } catch (historyErr) {
          console.error('❌ [FINISH RETRY]: Erro ao atualizar histórico:', historyErr);
          return ctx.res.status(500).json({
            success: false,
            message: 'Partida já está finalizada, mas houve erro ao atualizar o histórico de pontos'
          });
        }
      }

      return ctx.res.json({
        success: true,
        message: 'Partida já estava finalizada com os mesmos dados. Histórico verificado/atualizado.',
        data: preMatch,
        recalculated: 0
      });
    }

    const match = await Match.finishMatch(
      matchId,
      numScoreA,
      numScoreB,
      numPenA,
      numPenB,
      finalRegA,
      finalRegB,
      normalizedQualifiedSide
    );

    const configId = toLeagueId(match.leagueId);
    const recalcResult = await matchHistoryService.recalculateAllPoints(configId);

    const normalizedDate = parseMatchDate(match.date);
    if (normalizedDate) {

      if (preMatch.status === 'finished' && !alreadyFinished) {
        // Correção de resultado de partida já finalizada: reconstruir todo o histórico.
        await matchHistoryService.rebuildHistory(
          String(match.leagueId || 'default')
        );
      } else {
        // Primeira finalização: atualizar apenas o snapshot do dia.
        await matchHistoryService.saveDailyPoints(
          normalizedDate,
          String(match.leagueId || 'default')
        );
      }
    }

    ctx.res.json({
      success: true,
      message: 'Partida finalizada e pontos recalculados',
      data: match,
      recalculated: recalcResult?.updated || 0
    });
  } catch (err) {
    console.error('Erro ao finalizar partida:', err);
    ctx.res.status(500).json({ success: false, message: err.message || 'Erro ao finalizar partida' });
  }


}


async function unfinishMatches(ctx) {


  try {
    const { matchId, leagueId, leagueName, groupName } = ctx.req.body;
    const normalizedLeagueId = requireLeagueId(leagueId);

    if (!normalizedLeagueId) {
      return ctx.res.status(400).json({
        success: false,
        message: 'leagueId é obrigatório para reabrir partidas'
      });
    }

    let filter = {};

    if (matchId !== undefined && matchId !== null && String(matchId).trim() !== '') {
      const normalizedMatchId = parsePositiveInteger(matchId);

      if (normalizedMatchId === null) {
        return ctx.res.status(400).json({
          success: false,
          message: 'matchId deve ser um número inteiro positivo'
        });
      }

      filter = {
        matchId: normalizedMatchId,
        leagueId: normalizedLeagueId
      };
    } else {
      if (leagueName && groupName) {
        filter = {
          leagueId: normalizedLeagueId,
          leagueName,
          group: groupName
        };
      } else if (leagueName) {
        filter = {
          leagueId: normalizedLeagueId,
          leagueName
        };
      } else {
        return ctx.res.status(400).json({
          success: false,
          message: 'Parâmetros insuficientes'
        });
      }
    }

    const matches = await Match.find(filter)
      .select('matchId leagueId date');

    const ids = matches.map(m => m.matchId);
    const affectedLeagueIds = [
      ...new Set(matches.map(m => m.leagueId).filter(Boolean))
    ];


    if (ids.length === 0) {
      return ctx.res.status(404).json({ success: false, message: 'Nenhuma partida encontrada' });
    }

    for (const id of ids) {
      await Match.unfinishMatch(id, normalizedLeagueId, 'scheduled');
    }

    for (const lid of affectedLeagueIds) {
      await matchHistoryService.recalculateAllPoints(toLeagueId(lid));
    }

    for (const lid of affectedLeagueIds) {
      await matchHistoryService.rebuildHistory(toLeagueId(lid));
    }

    ctx.res.json({
      success: true,
      message: `${ids.length} partida(s) reaberta(s) e pontos recalculadas.`
    });
  } catch (err) {
    console.error('❌ Erro no unfinish-bulk:', err);
    ctx.res.status(500).json({ success: false, message: 'Erro ao reabrir partidas' });
  }


}


async function deleteMatches(ctx) {


  try {
    const { matchId, leagueId, leagueName, groupName } = ctx.req.body;
    const normalizedLeagueId = requireLeagueId(leagueId);

    if (!normalizedLeagueId) {
      return ctx.res.status(400).json({
        success: false,
        message: 'leagueId é obrigatório para excluir partidas'
      });
    }

    let filter = {};

    if (matchId !== undefined && matchId !== null && String(matchId).trim() !== '') {
      const normalizedMatchId = parsePositiveInteger(matchId);

      if (normalizedMatchId === null) {
        return ctx.res.status(400).json({
          success: false,
          message: 'matchId deve ser um número inteiro positivo'
        });
      }

      filter = {
        matchId: normalizedMatchId,
        leagueId: normalizedLeagueId
      };
    } else {
      if (leagueName && groupName) {
        filter = {
          leagueId: normalizedLeagueId,
          leagueName,
          group: groupName
        };
      } else if (leagueName) {
        filter = {
          leagueId: normalizedLeagueId,
          leagueName
        };
      } else {
        return ctx.res.status(400).json({
          success: false,
          message: 'Parâmetros insuficientes'
        });
      }
    }

    const matchesToDelete = await Match.find(filter)
      .select('matchId leagueId date');

    const ids = matchesToDelete.map(m => m.matchId);
    const affectedLeagueIds = [
      ...new Set(matchesToDelete.map(m => m.leagueId).filter(Boolean))
    ];


    if (ids.length === 0) return ctx.res.status(404).json({ success: false, message: 'Nada para excluir' });

    const session = await Match.startSession();

    try {
      await session.withTransaction(async () => {
        const deleteFilter = {
          matchId: { $in: ids }
        };

        if (filter.leagueId !== undefined) {
          deleteFilter.leagueId = filter.leagueId;
        }

        await Match.deleteMany(
          deleteFilter,
          { session }
        );

        // Remove as partidas das apostas dentro da mesma transação.
        await Bet.updateMany(
          {
            'groupMatches.matchId': { $in: ids },
            leagueId: String(normalizedLeagueId)
          },
          { $pull: { groupMatches: { matchId: { $in: ids } } } },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    try {
      for (const lid of affectedLeagueIds) {
        await matchHistoryService.recalculateAllPoints(toLeagueId(lid));
      }

      for (const lid of affectedLeagueIds) {
        await matchHistoryService.rebuildHistory(toLeagueId(lid));
      }
    } catch (e) {
      console.error('❌ Erro ao recalcular após exclusão:', e);
      return ctx.res.status(500).json({
        success: false,
        message: 'Partidas excluídas, mas houve erro ao recalcular os pontos'
      });
    }

    ctx.res.json({
      success: true,
      message: `${ids.length} partida(s) excluída(s) e pontos recalculados.`
    });
  } catch (err) {
    console.error('❌ Erro no delete-bulk:', err);
    ctx.res.status(500).json({ success: false, message: 'Erro ao excluir partidas' });
  }


}


async function getAllMatches(ctx) {

  try {
    const { leagueId } = ctx.req.query;

    // leagueId é obrigatório para evitar contaminação de apostas entre ligas.
    const normalizedLeagueId = requireLeagueId(leagueId);

    if (!normalizedLeagueId) {
      return ctx.res.status(400).json({
        success: false,
        message: 'leagueId é obrigatório'
      });
    }

    const filtro = { leagueId: normalizedLeagueId };

    const matches = await Match.find(filtro).lean();
    matches.sort(compareMatchesChronologically);

    const betPipeline = [
      { $match: { leagueId: normalizedLeagueId } },
      { $unwind: '$groupMatches' },
      { $group: { _id: '$groupMatches.matchId', count: { $sum: 1 } } }
    ];

    const betCounts = await Bet.aggregate(betPipeline);

    const countMap = new Map(betCounts.map(b => [b._id, b.count]));
    const enriched = matches.map(m => ({
      ...m,
      betsCount: countMap.get(m.matchId) || 0,
    }));

    ctx.res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Erro ao listar partidas (admin):', err);
    ctx.res.status(500).json({ success: false, message: 'Erro ao listar partidas' });
  }

}

module.exports = { addMatch, editMatch, finishMatch, unfinishMatches, deleteMatches, getAllMatches };
