const Match = require('../models/Match');
const Bet = require('../models/Bet');
const PointsHistory = require('../models/PointsHistory');
const Settings = require('../models/Settings');
const {
  getScoringRules,
  getChampionshipRules,
  calculateMatchPoints,
  calculatePodiumPoints,
  calculateExtrasPoints
} = require('./pointsService');

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
 * Salva o histórico diário reconstruindo os pontos até a data do snapshot.
 *
 * Pontos de partidas entram pela data da partida.
 * Pódio e extras entram somente depois dos respectivos eventos históricos
 * registrados em Settings.historyEvents.
 *
 * bonusPoints permanece fora desta reconstrução até existir um evento histórico
 * próprio para ele.
 */
async function saveDailySnapshot(historyDate, leagueId, options = {}) {
  const id = String(leagueId).trim();
  const allowNoMatches = options.allowNoMatches === true;

  const day = String(historyDate.getUTCDate()).padStart(2, '0');
  const month = String(historyDate.getUTCMonth() + 1).padStart(2, '0');
  const year = historyDate.getUTCFullYear();
  const matchDateStr = `${day}/${month}/${year}`;

  const matchesOfDay = await Match.find({
    date: matchDateStr,
    leagueId: id
  }).lean();

  const terminalStatus = ['finished', 'cancelled', 'postponed'];

  if (
    matchesOfDay.length > 0 &&
    matchesOfDay.some(match => !terminalStatus.includes(match.status))
  ) {
    return false;
  }

  if (matchesOfDay.length === 0 && !allowNoMatches) {
    return false;
  }

  const bets = await Bet.find({
    leagueId: id
  }).populate('user');

  if (!bets.length) {
    return false;
  }

  const [scoringRules, championshipRules, settings] =
    await Promise.all([
      getScoringRules(id),
      getChampionshipRules(id),
      Settings.findById(id).lean()
    ]);

  const allMatches = await Match.find({
    leagueId: id
  }).lean();

  const matchesThroughDate = allMatches.filter(match => {
    const matchDate = normalizeToUTCDate(match.date);

    return (
      matchDate &&
      matchDate.getTime() <= historyDate.getTime() &&
      match.status === 'finished'
    );
  });

  const matchMap = new Map(
    matchesThroughDate.map(match => [
      String(match.matchId),
      match
    ])
  );

  const historyEvents = Array.isArray(settings?.historyEvents)
    ? settings.historyEvents
        .map(event => ({
          type: event.type,
          key: event.key,
          value: event.value,
          at: normalizeToUTCDate(event.at)
        }))
        .filter(event => event.at)
    : [];

  // A snapshot represents the state at the end of the calendar day.
  const endOfHistoryDate = new Date(historyDate);
  endOfHistoryDate.setUTCDate(
    endOfHistoryDate.getUTCDate() + 1
  );

  const latestEvent = (type, key) => {
    return historyEvents
      .filter(event => {
        if (event.type !== type) return false;
        if (key !== undefined && event.key !== key) return false;

        return event.at.getTime() < endOfHistoryDate.getTime();
      })
      .sort((a, b) => a.at - b.at)
      .at(-1);
  };

  const podiumEvent = historyEvents
    .filter(event =>
      ['podium_defined', 'podium_reset'].includes(event.type) &&
      event.at.getTime() < endOfHistoryDate.getTime()
    )
    .sort((a, b) => a.at - b.at)
    .at(-1);

  const historicalPodium =
    podiumEvent?.type === 'podium_defined' &&
    Array.isArray(podiumEvent.value)
      ? podiumEvent.value
      : [];

  const historicalResults = {};

  for (const key of [
    'topScorer',
    'bestAttack',
    'worstDefense',
    'upset'
  ]) {
    const event = latestEvent(
      'extra_defined',
      key
    );

    historicalResults[key] =
      event?.value !== undefined
        ? event.value
        : null;
  }

  const snapshotsMap = new Map();

  for (const bet of bets) {
    if (!bet.user || !bet.user._id) continue;

    const userId = bet.user._id.toString();

    let points = 0;

    if (bet.hasSubmitted) {
      for (const betMatch of bet.groupMatches || []) {
        const realMatch = matchMap.get(
          String(betMatch.matchId)
        );

        if (!realMatch) continue;

        const result = calculateMatchPoints(
          betMatch,
          realMatch,
          scoringRules,
          championshipRules,
          false
        );

        points += Number(result.points) || 0;
      }

      if (podiumEvent?.type === 'podium_defined') {
        const podiumResult = calculatePodiumPoints(
          bet.podium,
          historicalPodium,
          scoringRules.podiumPoints,
          championshipRules.podiumSize
        );

        points += Number(podiumResult.points) || 0;
      }

      const extrasResult = calculateExtrasPoints(
        bet.extras,
        historicalResults,
        scoringRules
      );

      points += Number(extrasResult.points) || 0;
    }

    snapshotsMap.set(userId, {
      user: bet.user._id,
      leagueId: id,
      date: historyDate,
      points
    });
  }

  const snapshots = Array.from(
    snapshotsMap.values()
  );

  snapshots.sort(
    (a, b) =>
      Number(b.points || 0) -
      Number(a.points || 0)
  );

  let lastPoints = null;
  let position = 0;

  snapshots.forEach((snapshot, index) => {
    const points = Number(snapshot.points || 0);

    if (
      lastPoints === null ||
      points < lastPoints
    ) {
      position = index + 1;
      lastPoints = points;
    }

    snapshot.position = position;
  });

  if (!snapshots.length) {
    return false;
  }

  await PointsHistory.bulkWrite(
    snapshots.map(snapshot => ({
      updateOne: {
        filter: {
          user: snapshot.user,
          leagueId: snapshot.leagueId,
          date: snapshot.date
        },
        update: {
          $set: {
            points: snapshot.points,
            position: snapshot.position
          }
        },
        upsert: true
      }
    }))
  );

  return true;
}

