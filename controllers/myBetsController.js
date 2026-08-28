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

    // A consulta principal deve ser SOMENTE o documento de apostas.
    // Dados auxiliares (partidas/regras) não podem impedir a abertura do My Bets.
    const bet = await Bet.findOne({
      user: req.user._id,
      leagueId: lIdStr
    }).lean();

    if (!bet) {
      return res.json({ success: true, data: null, hasSubmitted: false });
    }

    /*
     * Não enriquecemos os palpites aqui com Match/Settings.
     * O frontend trata esses dados separadamente.
     *
     * Isso é intencional: /my-bets é a fonte primária da tela e deve
     * responder mesmo se a coleção de partidas ou configurações estiver
     * indisponível/lenta.
     */
    return res.json({
      success: true,
      data: {
        ...bet,
        groupMatches: bet.groupMatches || [],
        groupPredictions: bet.groupPredictions || [],
        podium: bet.podium || [],
        extras: bet.extras || {}
      },
      hasSubmitted: Boolean(
        (bet.groupMatches && bet.groupMatches.length) ||
        (bet.groupPredictions && bet.groupPredictions.length) ||
        (bet.podium && bet.podium.length) ||
        (bet.extras && Object.keys(bet.extras).length)
      )
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
