const Match = require('../models/Match');
const User = require('../models/User');
const Bet = require('../models/Bet');

/**
 * Helper idêntico ao seu pointsService para garantir 100% de paridade.
 */
function winnerFromScores(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

const getRanking = async (req, res) => {
  const isPartial = req.query.type === 'partial';

  try {
    // 1. BUSCA DE DADOS
    // Usamos matchId como chave no Map, conforme o seu pointsService
    const matches = await Match.find().lean();
    const matchMap = new Map(matches.map(m => [m.matchId, m]));
    
    const users = await User.find().lean();
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const bets = await Bet.find({ hasSubmitted: true }).lean();

    // 2. CÁLCULO DOS PONTOS (Lógica espelhada do recalculateAllPoints)
    let unsortedRanking = bets.map(bet => {
      let groupPoints = 0;

      for (const gm of bet.groupMatches || []) {
        const m = matchMap.get(gm.matchId);
        if (!m) continue;

        // FILTRO DINÂMICO
        // Oficial: apenas 'finished' | Parcial: tudo que não é 'scheduled'
        const canCount = isPartial 
          ? m.status !== 'scheduled' 
          : m.status === 'finished';

        if (!canCount) continue;

        // Apenas fases de grupo ou knockout (mata-mata)
        if (m.phase && !['group', 'knockout'].includes(m.phase)) continue;

        // Resultado do Jogo (A, B ou draw) - Como você usa o placar da prorrogação,
        // o winnerFromScores pega o placar atual do Mongo.
        const real = winnerFromScores(Number(m.scoreA), Number(m.scoreB));
        const hitResult = real && gm.winner && real === gm.winner;

        // Lógica de Classificação (Para Mata-Mata)
        // Se houver qualifiedSide (pênaltis/fim), usa ele. Senão, usa o vencedor atual (real).
        const realQualifier = (typeof m.qualifiedSide !== 'undefined' && m.qualifiedSide) 
          ? m.qualifiedSide 
          : real;

        let hitQualifier = false;
        if (gm.qualifier && (gm.qualifier === 'A' || gm.qualifier === 'B')) {
          if (realQualifier && realQualifier !== 'draw' && gm.qualifier === realQualifier) {
            hitQualifier = true;
          }
        }

        // Soma: 1 pt por vencedor + 1 pt por classificado
        groupPoints += (hitResult ? 1 : 0) + (hitQualifier ? 1 : 0);
      }

      // Adiciona pontos de Pódio e Bônus que já estão no documento da aposta
      const podiumPoints = bet.podiumPoints || 0;
      const bonusPoints = bet.bonusPoints || 0;

      const user = userMap.get(bet.userId.toString());

      return {
        name: user ? user.name : "Usuário Excluído",
        avatar: user ? user.avatar : "default.png",
        points: groupPoints + podiumPoints + bonusPoints
      };
    });

    // 3. ORDENAÇÃO (Pontos DESC, depois Nome ASC)
    unsortedRanking.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    // 4. LÓGICA DE POSIÇÃO (Ranking de Competição: 1º, 1º, 3º...)
    let finalRanking = [];
    let currentPos = 0;
    let lastPts = -1;

    unsortedRanking.forEach((user, index) => {
      // Se a pontuação mudar, a posição pula para o índice atual + 1
      if (user.points !== lastPts) {
        currentPos = index + 1;
      }
      
      finalRanking.push({
        position: currentPos,
        name: user.name,
        points: user.points,
        avatar: user.avatar
      });

      lastPts = user.points;
    });

    res.json(finalRanking);

  } catch (error) {
    console.error("Erro ao gerar ranking:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
};

module.exports = { getRanking };
