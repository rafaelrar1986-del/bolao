const Bet = require('../models/Bet');
const Match = require('../models/Match');
const User = require('../models/User');
const Settings = require('../models/Settings');

const {
  getBetLockMode,
  getBetLockState
} = require('../services/betLockService');

const {
  isValidMatchIdValue
} = require('../services/betValidationService');

const {
  getVisibilityLockState,
  getVisibleBetData
} = require('../services/betVisibilityService');

const {
  DEFAULT_SCORING,
  calculateExtrasPoints,
  calculateBetTotal
} = require('../services/pointsService');


const { toLeagueId } = require('../utils/leagueId');

function toWinnerLabel(choice, teamA, teamB) {
  if (choice === 'A') return teamA || 'Time A';
  if (choice === 'B') return teamB || 'Time B';
  if (choice === 'draw') return 'Empate';
  return '-';
}

async function getAllBets(req, res) {
  try {
    const { leagueId } = req.query;

    if (!leagueId) {
      return res.status(400).json({
        success: false,
        message: 'leagueId é obrigatório'
      });
    }

    const {
      search,
      matchId,
      group
    } = req.query;

    const isAdmin = req.user?.isAdmin === true;

    const configId = toLeagueId(leagueId);

    // ============================================================
    // CONFIGURAÇÕES DA LIGA
    // ============================================================
    const settings =
      await Settings.findById(configId).lean();

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Configurações da liga não encontradas'
      });
    }

    const unlockedPhases =
      settings.unlockedPhases || [];

    const betLockMode =
      getBetLockMode(settings);

    // ============================================================
    // FILTRO DE PARTIDAS
    // ============================================================
    let matchFilter = {};

    if (leagueId) {
      matchFilter.leagueId =
        toLeagueId(leagueId);
    }

    if (group) {
      matchFilter.$or = [
        {
          group: {
            $regex: group,
            $options: 'i'
          }
        },
        {
          phaseName: {
            $regex: group,
            $options: 'i'
          }
        }
      ];
    }

    if (matchId) {
      if (!isValidMatchIdValue(matchId)) {
        return res.status(400).json({
          success: false,
          message: 'matchId inválido. O identificador da partida deve ser um inteiro positivo.'
        });
      }

      matchFilter.matchId = Number(matchId);
    }

    const matches =
      await Match.find(matchFilter).lean();

    const matchIdsFilter =
      matches.map(m => m.matchId);

    if (matchIdsFilter.length === 0) {
      return res.json({
        success: true,
        data: []
      });
    }

    // ============================================================
    // FILTRO DE USUÁRIOS / APOSTAS
    // ============================================================
    const query = {
      hasSubmitted: true
    };

    if (search) {
      const users =
        await User.find({
          name: {
            $regex: search,
            $options: 'i'
          }
        })
        .select('_id')
        .lean();

      query.user = {
        $in: users.map(u => u._id)
      };
    }

    if (leagueId) {
      query.$or = [
        {
          leagueId:
            String(leagueId)
        },
        {
          leagueId:
            Number(leagueId)
        }
      ];
    }

    query['groupMatches.matchId'] = {
      $in: matchIdsFilter
    };

    const bets =
      await Bet.find(query)
        .populate('user', 'name')
        .lean();

    // ============================================================
    // MAPA DAS PARTIDAS
    // ============================================================
    const matchMap =
      new Map(
        matches.map(m => [
          String(m.matchId),
          m
        ])
      );

    // ============================================================
    // ENRIQUECIMENTO
    // ============================================================
    const enriched = bets.map(b => {

      // ----------------------------------------------------------
      // PARTIDAS DO USUÁRIO DENTRO DO FILTRO
      // ----------------------------------------------------------
      const gm =
        (b.groupMatches || [])
          .filter(x =>
            matchIdsFilter.includes(
              x.matchId
            )
          );

      const viewBets =
        gm.map(g => {

          const m =
            matchMap.get(
              String(g.matchId)
            );

          const visibilityState =
            getVisibilityLockState(
              m,
              settings,
              isAdmin,
              getBetLockState
            );

          const isLocked =
            visibilityState.locked;

          const visibleBetData =
            getVisibleBetData(
              g,
              m,
              visibilityState
            );

          return {
            ...visibleBetData,

            choiceLabel:
              isLocked
                ? 'Bloqueado'
                : toWinnerLabel(
                    g.winner,
                    m?.teamA,
                    m?.teamB
                  ),

            matchName:
              m
                ? `${m.teamA} vs ${m.teamB}`
                : `Jogo ${g.matchId}`,

            status:
              m?.status ||
              'scheduled',

          };
        });

      // ----------------------------------------------------------
      // VISIBILIDADE DO PÓDIO E EXTRAS
      // ----------------------------------------------------------
      const isPodiumLocked =
        !isAdmin &&
        !unlockedPhases.includes(
          'podium'
        );

      const finalPodium =
        (
          b.podium &&
          b.podium.length > 0 &&
          !isPodiumLocked
        )
          ? b.podium
          : (
              b.podium &&
              b.podium.length > 0
                ? Array(
                    b.podium.length
                  ).fill('🔒')
                : null
            );

      const finalExtras =
        (
          b.extras &&
          !isPodiumLocked
        )
          ? b.extras
          : null;

      // ----------------------------------------------------------
      // RECÁLCULO OFICIAL DOS PONTOS
      // ----------------------------------------------------------
      //
      // Usa exatamente as regras/resultados atuais da liga.
      // Isso evita depender de totalPoints antigo gravado no Bet.
      //
      const computed =
        calculateBetTotal(
          b,
          matchMap,
          settings,
          false
        );

      // ----------------------------------------------------------
      // EXTRAS BREAKDOWN
      // ----------------------------------------------------------
      //
      // O calculateBetTotal() calcula extrasPoints oficialmente.
      // Aqui também geramos o breakdown para o frontend.
      //
      let finalExtrasBreakdown = null;

      if (!isPodiumLocked && b.extras) {

        const rules = {
          ...DEFAULT_SCORING,
          ...(settings?.scoringRules || {})
        };

        const champResults =
          settings?.championshipResults || {};

        const extrasCalc =
          calculateExtrasPoints(
            b.extras,
            champResults,
            rules
          );

        finalExtrasBreakdown =
          extrasCalc.breakdown;
      }

      // ----------------------------------------------------------
      // RETORNO DO USUÁRIO
      // ----------------------------------------------------------
      return {
        userName:
          b.user?.name ||
          'Usuário',

        // PONTUAÇÃO ATUALIZADA
        totalPoints:
          computed.totalPoints,

        groupPhasePoints:
          computed.groupPhasePoints,

        knockoutPoints:
          computed.knockoutPoints,

        podiumPoints:
          computed.podiumPoints,

        extrasPoints:
          computed.extrasPoints,

        bonusPoints:
          computed.bonusPoints,

        bets:
          viewBets,

        groupPredictions:
          b.groupPredictions || [],


        podium:
          finalPodium,

        extras:
          finalExtras,

        extrasBreakdown:
          finalExtrasBreakdown,

        lastUpdate:
          computed.lastUpdate
      };
    });

    // ============================================================
    // RESPOSTA
    // ============================================================
    return res.json({
      success: true,
      data: enriched
    });

  } catch (e) {

    console.error(
      'All-bets error:',
      e
    );

    return res.status(500).json({
      success: false,
      message:
        'Erro ao carregar apostas'
    });
  }
}

module.exports = {
  getAllBets
};
