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

    const day   = String(historyDate.getUTCDate()).padStart(2, '0');
    const month = String(historyDate.getUTCMonth() + 1).padStart(2, '0');
    const year  = historyDate.getUTCFullYear();
    const matchDateStr = `${day}/${month}/${year}`;

    // 2️⃣ Buscar partidas do dia filtrando por LIGA (Conversão de tipo para segurança)
    const matches = await Match.find({ 
      date: matchDateStr, 
      leagueId: String(leagueId) 
    });

    if (!matches.length) {
      console.log(`⛔ [dailyHistory] [Liga: ${leagueId}] Nenhum jogo em ${matchDateStr}`);
      return;
    }

    // 3️⃣ Verificar se todas desta liga estão finalizadas
    const allFinished = matches.every(m => m.status === 'finished');
    if (!allFinished) {
      console.log(`⛔ [dailyHistory] [${leagueId}] Ainda existem jogos pendentes hoje.`);
      return;
    }

    // 4️⃣ Evitar duplicação por DIA e por LIGA
    const alreadySaved = await PointsHistory.findOne({
      date: historyDate,
      leagueId: String(leagueId)
    });

    if (alreadySaved) {
      console.log(`⛔ [dailyHistory] Histórico da liga ${leagueId} já existe para esta data.`);
      return;
    }

    // 5️⃣ Buscar apostas DESTA LIGA
    // Usamos populate('user') para garantir que temos o ID do usuário
    const bets = await Bet.find({ leagueId: String(leagueId) }).populate('user');

    if (!bets || bets.length === 0) {
      console.log(`⚠️ [dailyHistory] [${leagueId}] Nenhuma aposta encontrada.`);
      return;
    }

    // 6️⃣ Criar Snapshots Únicos por Usuário
    const snapshotsMap = new Map();

    bets.forEach(bet => {
      if (bet.user && bet.user._id) {
        const userId = bet.user._id.toString();
        
        // Garantimos que pegamos o totalPoints atualizado do documento Bet
        snapshotsMap.set(userId, {
          user: bet.user._id,
          leagueId: String(leagueId), // 🔑 CRUCIAL: Agora gravando explicitamente
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
