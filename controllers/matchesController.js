'use strict';
const matchStatsService = require('../services/matchStatsService');

// Fase 2 da refatoração de matches.js.
// Consultas normais extraídas sem alteração de regra de negócio.

const Settings = require('../models/Settings');
const championshipRulesService = require('../services/championshipRulesService');
const Match = require('../models/Match');
const {
  getMatchTimestamp,
  compareMatchesChronologically,
  toLeagueId
} = require('../services/matchValidationService');
const { parsePositiveInteger } = require('../utils/validation');
const { requireLeagueId } = require('../utils/leagueId');

async function getLeagues(req, res) {
  try {
    const leagues = await Match.aggregate([
      { $match: { leagueId: { $ne: null } } },
      {
        $group: {
          _id: "$leagueId",
          name: { $first: "$leagueName" },
          scheduledCount: {
            $sum: { $cond: [{ $eq: ["$status", "scheduled"] }, 1, 0] }
          },
          allMatches: {
            $push: {
              date: "$date",
              time: "$time",
              teamA: "$teamA",
              teamB: "$teamB",
              status: "$status"
            }
          }
        }
      },
      { $sort: { name: 1 } }
    ]);

    const data = leagues.map(l => {
      const scheduledMatches = l.allMatches.filter(m => m.status === 'scheduled');

      // 🆕 CORREÇÃO: Ordenação consistente usando UTC (mesma base de parseMatchDate)
      const sortedMatches = scheduledMatches.sort((a, b) => {
        const tsA = getMatchTimestamp(a.date, a.time);
        const tsB = getMatchTimestamp(b.date, b.time);
        if (!tsA || !tsB) return 0;
        return tsA - tsB;
      });

      const next = sortedMatches[0];
      let isoDate = null;
      if (next) {
        const [day, month, year] = next.date.split('/');
        const [h, min] = next.time.split(':');
        if (day && month && year && h != null && min != null) {
          // 🆕 CORREÇÃO: Retorna ISO local sem 'Z' para evitar shift de timezone no front
          isoDate = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${h.padStart(2, '0')}:${min.padStart(2, '0')}:00`;
        }
      }

      return {
        id: l._id,
        name: l.name || `Liga ${l._id}`,
        count: l.scheduledCount,
        nextMatchDate: isoDate,
        nextMatchTeams: next ? `${next.teamA} x ${next.teamB}` : "Rodada encerrada"
      };
    }).filter(l => l.id !== null);

    res.json({ success: true, data });
  } catch (err) {
    console.error('Erro ao buscar ligas:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar ligas' });
  }
}

async function getMatches(req, res) {
  try {
    const { leagueId } = req.query;

    if (leagueId == null || String(leagueId).trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'leagueId é obrigatório'
      });
    }

    const normalizedLeagueId = toLeagueId(leagueId);
    const filtro = { leagueId: normalizedLeagueId };

    const matches = await Match.find(filtro).lean();
    matches.sort(compareMatchesChronologically);

    res.json({ success: true, data: matches });
  } catch (err) {
    console.error('Erro ao listar partidas:', err);
    res.status(500).json({ success: false, message: 'Erro ao listar partidas' });
  }
}

async function getMatchTechnical(req, res) {
  try {
    const matchId = parsePositiveInteger(req.params.matchId);

    if (matchId === null) {
      return res.status(400).json({
        success: false,
        message: 'matchId deve ser um número inteiro positivo'
      });
    }

    // matchId é globalmente único no schema; não é necessário filtrar por leagueId.
    const match = await Match.findOne({ matchId }).lean();

    if (!match) {
      return res.status(404).json({ success: false, message: 'Partida não encontrada' });
    }

    const timeline = (match.goalsDetail || []).sort((a, b) => {
      const minA = (a.min || 0) + (a.extra || 0);
      const minB = (b.min || 0) + (b.extra || 0);
      return minA - minB;
    });

    const lineupHome = match.lineups?.home || {};
    const lineupAway = match.lineups?.away || {};

    res.json({
      success: true,
      data: {
        matchId: match.matchId,
        status: match.status,
        apiStatus: match.apiStatus,
        currentTime: match.minute || "0",
        score: {
          // Preserva null para partidas não iniciadas
          teamA: match.scoreA,
          teamB: match.scoreB,
          penaltiesA: match.penaltiesA ?? null,
          penaltiesB: match.penaltiesB ?? null,
          qualifiedSide: match.qualifiedSide ?? null,
          regularTimeScoreA: match.regularTimeScoreA ?? null,
          regularTimeScoreB: match.regularTimeScoreB ?? null
        },
        advanced: {
          xg: match.xg || { home: 0, away: 0 },
          odds: match.odds || { home: null, draw: null, away: null },
          aiAnalysis: match.ai_analysis || '',
          videoUrl: match.video_url || ''
        },
        timeline,
        lineups: {
          teamA: {
            formation: lineupHome.formation || "",
            titulares: lineupHome.players || [],
            reservas: lineupHome.substitutes || []
          },
          teamB: {
            formation: lineupAway.formation || "",
            titulares: lineupAway.players || [],
            reservas: lineupAway.substitutes || []
          },
          confirmed: match.lineups?.confirmed || false,
          unavailable: match.unavailable || []
        },
        summary: {
          possession: {
            teamA: match.possession?.home ?? null,
            teamB: match.possession?.away ?? null
          },
          // statistics é Array no schema — retorna array consistentemente
          stats: match.statistics || []
        },
        venue: match.stadium || 'Não informado'
      }
    });
  } catch (e) {
    console.error('Match Technical Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar detalhes técnicos' });
  }
}


async function getRules(req, res) {

  try {
    const leagueId = requireLeagueId(req.params.leagueId);
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });

    const settings = await Settings.findById(leagueId).lean();

    if (!settings) {
      return res.status(404).json({ success: false, message: 'Configurações não encontradas para esta liga' });
    }

    res.json({
      success: true,
      data: {
        status: settings.status,
        scoringRules: settings.scoringRules || {},
        championshipRules: settings.championshipRules || {},
        podium: settings.podium || [],
        championshipResults: settings.status === 'finished'
          ? (settings.championshipResults || {})
          : null
      }
    });
  } catch (err) {
    console.error('Erro ao buscar regras da liga:', err);
    res.status(500).json({ success: false, message: 'Erro ao buscar regras da liga' });
  }

}


async function getStats(req, res) {
  return matchStatsService.getStats({ req, res });
}

module.exports = { getLeagues,
  getMatches,
  getMatchTechnical, getRules, getStats };;
