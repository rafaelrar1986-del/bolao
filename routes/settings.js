// routes/settings.js

const express = require('express');
const router = express.Router();

const Settings = require('../models/Settings');
const PointsService = require('../services/pointsService');
const { rebuildLeagueDailyHistory } = require('../services/dailyHistoryService');

const { protect, admin } = require('../middleware/auth');

/**
 * ================================================================
 * HELPER: Normaliza o ID da liga
 * ================================================================
 *
 * O schema Settings usa _id como String:
 *   '1'
 *   '27'
 *   'default'
 */
function toLeagueId(leagueId) {
  return leagueId != null
    ? String(leagueId).trim()
    : 'default';
}

/**
 * ================================================================
 * GET /api/settings/global
 * ================================================================
 *
 * Busca as configurações de uma liga específica.
 *
 * Acesso: Público
 */
const {
  assertChampionshipRulesEditable,
  isChangingChampionshipRules
} = require('../services/championshipRulesService');

router.get('/global', async (req, res) => {
  try {
    const leagueId =
      req.query.leagueId || '1';

    const configId =
      toLeagueId(leagueId);

    let settings =
      await Settings.findById(configId).lean();

    /*
     * Se a configuração não existir,
     * cria uma configuração inicial para a liga.
     */
    if (!settings) {
      settings = await Settings.create({
        _id: configId,

        leagueId: String(leagueId),

        unlockedPhases: [],

        lockedPhases: [],

        blockSaveBets: false,

        blockSaveKnockout: false,

        statsLocked: true
      });
    }

    return res.json({
      success: true,
      data: settings
    });

  } catch (err) {

    console.error(
      'Erro ao ler configurações:',
      err
    );

    return res.status(500).json({
      success: false,
      message: 'Erro ao ler configurações'
    });
  }
});

/**
 * ================================================================
 * POST /api/settings/global
 * ================================================================
 *
 * Rota unificada para editar:
 *
 * - travas
 * - regras de pontuação
 * - regras do campeonato
 * - resultados oficiais dos Extras
 * - configurações do robô
 *
 * Acesso: Admin
 */
