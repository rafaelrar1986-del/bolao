const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const {
  calculateBetTotal
} = require('../services/pointsService');


const { toLeagueId } = require('../utils/leagueId');

async function getLeaderboard(req, res) {
  try {
    const { leagueId, type } = req.query;
    if (!leagueId) return res.status(400).json({ success: false, message: 'leagueId é obrigatório' });

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);
    const isPartialRequest = type === 'partial';

    const [matches, bets, settings] = await Promise.all([
      Match.find({ leagueId: toLeagueId(leagueId) }).select('matchId status scoreA scoreB regularTimeScoreA regularTimeScoreB phase qualifiedSide').lean(),
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
    knockoutPoints: computed.knockoutPoints,
    podiumPoints: computed.podiumPoints,

    // Extras individuais
    topScorerPoints: Number(extrasBreakdown.topScorer || 0),
    bestAttackPoints: Number(extrasBreakdown.bestAttack || 0),
    worstDefensePoints: Number(extrasBreakdown.worstDefense || 0),
    upsetPoints: Number(extrasBreakdown.upset || 0),

    // Mantém o total agregado das extras
    extrasPoints: computed.extrasPoints,

    bonusPoints: computed.bonusPoints,
    lastUpdate: computed.lastUpdate
  };
});

    ranked.sort((a, b) => b.totalPoints - a.totalPoints || (a.user?.name || "").localeCompare(b.user?.name || ""));

    let lastPoints = null;
    let position = 0;
    const finalData = ranked.map((item, index) => {
      if (lastPoints === null || item.totalPoints !== lastPoints) {
        position = index + 1;
        lastPoints = item.totalPoints;
      }
      return { ...item, position };
    });

    res.json({ success: true, data: finalData, leagueId: lIdNum });
  } catch (e) {
    console.error('Leaderboard Error:', e);
    res.status(500).json({ success: false, message: 'Erro ao processar ranking' });
  }
}

module.exports = {
  getLeaderboard
};
