const Bet = require('../models/Bet');
const Match = require('../models/Match');
const Settings = require('../models/Settings');


const { toLeagueId } = require('../utils/leagueId');

function toWinnerLabel(choice, teamA, teamB) {
  if (choice === 'A') return teamA || 'Time A';
  if (choice === 'B') return teamB || 'Time B';
  if (choice === 'draw') return 'Empate';
  return '-';
}

async function getMyBets(req, res) {
  try {
    const { leagueId } = req.query;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'ID da liga é obrigatório' });
    }

    const lIdNum = Number(leagueId);
    const lIdStr = String(leagueId);

    const [bet, matches, settings] = await Promise.all([
      Bet.findOne({ user: req.user._id, leagueId: lIdStr }).lean(),
      Match.find({ leagueId: toLeagueId(leagueId) }).lean(),
      Settings.findById(toLeagueId(leagueId)).lean()
    ]);

    if (!bet) {
      return res.json({ success: true, data: null, hasSubmitted: false });
    }

    const matchIdsDaLiga = new Set(matches.map(m => Number(m.matchId)));

    const gm = (bet.groupMatches || [])
      .filter(b => matchIdsDaLiga.has(Number(b.matchId)))
      .map((b) => {
        const m = matches.find(x => Number(x.matchId) === Number(b.matchId));
        const teamA = m?.teamA || 'Time A';
        const teamB = m?.teamB || 'Time B';
        return {
          ...b,
          matchName: m ? `${m.teamA} vs ${m.teamB}` : `Jogo ${b.matchId}`,
          teamA,
          teamB,
          status: m?.status || 'scheduled',
          choiceLabel: toWinnerLabel(b.winner, teamA, teamB)
        };
      });

    const podiumSize = settings?.championshipRules?.podiumSize ?? 4;

    return res.json({
      success: true,
      data: {
        ...bet,
        groupMatches: gm,
        podium: bet.podium || [],
        extras: bet.extras || {},
        podiumSize
      },
      hasSubmitted: gm.length > 0
    });

  } catch (e) {
    console.error('GET /my-bets error:', e);
    res.status(500).json({ success: false, message: 'Erro ao carregar palpites' });
  }
}

/* ================================================================
   💾 POST /save (Salvar todos os palpites)
   ================================================================ */

module.exports = {
  getMyBets
};
