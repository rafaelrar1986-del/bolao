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


/**
 * ================================================================
 * 🧪 POST /api/settings/test-mode
 * ================================================================
 *
 * Modo temporário de testes do administrador.
 * Não apaga firstMatchStartedAt nem altera status das partidas.
 * Ao ativar, guarda as travas atuais e limpa locked/unlocked phases.
 * Ao desativar, restaura exatamente o estado anterior.
 */
router.post('/test-mode', protect, admin, async (req, res) => {
  try {
    const leagueId = toLeagueId(
      req.body?.leagueId || req.query?.leagueId || '1'
    );

    const enabled = req.body?.enabled === true;
    const settings = await Settings.findById(leagueId);

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Configuração da liga não encontrada.'
      });
    }

    if (enabled) {
      if (settings.testMode === true) {
        return res.json({
          success: true,
          testMode: true,
          data: settings
        });
      }

      const backup = {
        lockedPhases: Array.isArray(settings.lockedPhases)
          ? [...settings.lockedPhases]
          : [],
        unlockedPhases: Array.isArray(settings.unlockedPhases)
          ? [...settings.unlockedPhases]
          : [],
        blockSaveBets: Boolean(settings.blockSaveBets),
        blockSaveKnockout: Boolean(settings.blockSaveKnockout),
        betLockMode: settings.betLockMode || 'grade',
        lockedReason: settings.lockedReason ?? null,
        unlockAt: settings.unlockAt ?? null
      };

      settings.testModeBackup = backup;
      settings.testMode = true;

      // Durante o teste, as fases não ficam presas por nenhuma trava.
      settings.lockedPhases = [];
      settings.unlockedPhases = [];

      // O botão de teste deve conseguir salvar apostas.
      settings.blockSaveBets = false;
      settings.blockSaveKnockout = false;

      // Metadados de trava não devem induzir o frontend a bloquear.
      settings.lockedReason = null;
      settings.unlockAt = null;

      await settings.save();

      return res.json({
        success: true,
        testMode: true,
        message: 'Modo de teste ativado. Bloqueios temporários foram liberados.',
        data: settings
      });
    }

    if (settings.testMode !== true) {
      return res.json({
        success: true,
        testMode: false,
        message: 'O modo de teste já estava desativado.',
        data: settings
      });
    }

    const backup = settings.testModeBackup || {};

    settings.lockedPhases = Array.isArray(backup.lockedPhases)
      ? backup.lockedPhases
      : [];
    settings.unlockedPhases = Array.isArray(backup.unlockedPhases)
      ? backup.unlockedPhases
      : [];
    settings.blockSaveBets = Boolean(backup.blockSaveBets);
    settings.blockSaveKnockout = Boolean(backup.blockSaveKnockout);
    settings.betLockMode =
      backup.betLockMode === 'match' ? 'match' : 'grade';
    settings.lockedReason = backup.lockedReason ?? null;
    settings.unlockAt = backup.unlockAt
      ? new Date(backup.unlockAt)
      : null;

    settings.testMode = false;
    settings.testModeBackup = null;

    await settings.save();

    return res.json({
      success: true,
      testMode: false,
      message: 'Modo de teste encerrado. Configuração anterior restaurada.',
      data: settings
    });
  } catch (err) {
    console.error('Erro ao alternar modo de teste:', err);
    return res.status(500).json({
      success: false,
      message: 'Erro ao alterar modo de teste.'
    });
  }
});

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

    if (req.body.knockoutBetAvailabilityMode !== undefined) {
      if (!['all', 'round'].includes(req.body.knockoutBetAvailabilityMode)) {
        return res.status(400).json({
          success: false,
          message: 'knockoutBetAvailabilityMode inválido. Use "all" ou "round".'
        });
      }
      lockUpdates.knockoutBetAvailabilityMode = req.body.knockoutBetAvailabilityMode;
    }

    for (const field of ['unlockedKnockoutRounds', 'lockedKnockoutRounds']) {
      if (req.body[field] !== undefined) {
        if (!Array.isArray(req.body[field])) {
          return res.status(400).json({
            success: false,
            message: `${field} deve ser um array.`
          });
        }
        lockUpdates[field] = [...new Set(
          req.body[field].map(Number).filter(n => Number.isInteger(n) && n > 0)
        )].sort((a,b) => a-b);
      }
    }

    if (req.body.pointsRunBetAvailabilityMode !== undefined) {
      if (!['all', 'round'].includes(req.body.pointsRunBetAvailabilityMode)) {
        return res.status(400).json({
          success: false,
          message: 'pointsRunBetAvailabilityMode inválido. Use "all" ou "round".'
        });
      }
      lockUpdates.pointsRunBetAvailabilityMode = req.body.pointsRunBetAvailabilityMode;
    }

    for (const field of ['unlockedPointsRunRounds', 'lockedPointsRunRounds']) {
      if (req.body[field] !== undefined) {
        if (!Array.isArray(req.body[field])) {
          return res.status(400).json({
            success: false,
            message: `${field} deve ser um array.`
          });
        }
        lockUpdates[field] = [...new Set(
          req.body[field].map(Number).filter(n => Number.isInteger(n) && n > 0)
        )].sort((a,b) => a-b);
      }
    }

    if (req.body.groupBetAvailabilityMode !== undefined) {
      if (!['all', 'round'].includes(req.body.groupBetAvailabilityMode)) {
        return res.status(400).json({
          success: false,
          message: 'groupBetAvailabilityMode inválido. Use "all" ou "round".'
        });
      }
      lockUpdates.groupBetAvailabilityMode = req.body.groupBetAvailabilityMode;
    }

    for (const field of ['unlockedGroupRounds', 'lockedGroupRounds']) {
      if (req.body[field] !== undefined) {
        if (!Array.isArray(req.body[field])) {
          return res.status(400).json({
            success: false,
            message: `${field} deve ser um array.`
          });
        }
        lockUpdates[field] = [...new Set(
          req.body[field].map(Number).filter(n => Number.isInteger(n) && n > 0)
        )].sort((a,b) => a-b);
      }
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
     * ============================================================
     * 💰 3B. CONFIGURAÇÃO DE PAGAMENTO / PIX
     * ============================================================
     * Os dados são específicos da liga.
     */
    if (req.body.pixKey !== undefined) {
      const pixKey = String(req.body.pixKey ?? '').trim();
      if (pixKey.length > 200) {
        return res.status(400).json({
          success: false,
          message: 'A chave PIX deve ter no máximo 200 caracteres.'
        });
      }
      lockUpdates.pixKey = pixKey;
    }

    if (req.body.pixQrCode !== undefined) {
      const pixQrCode = String(req.body.pixQrCode ?? '').trim();

      if (pixQrCode && !/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(pixQrCode)) {
        return res.status(400).json({
          success: false,
          message: 'QR Code inválido. Envie uma imagem PNG, JPG ou WebP.'
        });
      }

      if (pixQrCode.length > 1500000) {
        return res.status(400).json({
          success: false,
          message: 'A imagem do QR Code é muito grande. Reduza a imagem e tente novamente.'
        });
      }

      lockUpdates.pixQrCode = pixQrCode;
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

      if (incomingScoring.matchRules !== undefined) {
        if (!Array.isArray(incomingScoring.matchRules)) {
          return res.status(400).json({
            success: false,
            message: 'matchRules deve ser um array de regras.'
          });
        }

        if (incomingScoring.matchRules.length > 50) {
          return res.status(400).json({
            success: false,
            message: 'São permitidas no máximo 50 regras de pontuação.'
          });
        }

        const allowedConditions = [
          'exactScore',
          'result',
          'scoreTeamA',
          'scoreTeamB',
          'scoreWinner',
          'scoreLoser',
          'totalGoals',
          'goalDifference',
          'qualifier'
        ];

        const championshipForRules = {
          ...(currentSettingsForRules?.championshipRules || {}),
          ...(req.body.championshipRules || {}),
          ...(lockUpdates.championshipRules || {})
        };

        const seenRuleSignatures = new Set();

        for (let i = 0; i < incomingScoring.matchRules.length; i++) {
          const rule = incomingScoring.matchRules[i];

          if (!rule || typeof rule !== 'object') {
            return res.status(400).json({
              success: false,
              message: `Regra ${i + 1} inválida.`
            });
          }

          const points = Number(rule.points);
          const conditions = Array.isArray(rule.conditions)
            ? [...new Set(rule.conditions)]
            : [];

          if (!Number.isFinite(points) || points < 0) {
            return res.status(400).json({
              success: false,
              message: `A pontuação da regra ${i + 1} é inválida.`
            });
          }

          if (conditions.length === 0) {
            return res.status(400).json({
              success: false,
              message: `A regra ${i + 1} precisa ter pelo menos uma condição.`
            });
          }

          for (const condition of conditions) {
            if (!allowedConditions.includes(condition)) {
              return res.status(400).json({
                success: false,
                message: `Condição inválida na regra ${i + 1}: ${condition}`
              });
            }

            if (
              condition === 'qualifier' &&
              championshipForRules.hasKnockoutPhase !== true
            ) {
              return res.status(400).json({
                success: false,
                message: 'A condição Classificado só pode ser usada em campeonatos com fase mata-mata.'
              });
            }
          }

          const signature = conditions.slice().sort().join('|');
          if (seenRuleSignatures.has(signature)) {
            return res.status(400).json({
              success: false,
              message: `A regra ${i + 1} repete exatamente as mesmas condições de outra regra.`
            });
          }
          seenRuleSignatures.add(signature);
        }
      }

      if (incomingScoring.groupQualificationRules !== undefined) {
        if (!Array.isArray(incomingScoring.groupQualificationRules)) {
          return res.status(400).json({
            success: false,
            message: 'groupQualificationRules deve ser um array de regras.'
          });
        }
        if (incomingScoring.groupQualificationRules.length > 50) {
          return res.status(400).json({
            success: false,
            message: 'São permitidas no máximo 50 regras de classificação para o mata-mata.'
          });
        }

        const allowedGroupConditions = [
          'positionCorrect',
          'positionIncorrect',
          'teamQualified',
          'teamNotQualified'
        ];
        const championshipForGroupRules = {
          ...(currentSettingsForRules?.championshipRules || {}),
          ...(req.body.championshipRules || {}),
          ...(lockUpdates.championshipRules || {})
        };
        if (championshipForGroupRules.hasGroupPhase === false && incomingScoring.groupQualificationRules.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Regras de classificação dos grupos não podem ser usadas em um campeonato sem fase de grupos.'
          });
        }
        const seenGroupRuleSignatures = new Set();

        for (let i = 0; i < incomingScoring.groupQualificationRules.length; i++) {
          const rule = incomingScoring.groupQualificationRules[i];
          if (!rule || typeof rule !== 'object') {
            return res.status(400).json({
              success: false,
              message: `Regra de classificação ${i + 1} inválida.`
            });
          }

          const points = Number(rule.points);
          const conditions = Array.isArray(rule.conditions)
            ? [...new Set(rule.conditions)]
            : [];

          if (!Number.isFinite(points) || points < 0) {
            return res.status(400).json({
              success: false,
              message: `A pontuação da regra de classificação ${i + 1} é inválida.`
            });
          }
          if (!conditions.length) {
            return res.status(400).json({
              success: false,
              message: `A regra de classificação ${i + 1} precisa ter pelo menos uma condição.`
            });
          }
          for (const condition of conditions) {
            if (!allowedGroupConditions.includes(condition)) {
              return res.status(400).json({
                success: false,
                message: `Condição inválida na regra de classificação ${i + 1}: ${condition}`
              });
            }
            if (
              (condition === 'teamQualified' || condition === 'teamNotQualified') &&
              championshipForGroupRules.hasKnockoutPhase !== true
            ) {
              return res.status(400).json({
                success: false,
                message: 'As condições de classificação/não classificação só podem ser usadas quando houver fase mata-mata.'
              });
            }
          }

          const signature=conditions.slice().sort().join('|');
          if (seenGroupRuleSignatures.has(signature)) {
            return res.status(400).json({
              success: false,
              message: `A regra de classificação ${i + 1} repete exatamente as mesmas condições de outra regra.`
            });
          }
          seenGroupRuleSignatures.add(signature);
        }
      }

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

      const incomingChampionshipRules = {
        ...req.body.championshipRules
      };

      const hasGroupPhase = incomingChampionshipRules.hasGroupPhase !== undefined
        ? Boolean(incomingChampionshipRules.hasGroupPhase)
        : currentChamp.hasGroupPhase !== false;
      const hasKnockoutPhase = incomingChampionshipRules.hasKnockoutPhase !== undefined
        ? Boolean(incomingChampionshipRules.hasKnockoutPhase)
        : currentChamp.hasKnockoutPhase === true;

      // A combinação dos dois booleanos define o formato:
      // grupos, mata-mata, grupos + mata-mata ou pontos corridos.
      incomingChampionshipRules.hasGroupPhase = hasGroupPhase;
      incomingChampionshipRules.hasKnockoutPhase = hasKnockoutPhase;

      const rawQualification = incomingChampionshipRules.groupQualification !== undefined
        ? incomingChampionshipRules.groupQualification
        : (currentChamp.groupQualification || {});

      if (!rawQualification || typeof rawQualification !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'groupQualification deve ser um objeto.'
        });
      }

      const totalTeams = hasGroupPhase ? Math.floor(Number(rawQualification.totalTeams || 0)) : 0;
      const groupCount = hasGroupPhase ? Math.floor(Number(rawQualification.groupCount || 0)) : 0;
      const totalQualified = hasGroupPhase && hasKnockoutPhase
        ? Math.floor(Number(rawQualification.totalQualified || 0))
        : 0;

      if (totalTeams < 0 || groupCount < 0 || totalQualified < 0) {
        return res.status(400).json({
          success: false,
          message: 'Os valores da classificação por grupos não podem ser negativos.'
        });
      }

      if (hasGroupPhase) {
        if (!totalTeams || !groupCount) {
          return res.status(400).json({
            success: false,
            message: 'Informe número de times e número de grupos para uma fase de grupos.'
          });
        }
        if (totalTeams % groupCount !== 0) {
          return res.status(400).json({
            success: false,
            message: 'O número de times deve ser divisível pelo número de grupos.'
          });
        }

        if (hasKnockoutPhase) {
          if (!totalQualified) {
            return res.status(400).json({
              success: false,
              message: 'Informe o número de classificados para o mata-mata.'
            });
          }
          if (totalQualified > totalTeams) {
            return res.status(400).json({
              success: false,
              message: 'O número de classificados não pode ser maior que o número de times.'
            });
          }

          const teamsPerGroup = totalTeams / groupCount;
          const qualifiedPerGroup = Math.floor(totalQualified / groupCount);
          const additional = totalQualified % groupCount;

          if (qualifiedPerGroup > teamsPerGroup) {
            return res.status(400).json({
              success: false,
              message: 'A configuração exige mais classificados por grupo do que existem times no grupo.'
            });
          }
          if (additional > 0 && qualifiedPerGroup >= teamsPerGroup) {
            return res.status(400).json({
              success: false,
              message: 'Não há uma posição seguinte disponível para os classificados adicionais.'
            });
          }
        }
      }

      // Sem grupos, ou com grupos sem mata-mata, não existe o conceito
      // de classificados para o mata-mata.
      incomingChampionshipRules.groupQualification = {
        totalTeams,
        groupCount,
        totalQualified
      };
      lockUpdates.championshipRules = {
        ...currentChamp,
        ...incomingChampionshipRules
      };

      // Se a fase de grupos foi desativada, regras antigas de classificação
      // não podem continuar válidas de forma invisível.
      if (hasGroupPhase === false) {
        const currentScoring = {
          ...(currentSettingsForRules?.scoringRules || {}),
          ...(lockUpdates.scoringRules || {})
        };
        if (Array.isArray(currentScoring.groupQualificationRules) && currentScoring.groupQualificationRules.length) {
          lockUpdates.scoringRules = {
            ...currentScoring,
            groupQualificationRules: []
          };
        }
      } else if (hasKnockoutPhase === false) {
        const currentScoring = {
          ...(currentSettingsForRules?.scoringRules || {}),
          ...(lockUpdates.scoringRules || {})
        };
        if (Array.isArray(currentScoring.groupQualificationRules)) {
          const filtered = currentScoring.groupQualificationRules.map(rule => ({
            ...rule,
            conditions: Array.isArray(rule.conditions)
              ? rule.conditions.filter(c => c !== 'teamQualified' && c !== 'teamNotQualified')
              : []
          })).filter(rule => Array.isArray(rule.conditions) && rule.conditions.length);
          lockUpdates.scoringRules = {
            ...currentScoring,
            groupQualificationRules: filtered
          };
        }
      }

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
     * 🏆 3A. ZONA DE PREMIAÇÃO + DESEMPATE
     * ============================================================
     */
    if (req.body.prizeZone && typeof req.body.prizeZone === 'object') {
      const current = currentSettingsForRules?.prizeZone || {};
      const incoming = { ...current, ...req.body.prizeZone };

      const positions = Math.max(
        0,
        Math.floor(Number(incoming.positions ?? 0))
      );
      const totalAmount = Math.max(
        0,
        Number(incoming.totalAmount ?? 0)
      );

      let distribution = Array.isArray(incoming.distribution)
        ? incoming.distribution.map(item => ({
            position: Math.floor(Number(item.position)),
            percentage: Number(item.percentage)
          }))
        : [];

      if (positions === 0) {
        distribution = [];
      } else {
        if (distribution.length !== positions) {
          return res.status(400).json({
            success: false,
            message: 'A distribuição da premiação deve ter uma porcentagem para cada posição.'
          });
        }

        const positionsSet = new Set();
        for (const item of distribution) {
          if (
            !Number.isInteger(item.position) ||
            item.position < 1 ||
            item.position > positions ||
            positionsSet.has(item.position) ||
            !Number.isFinite(item.percentage) ||
            item.percentage < 0 ||
            item.percentage > 100
          ) {
            return res.status(400).json({
              success: false,
              message: 'Distribuição da premiação inválida.'
            });
          }
          positionsSet.add(item.position);
        }

        const totalPercentage = distribution.reduce(
          (sum, item) => sum + item.percentage, 0
        );

        if (Math.abs(totalPercentage - 100) > 0.0001) {
          return res.status(400).json({
            success: false,
            message: 'A soma dos percentuais da premiação deve ser 100%.'
          });
        }
      }

      lockUpdates.prizeZone = {
        positions,
        totalAmount,
        distribution
      };
      shouldRecalculate = true;
    }

    if (req.body.rankingRules && typeof req.body.rankingRules === 'object') {
      const requested = Array.isArray(req.body.rankingRules.tieBreakers)
        ? req.body.rankingRules.tieBreakers
        : [];

      if (requested.length > 3) {
        return res.status(400).json({
          success: false,
          message: 'São permitidos no máximo 3 critérios de desempate.'
        });
      }

      const allowed = [
        'exactScorePoints',
        'podiumPoints',
        'extraPoints',
        'knockoutPoints'
      ];

      const currentChampionship =
        lockUpdates.championshipRules ||
        currentSettingsForRules?.championshipRules ||
        {};

      const scoring =
        lockUpdates.scoringRules ||
        currentSettingsForRules?.scoringRules ||
        {};

      const available = new Set([
        ...(Number(scoring.exactScore || 0) > 0 ? ['exactScorePoints'] : []),
        ...(Array.isArray(scoring.podiumPoints) &&
          scoring.podiumPoints.some(v => Number(v) > 0)
          ? ['podiumPoints']
          : []),
        ...(
          ['topScorer', 'bestAttack', 'worstDefense', 'upset']
            .some(key => Number(scoring[key] || 0) > 0)
            ? ['extraPoints']
            : []
        ),
        ...(currentChampionship.hasKnockoutPhase === true
          ? ['knockoutPoints']
          : [])
      ]);

      const unique = [];
      for (const value of requested) {
        if (!allowed.includes(value) || !available.has(value)) {
          return res.status(400).json({
            success: false,
            message: `Critério de desempate indisponível: ${value}`
          });
        }
        if (unique.includes(value)) {
          return res.status(400).json({
            success: false,
            message: 'Os critérios de desempate não podem se repetir.'
          });
        }
        unique.push(value);
      }

      lockUpdates.rankingRules = {
        tieBreakers: unique
      };
      shouldRecalculate = true;
    }
    /*
     * Se o ADM desativar a fase mata-mata, o critério
     * knockoutPoints deixa de ser válido. A limpeza é feita
     * mesmo quando rankingRules não veio no payload.
     */
    if (lockUpdates.championshipRules?.hasKnockoutPhase === false) {
      const currentMatchRules = Array.isArray(
        currentSettingsForRules?.scoringRules?.matchRules
      )
        ? currentSettingsForRules.scoringRules.matchRules
        : [];

      if (currentMatchRules.length > 0) {
        lockUpdates.scoringRules = {
          ...(currentSettingsForRules?.scoringRules || {}),
          ...(lockUpdates.scoringRules || {}),
          matchRules: currentMatchRules.map(rule => ({
            ...rule,
            conditions: Array.isArray(rule.conditions)
              ? rule.conditions.filter(condition => condition !== 'qualifier')
              : []
          })).filter(rule => Array.isArray(rule.conditions) && rule.conditions.length > 0)
        };
        shouldRecalculate = true;
      }

      const currentTieBreakers = Array.isArray(
        currentSettingsForRules?.rankingRules?.tieBreakers
      )
        ? currentSettingsForRules.rankingRules.tieBreakers
        : [];

      const requestedTieBreakers = Array.isArray(
        lockUpdates.rankingRules?.tieBreakers
      )
        ? lockUpdates.rankingRules.tieBreakers
        : currentTieBreakers;

      lockUpdates.rankingRules = {
        ...(currentSettingsForRules?.rankingRules || {}),
        ...(lockUpdates.rankingRules || {}),
        tieBreakers: requestedTieBreakers.filter(
          value => value !== 'knockoutPoints'
        )
      };
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
              'Erro desconhecido',
            name: recalculateError.name || 'Error',
            code: recalculateError.code || null
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
