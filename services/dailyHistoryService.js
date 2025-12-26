const Match = require('../models/Match');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');

/**
 * Converte "DD/MM/YYYY" → Date UTC 00:00
 */
function toUTCDateFromBR(brDate) {
  const [day, month, year] = brDate.split('/').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

async function trySaveDailyPoints(matchDateStr) {
  try {
    console.log('📅 [dailyHistory] Data recebida:', matchDateStr);

    // 🔒 Garantia absoluta de formato
    if (typeof matchDateStr !== 'string' || !matchDateStr.includes('/')) {
      console.log('⛔ Data inválida (esperado DD/MM/YYYY)');
      return;
    }

    // 1️⃣ Buscar partidas do dia (STRING)
    const matches = await Match.find({ date: matchDateStr });
    console.log('📅 [dailyHistory] Jogos do dia:', matches.length);

    if (!matches.length) {
      console.log('⛔ Nenhum jogo encontrado para o dia');
      return;
    }

    // 2️⃣ Verificar se todos terminaram
    const allFinished = matches.every(m => m.status === 'finished');
    console.log('📅 [dailyHistory] Todos finalizados?', allFinished);

    if (!allFinished) {
      console.log('⛔ Ainda existem jogos não finalizados');
      return;
    }

    // 3️⃣ Normalizar data para salvar no histórico
    const historyDate = toUTCDateFromBR(matchDateStr);
    console.log('📅 [dailyHistory] Date normalizada:', historyDate.toISOString());

    // 4️⃣ Evitar duplicação (regra absoluta)
    const alreadySaved = await PointsHistory.findOne({ date: historyDate });
    console.log('📅 [dailyHistory] Já salvo?', !!alreadySaved);

    if (alreadySaved) {
      console.log('⛔ Histórico já existe, abortando');
      return;
    }

    // 5️⃣ Salvar histórico por usuário
    const bets = await Bet.find({}).populate('user');
    console.log('👥 [dailyHistory] Apostas encontradas:', bets.length);

    for (const bet of bets) {
      console.log(
        '💾 Salvando histórico:',
        bet.user.name,
        '→',
        bet.totalPoints
      );

      await PointsHistory.create({
        user: bet.user._id,
        date: historyDate,
        points: bet.totalPoints
      });
    }

    console.log(`✅ Histórico diário salvo com sucesso (${matchDateStr})`);
  } catch (err) {
    console.error('❌ Erro ao salvar histórico diário:', err);
  }
}

module.exports = { trySaveDailyPoints };
