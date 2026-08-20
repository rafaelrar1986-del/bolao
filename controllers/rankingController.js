const Match = require('../models/Match');
const User = require('../models/User');
const Bet = require('../models/Bet');
const Settings = require('../models/Settings');
const PointsService = require('../services/pointsService');

function winnerFromScores(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

const getRanking = async (req, res) => {
  const isPartial = req.query.type === 'partial';

  try {
    const [matches, users, bets] = await Promise.all([
      Match.find().lean(),
      User.find().lean(),
      Bet.find({ hasSubmitted: true }).lean()
    ]);

    const matchMap = new Map(
      matches.map(m => [String(m.matchId), m])
    );

    const userMap = new Map(
      users.map(u => [u._id.toString(), u])
    );

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

    const unsortedRanking = bets.map(bet => {
      const leagueId = String(bet.leagueId || '').trim();
      const settings = settingsByLeague.get(leagueId) || {};

      const computed = PointsService.calculateBetTotal(
        bet,
        matchMap,
        settings,
        isPartial
      );

      const userId = bet.user?.toString?.() || bet.user?._id?.toString?.();
      const user = userMap.get(userId);

      return {
        name: user ? user.name : 'Usuário Excluído',
        avatar: user ? user.avatar : 'default.png',
        points: computed.totalPoints,
        groupPhasePoints: computed.groupPhasePoints,
        knockoutPoints: computed.knockoutPoints,
        podiumPoints: computed.podiumPoints,
        extrasPoints: computed.extrasPoints,
        bonusPoints: computed.bonusPoints
      };
    });

    unsortedRanking.sort(
      (a, b) =>
        b.points - a.points ||
        a.name.localeCompare(b.name)
    );

    const finalRanking = [];
    let currentPos = 0;
    let lastPts = null;

    unsortedRanking.forEach((user, index) => {
      if (lastPts === null || user.points !== lastPts) {
        currentPos = index + 1;
      }

      finalRanking.push({
        position: currentPos,
        ...user
      });

      lastPts = user.points;
    });

    res.json(finalRanking);
  } catch (error) {
    console.error('Erro ao gerar ranking:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
};

module.exports = { getRanking };
