const Match = require('../models/Match');
const User = require('../models/User');
const Bet = require('../models/Bet');
const Settings = require('../models/Settings');
const PointsService = require('../services/pointsService');
const {
  normalizeTieBreakers,
  getTieBreakerMetrics,
  compareBySportsRanking,
  assignSportsPositions
} = require('../services/rankingService');

/**
 * Ranking legado/parcial.
 *
 * A pontuação e os critérios de desempate precisam ser calculados por liga:
 * cada liga possui suas próprias regras de campeonato, pontuação e ranking.
 * O endpoint historicamente consultava todas as partidas em um único Map por
 * matchId, o que podia misturar partidas de ligas diferentes e ignorava
 * rankingRules.tieBreakers. Agora cada aposta usa o inventário da sua própria
 * liga e o mesmo comparador do leaderboard/Modo Estratégia.
 */
const getRanking = async (req, res) => {
  const isPartial = req.query.type === 'partial';

  try {
    const [matches, users, bets] = await Promise.all([
      Match.find().lean(),
      User.find().lean(),
      Bet.find({ hasSubmitted: true }).lean()
    ]);

    const matchesByLeague = new Map();
    for (const match of matches) {
      const leagueId = String(match.leagueId || '').trim();
      if (!leagueId) continue;
      if (!matchesByLeague.has(leagueId)) matchesByLeague.set(leagueId, new Map());
      matchesByLeague.get(leagueId).set(String(match.matchId), match);
    }

    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const leagueIds = [
      ...new Set(
        bets
          .map(b => String(b.leagueId || '').trim())
          .filter(Boolean)
      )
    ];

    const settingsEntries = await Promise.all(
      leagueIds.map(async leagueId => [
        leagueId,
        await Settings.findById(leagueId).lean()
      ])
    );
    const settingsByLeague = new Map(settingsEntries);

    const rowsByLeague = new Map();

    for (const bet of bets) {
      const leagueId = String(bet.leagueId || '').trim();
      const settings = settingsByLeague.get(leagueId) || {};
      const matchMap = matchesByLeague.get(leagueId) || new Map();
      const computed = PointsService.calculateBetTotal(bet, matchMap, settings, isPartial);
      const userId = bet.user?.toString?.() || bet.user?._id?.toString?.();
      const user = userMap.get(userId);

      const item = {
        userId,
        leagueId,
        name: user ? user.name : 'Usuário Excluído',
        avatar: user ? user.avatar : 'default.png',
        points: computed.totalPoints,
        totalPoints: computed.totalPoints,
        groupPhasePoints: computed.groupPhasePoints,
        groupMatchPoints: computed.groupMatchPoints,
        groupQualificationPoints: computed.groupQualificationPoints,
        knockoutPoints: computed.knockoutPoints,
        knockoutMatchPoints: computed.knockoutMatchPoints,
        knockoutQualifierPoints: computed.knockoutQualifierPoints,
        podiumPoints: computed.podiumPoints,
        extrasPoints: computed.extrasPoints,
        bonusPoints: computed.bonusPoints,
        exactScorePoints: computed.exactScorePoints,
        tieBreakerMetrics: getTieBreakerMetrics(bet, computed)
      };

      if (!rowsByLeague.has(leagueId)) rowsByLeague.set(leagueId, []);
      rowsByLeague.get(leagueId).push(item);
    }

    const finalRanking = [];

    for (const [leagueId, rows] of rowsByLeague.entries()) {
      const settings = settingsByLeague.get(leagueId) || {};
      const tieBreakers = normalizeTieBreakers(
        settings?.rankingRules?.tieBreakers,
        settings
      );

      rows.sort((a, b) =>
        compareBySportsRanking(a, b, tieBreakers) ||
        a.name.localeCompare(b.name)
      );

      const ranked = assignSportsPositions(rows.map(item => ({
        ...item,
        __rankingTieKey: tieBreakers
          .map(key => Number(item.tieBreakerMetrics?.[key] || 0))
          .join('|')
      })));

      for (const item of ranked) {
        delete item.userId;
        delete item.leagueId;
        delete item.totalPoints;
        delete item.tieBreakerMetrics;
        delete item.__rankingTieKey;
        finalRanking.push(item);
      }
    }

    // Mantém a saída estável quando o endpoint retorna mais de uma liga.
    finalRanking.sort((a, b) =>
      (Number(a.position) || 0) - (Number(b.position) || 0) ||
      a.name.localeCompare(b.name)
    );

    res.json(finalRanking);
  } catch (error) {
    console.error('Erro ao gerar ranking:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
};

module.exports = { getRanking };
