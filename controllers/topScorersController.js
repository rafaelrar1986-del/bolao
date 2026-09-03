'use strict';

const Match = require('../models/Match');
const { buildTopScorers, filterMatchesForTopScorers } = require('../services/topScorersService');
const { toLeagueId } = require('../utils/leagueId');

/**
 * GET /api/matches/top-scorers?leagueId=<id>&mode=official|live
 *
 * Fonte única: Match.goalsDetail. Não consulta palpites e não usa o
 * artilheiro escolhido pelos participantes.
 */
async function getTopScorers(req, res) {
  try {
    const leagueId = req.query.leagueId;
    if (leagueId === undefined || leagueId === null || String(leagueId).trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'leagueId é obrigatório'
      });
    }

    const mode = String(req.query.mode || 'official').trim().toLowerCase();
    if (mode !== 'official' && mode !== 'live') {
      return res.status(400).json({
        success: false,
        message: 'mode deve ser official ou live'
      });
    }

    const normalizedLeagueId = toLeagueId(leagueId);
    const allMatches = await Match.find({ leagueId: normalizedLeagueId })
      .select('matchId teamA teamB logoA logoB goalsDetail status')
      .lean();

    // Oficial: somente partidas encerradas.
    // Live/Parcial: partidas já iniciadas (inclusive encerradas),
    // excluindo agendadas, adiadas e canceladas.
    const matches = filterMatchesForTopScorers(allMatches, mode);

    const result = buildTopScorers(matches);

    return res.json({
      success: true,
      leagueId: normalizedLeagueId,
      mode,
      data: result.data,
      meta: result.meta
    });
  } catch (error) {
    console.error('❌ [TOP-SCORERS] Erro:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao calcular a artilharia'
    });
  }
}

module.exports = { getTopScorers };
