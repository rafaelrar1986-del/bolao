'use strict';
const matchStatsService = require('../services/matchStatsService');

// Fase 2 da refatoração de matches.js.
// Consultas normais extraídas sem alteração de regra de negócio.

const Settings = require('../models/Settings');
const championshipRulesService = require('../services/championshipRulesService');
const Match = require('../models/Match');
const League = require('../models/League');
const {
  getMatchTimestamp,
  compareMatchesChronologically,
  toLeagueId
} = require('../services/matchValidationService');
const { parsePositiveInteger } = require('../utils/validation');
const { requireLeagueId } = require('../utils/leagueId');

async function getLeagues(req, res) {
  try {
    // O cadastro de League permite que campeonatos sem partidas ainda sejam
    // selecionáveis. Mantemos os dados antigos de Match como fallback para
    // não exigir migração dos campeonatos já existentes.
    const [registered, groupedMatches] = await Promise.all([
      League.find({ status: { $ne: 'archived' } }).sort({ name: 1 }).lean(),
      Match.aggregate([
        { $match: { leagueId: { $ne: null } } },
        {
          $group: {
            _id: '$leagueId',
            name: { $first: '$leagueName' },
            totalMatches: { $sum: 1 },
            scheduledCount: { $sum: { $cond: [{ $eq: ['$status', 'scheduled'] }, 1, 0] } },
            allMatches: {
              $push: {
                date: '$date', time: '$time', teamA: '$teamA', teamB: '$teamB', status: '$status'
              }
            }
          }
        }
      ])
    ]);

    const byId = new Map();
    registered.forEach(l => byId.set(String(l.leagueId), {
      id: String(l.leagueId),
      name: l.name || `Liga ${l.leagueId}`,
      source: l.source || 'manual',
      apiLeagueId: Number.isFinite(Number(l.apiLeagueId)) ? Number(l.apiLeagueId) : null,
      apiLeagueName: l.apiLeagueName || '',
      count: 0,
      totalMatches: 0,
      nextMatchDate: null,
      nextMatchTeams: null
    }));

    groupedMatches.forEach(l => {
      const id = String(l._id);
      const item = byId.get(id) || {
        id,
        name: l.name || `Liga ${id}`,
        source: 'api',
        apiLeagueId: Number.isFinite(Number(id)) ? Number(id) : null,
        apiLeagueName: l.name || '',
        count: 0,
        totalMatches: 0,
        nextMatchDate: null,
        nextMatchTeams: null,
        legacy: true
      };
      item.name = item.name || l.name || `Liga ${id}`;
      item.count = Number(l.scheduledCount || 0);
      item.totalMatches = Number(l.totalMatches || 0);

      const scheduled = (l.allMatches || [])
        .filter(m => m.status === 'scheduled')
        .sort((a, b) => {
          const ta = getMatchTimestamp(a.date, a.time);
          const tb = getMatchTimestamp(b.date, b.time);
          if (!ta || !tb) return 0;
          return ta - tb;
        });
      const next = scheduled[0];
      if (next) {
        const [day, month, year] = String(next.date || '').split('/');
        const [hour, minute] = String(next.time || '').split(':');
        if (day && month && year && hour != null && minute != null) {
          item.nextMatchDate = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
        }
        item.nextMatchTeams = `${next.teamA} x ${next.teamB}`;
      }
      byId.set(id, item);
    });

    const data = [...byId.values()]
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));

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

    // Expõe o formato efetivo por etapa para o frontend, sem gravar
    // configuração redundante em cada partida.
    const settings = await Settings.findById(normalizedLeagueId).lean();
    const championshipRules = settings?.championshipRules || {};
    const { getEffectiveKnockoutFormat, getEffectiveKnockoutLegCount } =
      require('../utils/knockoutFormat');

    const enrichedMatches = matches.map(match => {
      if (String(match.phase || '').toLowerCase() !== 'knockout') return match;
      return {
        ...match,
        stageFormat: getEffectiveKnockoutFormat(championshipRules, match),
        stageLegCount: getEffectiveKnockoutLegCount(championshipRules, match)
      };
    });

    res.json({ success: true, data: enrichedMatches });
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

    const settings = await Settings.findById(leagueId).lean();

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Configurações não encontradas para esta liga'
      });
    }

    return res.json({
      success: true,
      data: {
        status: settings.status,
        scoringRules: settings.scoringRules || {},
            betLockMode: settings.betLockMode || 'grade',
        championshipRules: settings.championshipRules || {},
        prizeZone: settings.prizeZone || {
          positions: 0,
          totalAmount: 0,
          distribution: []
        },
        rankingRules: settings.rankingRules || { tieBreakers: [] },
        podium: settings.podium || [],
        championshipResults:
          settings.status === 'finished'
            ? (settings.championshipResults || {})
            : null
      }
    });
  } catch (err) {
    console.error('Erro ao buscar regras da liga:', err);

    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar regras da liga'
    });
  }
}

async function getStats(req, res) {
  return matchStatsService.getStats({ req, res });
}

module.exports = { getLeagues,
  getMatches,
  getMatchTechnical, getRules, getStats };;;