async function trySaveDailyPoints(matchDateInput, leagueId) {
  try {
    if (!leagueId) {
      console.log(
        '⛔ [dailyHistory] leagueId não informado, abortando snapshot'
      );
      return;
    }

    const historyDate =
      normalizeToUTCDate(matchDateInput);

    if (!historyDate) {
      console.log(
        '⛔ [dailyHistory] Data inválida:',
        matchDateInput
      );
      return;
    }

    const saved = await saveDailySnapshot(
      historyDate,
      leagueId
    );

    if (saved) {
      console.log(
        `✅ [dailyHistory] [${leagueId}] snapshot atualizado`
      );
    }
  } catch (err) {
    console.error(
      `❌ [dailyHistory] Erro Crítico (Liga: ${leagueId}):`,
      err
    );
    throw err;
  }
}

/**
 * Reconstrói todo o histórico diário da liga.
 *
 * É usado quando um resultado, pódio ou extra é editado.
 * O histórico existente é removido e reconstruído usando os eventos
 * registrados e os resultados atuais das partidas.
 */
async function rebuildLeagueDailyHistory(leagueId) {
  if (!leagueId) {
    throw new Error('leagueId é obrigatório');
  }

  const id = String(leagueId).trim();

  const [matches, settings] = await Promise.all([
    Match.find({ leagueId: id }).lean(),
    Settings.findById(id).lean()
  ]);

  const dates = new Set();

  for (const match of matches) {
    const date = normalizeToUTCDate(match.date);

    if (date) {
      dates.add(date.getTime());
    }
  }

  for (const event of settings?.historyEvents || []) {
    const date = normalizeToUTCDate(event.at);

    if (date) {
      dates.add(date.getTime());
    }
  }

  const orderedDates = Array.from(dates)
    .sort((a, b) => a - b)
    .map(timestamp => new Date(timestamp));

  await PointsHistory.deleteMany({
    leagueId: id
  });

  for (const date of orderedDates) {
    await saveDailySnapshot(
      date,
      id,
      { allowNoMatches: true }
    );
  }
}

module.exports = {
  trySaveDailyPoints,
  rebuildLeagueDailyHistory
};
