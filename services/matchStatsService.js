// Statistics service for match statistics.
// Phase 16C-A: extracted from routes/matches.js without changing the API contract.

const Match = require('../models/Match');
const Settings = require('../models/Settings');
const pointsService = require('./pointsService');
const { requireLeagueId } = require('../utils/leagueId');

async function getStats(ctx) {

  try {
    const { leagueId } = ctx.req.query;

    const normalizedLeagueId = requireLeagueId(leagueId);

    if (!normalizedLeagueId) {
      return ctx.res.status(400).json({
        success: false,
        message: 'leagueId é obrigatório'
      });
    }
    const filtro = {
      status: 'finished',
      leagueId: normalizedLeagueId
    };

    // Busca as regras da liga
    const settings = await Settings.findById(normalizedLeagueId).lean();

    // O máximo teórico é calculado exclusivamente pelo pointsService,
    // evitando duplicação da regra de pontuação neste endpoint.
    const scoringRules =
      settings?.scoringRules || {};

    const championshipRules =
      settings?.championshipRules || {};

    const groupPointsPerMatch =
      pointsService.getMaxPointsPerMatch(
        scoringRules,
        championshipRules,
        'group'
      );

    const knockoutPointsPerMatch =
      pointsService.getMaxPointsPerMatch(
        scoringRules,
        championshipRules,
        'knockout'
      );

    const groupFinished = await Match.countDocuments({
      ...filtro,
      phase: 'group'
    });

    const knockoutFinished = await Match.countDocuments({
      ...filtro,
      phase: 'knockout'
    });

    // Mantém a informação separada de pontos corridos
    const pontosCorridosFinished = await Match.countDocuments({
      ...filtro,
      phase: 'pontos_corridos'
    });

    ctx.res.json({
      success: true,
      data: {
        group: {
          finished: groupFinished,
          pointsPerMatch: groupPointsPerMatch
        },
        knockout: {
          finished: knockoutFinished,
          pointsPerMatch: knockoutPointsPerMatch
        },
        pontos_corridos: {
          finished: pontosCorridosFinished,
          pointsPerMatch: groupPointsPerMatch
        }
      }
    });

  } catch (err) {
    console.error('Match Stats Error:', err);

    ctx.res.status(500).json({
      success: false,
      message: 'Erro ao buscar estatísticas'
    });
  }

}

module.exports = { getStats };
