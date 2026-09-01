const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');
const User = require('../models/User');
const Settings = require('../models/Settings');


const { toLeagueId } = require('../utils/leagueId');

async function resetAllBets(req, res) {
  try {
    const { leagueId } = req.body;
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'Informe o leagueId para resetar' });
    }

    const lidStr = toLeagueId(leagueId);

    const deleteBets = await Bet.deleteMany({ leagueId: lidStr });
    const deleteHistory = await PointsHistory.deleteMany({ leagueId: lidStr });

    // Ao apagar todas as apostas da liga, o campeonato volta ao estado
    // anterior ao início da primeira partida, permitindo ao ADM alterar
    // novamente as regras do campeonato.
    const resetChampionshipStart = await Settings.updateOne(
      { _id: lidStr },
      { $set: { firstMatchStartedAt: null } }
    );

    const userUpdate = await User.updateMany(
      { leagues: lidStr },
      { $pull: { leagues: lidStr } }
    );

    console.log(`[Reset Liga ${leagueId}] Apostas: ${deleteBets.deletedCount} | Histórico: ${deleteHistory.deletedCount}`);

    res.json({
      success: true,
      message: `Reset concluído com sucesso!`,
      details: {
        betsRemoved: deleteBets.deletedCount,
        historyRecordsRemoved: deleteHistory.deletedCount,
        championshipStartReset: resetChampionshipStart.modifiedCount > 0,
        usersUnlinked: userUpdate.modifiedCount
      }
    });

  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ success: false, message: 'Erro interno ao realizar reset total da liga' });
  }
}

module.exports = {
  resetAllBets
};
