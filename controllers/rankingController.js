const Match = require('../models/Match');
const User = require('../models/User');
const Bet = require('../models/Bet');

function winnerFromScores(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

const getRanking = async (req, res) => {
  const isPartial = req.query.type === 'partial';

  try {
    const matches = await Match.find().lean();
    const matchMap = new Map(matches.map(m => [m.matchId, m]));
    
    const users = await User.find().lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const bets = await Bet.find({ hasSubmitted: true }).lean();

    const unsortedRanking = bets.map(bet => {
      let totalPoints = 0;
      let groupPhasePoints = 0;
      let knockoutPoints = 0;

      // Unificando as partidas para processar tudo (Grupos e Mata-mata)
      const allUserMatches = [
        ...(bet.groupMatches || []),
        ...(bet.knockoutMatches || [])
      ];

      for (const gm of allUserMatches) {
        const m = matchMap.get(gm.matchId);
        if (!m) continue;

        // A MUDANÇA ESTÁ AQUI: 
        // Se for parcial, aceita qualquer coisa que já começou (in_progress, live, finished, etc)
        const canCount = isPartial 
          ? m.status !== 'scheduled' 
          : m.status === 'finished';

        if (!canCount) continue;

        // Lógica idêntica ao seu pointsService
        const real = winnerFromScores(Number(m.scoreA), Number(m.scoreB));
        
        // 1. Ponto por acertar Resultado (Vencedor/Empate)
        if (real && gm.winner && real === gm.winner) {
          totalPoints += 1;
          if (m.phase === 'group') groupPhasePoints += 1;
          else knockoutPoints += 1;
        }

        // 2. Ponto por acertar Classificado (Mata-Mata)
        const realQualifier = m.qualifiedSide || real;
        if (gm.qualifier && (gm.qualifier === 'A' || gm.qualifier === 'B')) {
          if (realQualifier && realQualifier !== 'draw' && gm.qualifier === realQualifier) {
            totalPoints += 1;
            knockoutPoints += 1;
          }
        }
      }

      // Soma Pódio e Bônus (que já costumam estar calculados no doc da Bet)
      const podiumPoints = bet.podiumPoints || 0;
      const bonusPoints = bet.bonusPoints || 0;
      const finalPoints = totalPoints + podiumPoints + bonusPoints;

      const user = userMap.get(bet.userId.toString());

      return {
        name: user ? user.name : "Usuário Excluído",
        avatar: user ? user.avatar : "default.png",
        points: finalPoints,
        // Mantemos os detalhes para o ranking-mobile-card mostrar certinho
        groupPhasePoints: groupPhasePoints,
        knockoutPoints: knockoutPoints,
        podiumPoints: podiumPoints
      };
    });

    // Ordenação e Posição (Igual ao anterior)
    unsortedRanking.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    let finalRanking = [];
    let currentPos = 0;
    let lastPts = -1;

    unsortedRanking.forEach((user, index) => {
      if (user.points !== lastPts) {
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
    console.error("Erro ao gerar ranking:", error);
    res.status(500).json({ error: "Erro interno." });
  }
};

module.exports = { getRanking };
