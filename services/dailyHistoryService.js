const Match = require('../models/Match');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');

/**
 * 🔁 Normaliza QUALQUER entrada de data para Date UTC 00:00
 */
function normalizeToUTCDate(input) {
  if (!input) return null;

  if (input instanceof Date) {
    return new Date(Date.UTC(
      input.getUTCFullYear(),
      input.getUTCMonth(),
      input.getUTCDate(),
      0, 0, 0
    ));
  }

  if (typeof input === 'string' && input.includes('/')) {
    const [day, month, year] = input.split('/').map(Number);
    if (!day || !month || !year) return null;
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  }

  const parsed = new Date(input);
  if (isNaN(parsed)) return null;

  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    0, 0, 0
  ));
}

/**
 * Tenta salvar o histórico de pontos do dia para uma LIGA específica
 */
async function trySaveDailyPoints(matchDateInput, leagueId) { // 👈 Adicionado leagueId
  try {
    if (!leagueId) {
      console.log('⛔ [dailyHistory] leagueId não informado, abortando snapshot');
      return;
    }

    console.log(`📅 [dailyHistory] [Liga: ${leagueId}] Data recebida:`, matchDateInput);

    const historyDate = normalizeToUTCDate(matchDateInput);
    if (!historyDate) {
      console.log('⛔ [dailyHistory] Data inválida:', matchDateInput);
      return;
    }

    const day   = String(historyDate.getUTCDate()).padStart(2, '0');
    const month = String(historyDate.getUTCMonth() + 1).padStart(2, '0');
    const year  = historyDate.getUTCFullYear();
    const matchDateStr = `${day}/${month}/${year}`;

    // 1️⃣ Buscar partidas do dia filtrando por LIGA
    const matches = await Match.find({ 
      date: matchDateStr, 
      leagueId: leagueId // 👈 Filtro essencial
    });

    console.log(`📅 [dailyHistory] [${leagueId}] Jogos encontrados:`, matches.length);

    if (!matches.length) {
      console.log(`⛔ [dailyHistory] Nenhum jogo encontrado para a liga ${leagueId} no dia`);
      return;
    }

    // 2️⃣ Verificar se todas desta liga estão finalizadas
    const allFinished = matches.every(m => m.status === 'finished');

    if (!allFinished) {
      console.log(`⛔ [dailyHistory] [${leagueId}] Ainda existem jogos pendentes nesta liga hoje.`);
      return;
    }

    // 3️⃣ Evitar duplicação por DIA e por LIGA
    const alreadySaved = await PointsHistory.findOne({
      date: historyDate,
      leagueId: leagueId // 👈 Snapshot agora é por liga
    });

    if (alreadySaved) {
      console.log(`⛔ [dailyHistory] Histórico da liga ${leagueId} já salvo hoje.`);
      return;
    }

    // 4️⃣ Buscar pontos das apostas DESTA LIGA
    const bets = await Bet.find({ leagueId: leagueId }).populate('user');

    console.log(`👥 [dailyHistory] [${leagueId}] Processando ${bets.length} usuários...`);

    const snapshots = bets.map(bet => {
      if (!bet.user) return null;

      return {
        user: bet.user._id,
        leagueId: leagueId, // 👈 Salva de qual liga é esse histórico
        date: historyDate,
        points: bet.totalPoints || 0
      };
    }).filter(Boolean);

    if (snapshots.length > 0) {
      await PointsHistory.insertMany(snapshots);
    }

    console.log(`✅ [dailyHistory] Histórico da liga ${leagueId} salvo com sucesso (${matchDateStr})`);

  } catch (err) {
    console.error(`❌ [dailyHistory] Erro ao salvar histórico (Liga: ${leagueId}):`, err);
  }
}

module.exports = { trySaveDailyPoints };
