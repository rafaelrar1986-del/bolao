const Match = require('../models/Match');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');

async function trySaveDailyPoints(date) {
  try {
    console.log('📅 [dailyHistory] Date recebida:', date);

    const matches = await Match.find({ date });
    console.log('📅 [dailyHistory] Jogos do dia:', matches.length);

    if (!matches.length) {
      console.log('⛔ Nenhum jogo encontrado para o dia');
      return;
    }

    const allFinished = matches.every(m => m.status === 'finished');
    console.log('📅 [dailyHistory] Todos finalizados?', allFinished);

    if (!allFinished) {
      console.log('⛔ Ainda existem jogos não finalizados');
      return;
    }

    const alreadySaved = await PointsHistory.findOne({ date });
    console.log('📅 [dailyHistory] Já salvo?', !!alreadySaved);

    if (alreadySaved) {
      console.log('⛔ Histórico já existe, abortando');
      return;
    }

    const bets = await Bet.find({}).populate('user');
    console.log('👥 [dailyHistory] Apostas encontradas:', bets.length);

    for (const bet of bets) {
      console.log('💾 Salvando histórico do usuário:', bet.user.name, bet.totalPoints);

      await PointsHistory.create({
        user: bet.user._id,
        date,
        points: bet.totalPoints
      });
    }

    console.log(`✅ Histórico diário salvo com sucesso (${date})`);
  } catch (err) {
    console.error('❌ Erro ao salvar histórico diário:', err);
  }
}

module.exports = { trySaveDailyPoints };
