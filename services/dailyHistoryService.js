const Match = require('../models/Match');
const User = require('../models/User');
const PointsHistory = require('../models/PointsHistory');

async function trySaveDailyPoints(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);

  // 1️⃣ Verificar se ainda existem jogos NÃO finalizados nesse dia
  const pendingGames = await Match.countDocuments({
    date: {
      $gte: day,
      $lt: new Date(day.getTime() + 24 * 60 * 60 * 1000)
    },
    status: { $ne: 'finalizado' }
  });

  // Ainda existem jogos do dia em aberto
  if (pendingGames > 0) {
    return { saved: false, reason: 'Jogos pendentes no dia' };
  }

  // 2️⃣ Buscar todos os usuários
  const users = await User.find({}, '_id points');

  let savedCount = 0;

  for (const user of users) {
    // 3️⃣ Evitar duplicação (1 registro por dia)
    const alreadySaved = await PointsHistory.findOne({
      user: user._id,
      date: day
    });

    if (alreadySaved) continue;

    await PointsHistory.create({
      user: user._id,
      date: day,
      points: user.points
    });

    savedCount++;
  }

  return {
    saved: true,
    usersSaved: savedCount,
    date: day
  };
}

module.exports = {
  trySaveDailyPoints
};
