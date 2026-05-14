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

  // Trata formato DD/MM/YYYY
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
async function trySaveDailyPoints(matchDateInput, leagueId) {
  try {
    // 1️⃣ Validação de Entrada
    if (!leagueId) {
      console.log('⛔ [dailyHistory] leagueId não informado, abortando snapshot');
      return;
    }

    const historyDate = normalizeToUTCDate(matchDateInput);
    if (!historyDate) {
      console.log('⛔ [dailyHistory] Data inválida:', matchDateInput);
      return;
    }

    // Formata para o padrão string do seu Match Model (DD/MM/YYYY)
    const day   = String(historyDate.getUTCDate()).padStart(2, '0');
    const month = String(historyDate.getUTCMonth() + 1).padStart(2, '0');
    const year  = historyDate.getUTCFullYear();
    const matchDateStr = `${day}/${month}/${year}`;

    // 2️⃣ Buscar partidas do dia filtrando por LIGA
    // Usamos Number(leagueId) para bater com o Schema
    const matches = await Match.find({ 
      date: matchDateStr, 
      leagueId: Number(leagueId) 
    });

    if (!matches.length) {
      console.log(`⛔ [dailyHistory] [Liga: ${leagueId}] Nenhum jogo encontrado em ${matchDateStr}`);
      return;
    }

    // 3️⃣ Verificar status terminais (Aceita finished, cancelled e postponed como "encerrados")
    const terminalStatus = ['finished', 'cancelled', 'postponed'];
    const pendingMatches = matches.filter(m => !terminalStatus.includes(m.status));

    if (pendingMatches.length > 0) {
      console.log(`⛔ [dailyHistory] [${leagueId}] Existem ${pendingMatches.length} jogos pendentes em ${matchDateStr}:`);
      pendingMatches.forEach(m => {
        console.log(`   - ID: ${m.matchId} | ${m.teamA} x ${m.teamB} | Status: ${m.status}`);
      });
      return;
    }

    // 4️⃣ Evitar duplicação por DIA e por LIGA
    const alreadySaved = await PointsHistory.findOne({
      date: historyDate,
      leagueId: Number(leagueId)
    });

    if (alreadySaved) {
      console.log(`⛔ [dailyHistory] Histórico da liga ${leagueId} já existe para ${matchDateStr}.`);
      return;
    }

    // 5️⃣ Buscar apostas DESTA LIGA e popular usuários
    const bets = await Bet.find({ leagueId: Number(leagueId) }).populate('user');

    if (!bets || bets.length === 0) {
      console.log(`⚠️ [dailyHistory] [${leagueId}] Nenhuma aposta encontrada.`);
      return;
    }

    // 6️⃣ Criar Snapshots Únicos por Usuário
    const snapshotsMap = new Map();

    bets.forEach(bet => {
      if (bet.user && bet.user._id) {
        const userId = bet.user._id.toString();
        
        // Salvamos o estado atual de pontos da aposta (acumulado)
        snapshotsMap.set(userId, {
          user: bet.user._id,
          leagueId: Number(leagueId),
          date: historyDate,
          points: bet.totalPoints || 0
        });
      }
    });

    const snapshots = Array.from(snapshotsMap.values());

    if (snapshots.length > 0) {
      await PointsHistory.insertMany(snapshots);
      console.log(`✅ [dailyHistory] [${leagueId}] Sucesso: ${snapshots.length} usuários salvos (${matchDateStr})`);
    } else {
      console.log(`⚠️ [dailyHistory] [${leagueId}] Nenhum snapshot válido gerado.`);
    }

  } catch (err) {
    console.error(`❌ [dailyHistory] Erro Crítico (Liga: ${leagueId}):`, err);
  }
}

module.exports = { trySaveDailyPoints };