router.post('/global', protect, admin, async (req, res) => {
  try {

    const targetLeagueId =
      req.body.leagueId ||
      req.query.leagueId ||
      '1';

    const configId =
      toLeagueId(targetLeagueId);

    /*
     * O robô continua sendo forçado
     * para a liga principal '1'.
     */
    const mainLeagueId =
      toLeagueId('1');

    /*
     * ============================================================
     * 1. CAMPOS DE TRAVA / CONFIGURAÇÕES GERAIS
     * ============================================================
     */

    const lockUpdates = {};

    const booleanFields = [
      'blockSaveBets',
      'blockSaveKnockout',
      'requireAllBets',
      'statsLocked'
    ];

    if (req.body.betLockMode !== undefined) {
      if (!['grade', 'match'].includes(req.body.betLockMode)) {
        return res.status(400).json({
          success: false,
          message: 'betLockMode inválido. Use "grade" ou "match".'
        });
      }
      lockUpdates.betLockMode = req.body.betLockMode;
    }

    booleanFields.forEach(field => {

      if (req.body[field] !== undefined) {
        lockUpdates[field] =
          !!req.body[field];
      }

    });

    /*
     * Fases liberadas
     */
    if (
      req.body.unlockedPhases &&
      Array.isArray(req.body.unlockedPhases)
    ) {
      lockUpdates.unlockedPhases =
        req.body.unlockedPhases;
    }

    /*
     * Fases bloqueadas
     */
    if (
      req.body.lockedPhases &&
      Array.isArray(req.body.lockedPhases)
    ) {
      lockUpdates.lockedPhases =
        req.body.lockedPhases;
    }

    /*
     * Motivo do bloqueio
     */
    if (
      req.body.lockedReason !== undefined
    ) {
      lockUpdates.lockedReason =
        req.body.lockedReason;
    }

    /*
     * Data/hora de desbloqueio
     */
    if (
      req.body.unlockAt !== undefined
    ) {
      lockUpdates.unlockAt =
        req.body.unlockAt
          ? new Date(req.body.unlockAt)
          : null;
    }

    /*
     * Status da liga
     */
    if (
      req.body.status !== undefined
    ) {
      lockUpdates.status =
        req.body.status;
    }

    /*
     * Título da liga
     */
    if (
      req.body.title !== undefined
    ) {
      lockUpdates.title =
        String(req.body.title).trim();
    }

    /*
     * ============================================================
     * 🔒 2A. CONGELAMENTO DAS REGRAS DO CAMPEONATO
     * ============================================================
     *
     * firstMatchStartedAt é permanente.
     * Reabrir/reiniciar partida não libera as regras.
     */
    const currentSettingsForRules =
      await Settings.findById(configId).lean();

    const changingChampionshipRules =
      isChangingChampionshipRules(req.body);

    if (changingChampionshipRules) {
      try {
        assertChampionshipRulesEditable(currentSettingsForRules);
      } catch (error) {
        return res.status(error.statusCode || 400).json({
          success: false,
          message: error.message
        });
      }
    }

    /*
     * ============================================================
     * 2. REGRAS DE PONTUAÇÃO
     * ============================================================
     *
     * Fazemos MERGE com as regras atuais para não apagar
     * configurações que não vierem neste request.
     */

    let shouldRecalculate = false;
    const historyEventsToAppend = [];

    /*
     * Regras de pontuação
     */
    if (
      req.body.scoringRules &&
      typeof req.body.scoringRules === 'object'
    ) {

      const settings =
        await Settings
          .findById(configId)
          .lean();

      const currentScoring =
        settings?.scoringRules || {};

      const incomingScoring = { ...req.body.scoringRules };

      if (incomingScoring.scoringMode !== undefined) {
        if (!['independent', 'dependent'].includes(incomingScoring.scoringMode)) {
          return res.status(400).json({
            success: false,
            message: 'scoringMode deve ser independent ou dependent.'
          });
        }
      }

      lockUpdates.scoringRules = {
        ...currentScoring,
        ...incomingScoring
      };

      shouldRecalculate = true;
    }

    /*
     * Regras adicionais do campeonato
     */
    if (
      req.body.championshipRules &&
      typeof req.body.championshipRules === 'object'
    ) {

      const settings =
        await Settings
          .findById(configId)
          .lean();

      const currentChamp =
        settings?.championshipRules || {};

      lockUpdates.championshipRules = {
        ...currentChamp,
        ...req.body.championshipRules
      };

      shouldRecalculate = true;
    }

    /*
     * ============================================================
     * 3. RESULTADOS OFICIAIS DOS EXTRAS
     * ============================================================
     *
     * Exemplos:
     *
     * championshipResults: {
     *   topScorer: 'Jogador X',
     *   bestAttack: 'Brasil',
     *   worstDefense: 'Canadá',
     *   upset: 'Japão'
     * }
     */
    if (
      req.body.championshipResults &&
      typeof req.body.championshipResults === 'object'
    ) {

      const settings =
        await Settings
          .findById(configId)
          .lean();

      const currentResults =
        settings?.championshipResults || {};

      lockUpdates.championshipResults = {
        ...currentResults,
        ...req.body.championshipResults
      };

      /*
       * Registra cada definição/correção de Extra.
       * O timestamp é o momento em que o ADM efetivamente alterou o dado.
       * O histórico usa o último evento conhecido até o fim de cada dia.
       */
      for (const key of [
        'topScorer',
        'bestAttack',
        'worstDefense',
        'upset'
      ]) {
        if (
          Object.prototype.hasOwnProperty.call(
            req.body.championshipResults,
            key
          )
        ) {
          const previous = currentResults[key] ?? null;
          const next = req.body.championshipResults[key] ?? null;

          if (String(previous ?? '') !== String(next ?? '')) {
            historyEventsToAppend.push({
              type: 'extra_defined',
              key,
              value: next,
              at: new Date()
            });
          }
        }
      }

      shouldRecalculate = true;
    }

    /*
     * ============================================================
     * 4. SALVA AS CONFIGURAÇÕES DA LIGA
     * ============================================================
     */

    const updateOperations = {
      $set: {
        ...lockUpdates,
        leagueId: String(targetLeagueId)
      }
    };

    if (historyEventsToAppend.length > 0) {
      updateOperations.$push = {
        historyEvents: {
          $each: historyEventsToAppend
        }
      };
    }

    const settingsSaved =
      await Settings.findByIdAndUpdate(
        configId,
        updateOperations,
        {
          new: true,
          upsert: true
        }
      ).lean();

    /*
     * ============================================================
     * 5. RECÁLCULO AUTOMÁTICO DOS PONTOS
     * ============================================================
     *
     * Se foram alteradas:
     *
     * - scoringRules
     * - championshipRules
     * - championshipResults
     *
     * recalcula todas as apostas da liga.
     *
     * Isso atualiza:
     *
     * - groupMatches.points
     * - groupMatches.pointsBreakdown
     * - podiumPoints
     * - extrasBreakdown
     * - extrasPoints
     * - totalPoints
     */

    let recalculateResult = null;

    if (shouldRecalculate) {

      try {

        recalculateResult =
          await PointsService.recalculateAllPoints(
            configId
          );

      } catch (recalculateError) {

        /*
         * O Settings já foi salvo.
         * Porém, se o recálculo falhar,
         * informamos claramente no retorno.
         */
        console.error(
          'Erro ao recalcular pontos após atualização das configurações:',
          recalculateError
        );

        return res.status(500).json({
          success: false,

          message:
            'Configurações salvas, mas ocorreu um erro ao recalcular os pontos.',

          data: settingsSaved,

          recalculate: {
            success: false,
            error:
              recalculateError.message ||
              'Erro desconhecido'
          }
        });
      }
    }

    if (historyEventsToAppend.length > 0) {
      try {
        await rebuildLeagueDailyHistory(configId);
      } catch (historyError) {
        console.error(
          'Erro ao reconstruir histórico após alteração de Extras:',
          historyError
        );

        return res.status(500).json({
          success: false,
          message:
            'Configurações salvas e pontos recalculados, mas ocorreu um erro ao reconstruir o histórico.',
          data: settingsSaved,
          recalculate: recalculateResult,
          history: {
            success: false,
            error:
              historyError.message ||
              'Erro desconhecido'
          }
        });
      }
    }

    /*
     * ============================================================
     * 6. CONFIGURAÇÕES DO ROBÔ
     * ============================================================
     *
     * Essas configurações continuam sendo forçadas
     * para a liga principal '1'.
     */

    const robotUpdates = {};

    let hasRobotUpdates = false;

    /*
     * Intervalo do robô
     */
    if (
      req.body.cron_interval !== undefined
    ) {

      robotUpdates.cron_interval =
        Number(req.body.cron_interval);

      hasRobotUpdates = true;
    }

    /*
     * Temporada da API
     */
    if (
      req.body.api_season !== undefined
    ) {

      robotUpdates.api_season =
        Number(req.body.api_season);

      hasRobotUpdates = true;
    }

    /*
     * Competições da API
     */
    if (
      req.body.api_leagues !== undefined
    ) {

      robotUpdates.api_leagues =
        Array.isArray(req.body.api_leagues)
          ? req.body.api_leagues.map(
              id => Number(id)
            )
          : [];

      hasRobotUpdates = true;
    }

    /*
     * Salva configurações do robô
     * na liga principal.
     */
    if (hasRobotUpdates) {

      await Settings.findByIdAndUpdate(
        mainLeagueId,

        {
          $set: robotUpdates
        },

        {
          upsert: true
        }
      );
    }

    /*
     * ============================================================
     * 7. RESPOSTA
     * ============================================================
     */

    return res.json({
      success: true,

      message:
        `Configurações da liga ${targetLeagueId} atualizadas.`,

      data: settingsSaved,

      recalculate: recalculateResult
    });

  } catch (err) {

    console.error(
      'Erro ao atualizar configurações:',
      err
    );

    return res.status(500).json({
      success: false,
      message:
        err.message ||
        'Erro ao atualizar configurações'
    });
  }
});

module.exports = router;
