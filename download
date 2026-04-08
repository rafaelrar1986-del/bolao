const Match = require('../models/Match');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');

/**
 * 🔁 Normaliza QUALQUER entrada de data para Date UTC 00:00
 * Aceita:
 * - "DD/MM/YYYY"
 * - Date
 * - ISO string
 */
function normalizeToUTCDate(input) {
  if (!input) return null;

  // Já é Date
  if (input instanceof Date) {
    return new Date(Date.UTC(
      input.getUTCFullYear(),
      input.getUTCMonth(),
      input.getUTCDate(),
      0, 0, 0
    ));
  }

  // String DD/MM/YYYY
  if (typeof input === 'string' && input.includes('/')) {
    const [day, month, year] = input.split('/').map(Number);
    if (!day || !month || !year) return null;

    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  }

  // ISO ou outro formato aceito pelo Date()
  const parsed = new Date(input);
  if (isNaN(parsed)) return null;

  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    0, 0, 0
  ));
}

async function trySaveDailyPoints(matchDateInput) {
  try {
    console.log('📅 [dailyHistory] Data recebida:', matchDateInput);

    // 1️⃣ Normaliza a data para UTC 00:00
    const historyDate = normalizeToUTCDate(matchDateInput);

    if (!historyDate) {
      console.log('⛔ [dailyHistory] Data inválida:', matchDateInput);
      return;
    }

    console.log(
      '📅 [dailyHistory] Data normalizada:',
      historyDate.toISOString()
    );

    // 2️⃣ Converter para STRING DD/MM/YYYY para buscar partidas
    const day   = String(historyDate.getUTCDate()).padStart(2, '0');
    const month = String(historyDate.getUTCMonth() + 1).padStart(2, '0');
    const year  = historyDate.getUTCFullYear();
    const matchDateStr = `${day}/${month}/${year}`;

    console.log(
      '📅 [dailyHistory] Buscando partidas do dia:',
      matchDateStr
    );

    // 3️⃣ Buscar partidas do dia
    const matches = await Match.find({ date: matchDateStr });

    console.log(
      '📅 [dailyHistory] Jogos encontrados:',
      matches.length
    );

    if (!matches.length) {
      console.log('⛔ [dailyHistory] Nenhum jogo encontrado para o dia');
      return;
    }

    // 4️⃣ Verificar se todas estão finalizadas
    const allFinished = matches.every(m => m.status === 'finished');

    console.log(
      '📅 [dailyHistory] Todos finalizados?',
      allFinished
    );

    if (!allFinished) {
      console.log('⛔ [dailyHistory] Ainda existem jogos não finalizados');
      return;
    }

    // 5️⃣ Evitar duplicação (1 registro por dia)
    const alreadySaved = await PointsHistory.findOne({
      date: historyDate
    });

    console.log(
      '📅 [dailyHistory] Histórico já existe?',
      !!alreadySaved
    );

    if (alreadySaved) {
      console.log('⛔ [dailyHistory] Histórico já salvo, abortando');
      return;
    }

    // 6️⃣ Salvar histórico por usuário
    const bets = await Bet.find({}).populate('user');

    console.log(
      '👥 [dailyHistory] Apostas encontradas:',
      bets.length
    );

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

    console.log(
      `✅ [dailyHistory] Histórico diário salvo com sucesso (${matchDateStr})`
    );

  } catch (err) {
    console.error(
      '❌ [dailyHistory] Erro ao salvar histórico diário:',
      err
    );
  }
}

module.exports = { trySaveDailyPoints };
