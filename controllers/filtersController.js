const Match = require('../models/Match');
const User = require('../models/User');


const { toLeagueId } = require('../utils/leagueId');

async function getMatchesForFilter(req, res) {
  try {
    const { leagueId } = req.query;
    let filter = {};
    if (leagueId) filter.leagueId = toLeagueId(leagueId);

    const matches = await Match.find(filter)
      .select('matchId teamA teamB group phase date leagueId')
      .sort('matchId')
      .lean();

    res.json({ success: true, data: matches });
  } catch (e) {
    console.error('Matches filter error:', e);
    res.status(500).json({ success: false, message: 'Erro ao buscar partidas' });
  }
}


async function getUsersForFilter(req, res) {
  try {
    const { leagueId } = req.query;

    if (!leagueId) {
      return res.status(400).json({
        success: false,
        message: 'O parâmetro leagueId é obrigatório para filtrar os usuários.'
      });
    }

    // 🆕 CORREÇÃO: leagues pode ser Number ou String no array do usuário
    const query = {
      $or: [
        { leagues: String(leagueId) },
        { leagues: Number(leagueId) }
      ]
    };

    const users = await User.find(query)
      .select('_id name')
      .sort('name')
      .lean();

    res.json({ success: true, data: users });
  } catch (e) {
    console.error('Erro na rota users-for-filter:', e.message);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários da liga' });
  }
}


module.exports = {
  getMatchesForFilter,
  getUsersForFilter
};
