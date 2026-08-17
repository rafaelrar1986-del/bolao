// routes/settings.js

const express = require('express');
const router = express.Router();

const Settings = require('../models/Settings');
const PointsService = require('../services/pointsService');

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
     * 2. REGRAS DE PONTUAÇÃO
     * ============================================================
     *
     * Fazemos MERGE com as regras atuais para não apagar
     * configurações que não vierem neste request.
     */

    let shouldRecalculate = false;

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

      lockUpdates.scoringRules = {
        ...currentScoring,
        ...req.body.scoringRules
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
       * IMPORTANTE:
       * qualquer alteração nos resultados oficiais
       * dos Extras precisa recalcular as apostas.
       */
      shouldRecalculate = true;
    }

    /*
     * ============================================================
     * 4. SALVA AS CONFIGURAÇÕES DA LIGA
     * ============================================================
     */

    const settingsSaved =
      await Settings.findByIdAndUpdate(
        configId,

        {
          $set: {
            ...lockUpdates,
            leagueId: String(targetLeagueId)
          }
        },

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
