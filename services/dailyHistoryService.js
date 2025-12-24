const Match = require('../models/Match');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');

async function trySaveDailyPoints(date) {
  try {
    // 1️⃣ Todos os jogos do dia
    const matches = await Match.find({ date });

    if (!matches.length) return;

    // 2️⃣ Verifica se TODOS estão finalizados
    const allFinished = matches.every(m => m.status === 'finished');
    if (!allFinished) return;

    // 3️⃣ Evita duplicar histórico do mesmo dia
    const alreadySaved = await PointsHistory.findOne({ date });
    if (alreadySaved) return;

    // 4️⃣ Busca todas as apostas
    const bets = await Bet.find({}).populate('user');

    // 5️⃣ Salva o total de pontos de cada usuário
    for (const bet of bets) {
      await PointsHistory.create({
        user: bet.user._id,
        date,
        points: bet.totalPoints // 🔥 AQUI ESTAVA O PROBLEMA
      });
    }

    console.log(`📊 Histórico diário salvo com sucesso (${date})`);
  } catch (err) {
    console.error('Erro ao salvar histórico diário:', err);
  }
}

module.exports = { trySaveDailyPoints };
