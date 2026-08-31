const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const {
  calculateBetTotal
} = require('../services/pointsService');


const { toLeagueId } = require('../utils/leagueId');
const {
  normalizeTieBreakers,
  getTieBreakerMetrics,
  compareBySportsRanking,
  assignSportsPositions,
  calculatePrizeAllocation
} = require('../services/rankingService');

async function getLeaderboard(req, res) {
  try {
    const { leagueId, type } = req.query;
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);
    const isPartialRequest = type === 'partial';

    const [matches, bets, settings] = await Promise.all([
      Match.find({ leagueId: toLeagueId(leagueId) }).select('matchId status scoreA scoreB regularTimeScoreA regularTimeScoreB phase qualifiedSide group teamA teamB').lean(),
      Bet.find({ hasSubmitted: true, leagueId: lIdStr }).populate('user', 'name avatar').lean(),
      Settings.findById(toLeagueId(leagueId)).lean()
    ]);

    const matchMap = new Map(matches.map(m => [String(m.matchId), m]));

    const ranked = bets.map((b) => {
  const computed = calculateBetTotal(b, matchMap, settings, isPartialRequest);

  // Pontuações extras individuais.
  // Preferimos o breakdown calculado, mas usamos o breakdown
  // persistido da aposta como fallback.
  const extrasBreakdown =
    computed.extrasBreakdown ||
    b.extrasBreakdown ||
    {};

  return {
    user: b.user,
    totalPoints: computed.totalPoints,
    groupPhasePoints: computed.groupPhasePoints,
      groupMatchPoints: computed.groupMatchPoints,
      groupQualificationPoints: computed.groupQualificationPoints,
      groupQualificationBreakdown: computed.groupQualificationBreakdown || [],
      podiumBreakdown: computed.podiumBreakdown || [],
    exactScorePoints: Number(computed.exactScorePoints || 0),
    knockoutPoints: computed.knockoutPoints,
      knockoutMatchPoints: computed.knockoutMatchPoints,
      knockoutQualifierPoints: computed.knockoutQualifierPoints,
    podiumPoints: computed.podiumPoints,

    // Extras individuais
    topScorerPoints: Number(extrasBreakdown.topScorer || 0),
    bestAttackPoints: Number(extrasBreakdown.bestAttack || 0),
    worstDefensePoints: Number(extrasBreakdown.worstDefense || 0),
    upsetPoints: Number(extrasBreakdown.upset || 0),

    // Mantém o total agregado das extras
    extrasPoints: computed.extrasPoints,

    bonusPoints: computed.bonusPoints,
    lastUpdate: computed.lastUpdate,
    __bet: b
  };
});

    const tieBreakers = normalizeTieBreakers(
      settings?.rankingRules?.tieBreakers,
      settings
    );

    ranked.forEach(item => {
      item.tieBreakerMetrics = getTieBreakerMetrics(item.__bet, item);
      item.__rankingTieKey = JSON.stringify(
        tieBreakers.map(key => Number(item.tieBreakerMetrics[key] || 0))
      );
      delete item.__bet;
    });

    ranked.sort((a, b) => {
      const result = compareBySportsRanking(a, b, tieBreakers);
      if (result !== 0) return result;
      return String(a.user?.name || '').localeCompare(
        String(b.user?.name || ''),
        'pt-BR'
      );
    });

    const finalData = calculatePrizeAllocation(
      assignSportsPositions(ranked),
      settings?.prizeZone
    ).map(item => {
      const { tieBreakerMetrics, __rankingTieKey, ...publicItem } = item;
      return publicItem;
    });

    res.json({
      success: true,
      data: finalData,
      leagueId: lIdNum,
      rankingRules: { tieBreakers },
      prizeZone: settings?.prizeZone || {
        positions: 0,
        totalAmount: 0,
        distribution: []
      }
    });
  } catch (e) {
    console.error('Leaderboard Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao processar ranking' });
  }
}

module.exports = {
  getLeaderboard
};
