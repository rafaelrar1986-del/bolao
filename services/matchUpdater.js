const axios = require('axios');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const User = require('../models/User');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');
const { recalculateAllPoints } = require('./pointsService');
const { trySaveDailyPoints } = require('./dailyHistoryService');

const API_KEY = process.env.API_FOOTBALL_KEY;
const BASE_URL = 'https://sports.bzzoiro.com/api/v2';
const headers = { Authorization: `Token ${API_KEY}` };

const axiosClient = axios.create({
  baseURL: BASE_URL,
  headers,
  timeout: 15000
});

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeNullableNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeStr(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function parseMinuteValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function shouldIgnoreStatusRegression(currentStatus, nextStatus) {
  const order = {
    scheduled: 0,
    ao_vivo: 1,
    '1_tempo': 2,
    intervalo: 3,
    '2_tempo': 4,
    prorrogacao: 5,
    penaltis: 6,
    finished: 7,
    postponed: 8,
    cancelled: 9
  };

  const current = order[currentStatus] ?? 0;
  const next = order[nextStatus] ?? 0;
  return next < current;
}

function shouldIgnoreMinuteRegression(currentMinute, nextMinute) {
  const current = parseMinuteValue(currentMinute);
  const next = parseMinuteValue(nextMinute);

  if (next === null) return true;
  if (current === null) return false;
  return next < current;
}

function mapApiStatus(status, period) {
  const s = safeStr(status).toLowerCase();
  const p = safeStr(period).toLowerCase();

  if (s === 'finished' || p === 'ft') return 'FT';
  if (s === 'postponed') return 'PST';
  if (s === 'cancelled') return 'CXL';
  if (s === 'penalties' || p === 'pen') return 'PEN';
  
  if (s === '1st_half' || p === '1t' || p === '1h') return '1T';
  
  if (s === 'halftime' || p === 'ht') return 'HT';
  
  if (s === '2nd_half' || p === '2t' || p === '2h') return '2T';
  
  if (s === 'extra_time' || p === 'et') return 'ET';
  if (s === 'notstarted') return 'NS';
  if (s === 'inprogress') return 'LIVE';
  return 'NS';
}

function mapStatus(status, period) {
  const s = safeStr(status).toLowerCase();
  const p = safeStr(period).toLowerCase();

  if (s === 'finished' || p === 'ft') return 'finished';
  if (s === 'postponed') return 'postponed';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'penalties' || p === 'pen') return 'penaltis';
  
  if (s === '1st_half' || p === '1t' || p === '1h') return '1_tempo';
  
  if (s === 'halftime' || p === 'ht') return 'intervalo';
  
  if (s === '2nd_half' || p === '2t' || p === '2h') return '2_tempo';
  
  if (s === 'extra_time' || p === 'et') return 'prorrogacao';
  if (s === 'notstarted') return 'scheduled';
  if (s === 'inprogress') return 'ao_vivo';
  return 'scheduled';
}
function mapPlayerV2(p) {
  if (!p) return null;

  return {
    id: p.id ?? null,
    api_id: p.id ?? null,
    nome: p.short_name || p.name || 'Desconhecido',
    numero: p.jersey_number ?? null,
    posicao: p.position || null,
    posicaoDetalhada: p.specific_position || null,
    entrou: null,
    saiu: null,
    amarelo: false,
    vermelho: false,
    gols: 0,
    assists: 0,
    rating: null,
    ai_score: p.ai_score ?? null
  };
}

function sortByPosition(players) {
  const order = { G: 0, D: 1, M: 2, F: 3 };
  return [...players].sort((a, b) => (order[a.posicao] ?? 9) - (order[b.posicao] ?? 9));
}

function mapUnavailablePlayers(list, side) {
  if (!Array.isArray(list)) return [];

  return list.filter(Boolean).map((p) => ({
    id: p.id ?? null,
    nome: p.short_name || p.name || 'Desconhecido',
    short_name: p.short_name || p.name || 'Desconhecido',
    status: p.status || null,
    reason: p.reason || null,
    side
  }));
}

function mapLineupSide(side) {
  if (!side) {
    return {
      formation: '',
      players: [],
      substitutes: []
    };
  }

  return {
    formation: side.formation || '',
    players: sortByPosition((side.players || []).map(mapPlayerV2).filter(Boolean)),
    substitutes: sortByPosition((side.substitutes || []).map(mapPlayerV2).filter(Boolean))
  };
}

function mapLineupsV2(payload) {
  if (!payload || !payload.lineups) {
    return {
      home: mapLineupSide(null),
      away: mapLineupSide(null),
      confirmed: false,
      lineupStatus: 'unavailable',
      beta: false,
      updatedAt: null,
      unavailable: []
    };
  }

  return {
    home: mapLineupSide(payload.lineups.home),
    away: mapLineupSide(payload.lineups.away),
    confirmed: payload.lineup_status === 'confirmed',
    lineupStatus: payload.lineup_status || 'unavailable',
    beta: !!payload.beta,
    updatedAt: payload.updated_at || null,
    unavailable: [
      ...mapUnavailablePlayers(payload.unavailable_players?.home, 'home'),
      ...mapUnavailablePlayers(payload.unavailable_players?.away, 'away')
    ]
  };
}

function normalizeStatSide(side = {}) {
  return {
    duels: safeNum(side.duels),
    fouls: safeNum(side.fouls),
    passes: safeNum(side.passes),
    crosses: side.crosses || null,
    punches: safeNum(side.punches),
    tackles: safeNum(side.tackles),
    dribbles: side.dribbles || null,
    offsides: safeNum(side.offsides),
    big_saves: safeNum(side.big_saves),
    throw_ins: safeNum(side.throw_ins),
    clearances: safeNum(side.clearances),
    free_kicks: safeNum(side.free_kicks),
    goal_kicks: safeNum(side.goal_kicks),
    long_balls: side.long_balls || null,
    recoveries: safeNum(side.recoveries),
    big_chances: safeNum(side.big_chances),
    high_claims: safeNum(side.high_claims),
    tackles_won: safeNum(side.tackles_won),
    total_saves: safeNum(side.total_saves),
    total_shots: safeNum(side.total_shots),
    aerial_duels: side.aerial_duels || null,
    corner_kicks: safeNum(side.corner_kicks),
    dispossessed: safeNum(side.dispossessed),
    ground_duels: side.ground_duels || null,
    hit_woodwork: safeNum(side.hit_woodwork),
    yellow_cards: safeNum(side.yellow_cards),
    blocked_shots: safeNum(side.blocked_shots),
    interceptions: safeNum(side.interceptions),
    through_balls: safeNum(side.through_balls),
    total_tackles: safeNum(side.total_tackles),
    expected_goals: safeNullableNum(side.expected_goals),
    accurate_passes: safeNum(side.accurate_passes),
    ball_possession: safeNum(side.ball_possession),
    goals_prevented: safeNullableNum(side.goals_prevented),
    shots_on_target: safeNum(side.shots_on_target),
    goalkeeper_saves: safeNum(side.goalkeeper_saves),
    shots_inside_box: safeNum(side.shots_inside_box),
    shots_off_target: safeNum(side.shots_off_target),
    final_third_phase: side.final_third_phase || null,
    shots_outside_box: safeNum(side.shots_outside_box),
    big_chances_missed: safeNum(side.big_chances_missed),
    big_chances_scored: safeNum(side.big_chances_scored),
    final_third_entries: safeNum(side.final_third_entries),
    errors_lead_to_a_goal: safeNum(side.errors_lead_to_a_goal),
    fouled_in_final_third: safeNum(side.fouled_in_final_third),
    touches_in_penalty_area: safeNum(side.touches_in_penalty_area),
    attack: safeNum(side.attack),
    ball_safe: safeNum(side.ball_safe),
    dangerous_attack: safeNum(side.dangerous_attack),
    attack_pct: safeNum(side.attack_pct),
    ball_safe_pct: safeNum(side.ball_safe_pct),
    dangerous_attack_pct: safeNum(side.dangerous_attack_pct),
    pass_accuracy_pct: safeNullableNum(side.pass_accuracy_pct),
    xg: side.xg || { actual: null }
  };
}

function normalizeStatsV2(payload) {
  if (!payload || !payload.stats) {
    return {
      home: {},
      away: {},
      first_half: null,
      second_half: null,
      shotmap: [],
      momentum: [],
      average_positions: {},
      xg_per_minute: []
    };
  }

  return {
    home: normalizeStatSide(payload.stats.home || {}),
    away: normalizeStatSide(payload.stats.away || {}),
    first_half: payload.first_half || null,
    second_half: payload.second_half || null,
    shotmap: Array.isArray(payload.shotmap) ? payload.shotmap : [],
    momentum: Array.isArray(payload.momentum) ? payload.momentum : [],
    average_positions: payload.average_positions || {},
    xg_per_minute: Array.isArray(payload.xg_per_minute) ? payload.xg_per_minute : []
  };
}

function normalizeIncidentsV2(payload) {
  const incidents = Array.isArray(payload?.incidents) ? payload.incidents : [];
  const goals = [];
  const cards = [];
  const substitutions = [];
  const timeline = [];

  for (const item of incidents) {
    if (!item || !item.type) continue;

    if (item.type === 'goal') {
      goals.push({
        type: item.type,
        name: item.player || 'Lance',
        min: item.minute,
        extra: item.added_time ?? null,
        side: item.is_home ? 'home' : 'away',
        description: item.goal_type || '',
        playerIn: null,
        playerOut: null
      });
    }

    if (item.type === 'card') {
      cards.push({
        type: item.type,
        name: item.player || 'Cartão',
        min: item.minute,
        extra: item.added_time ?? null,
        side: item.is_home ? 'home' : 'away',
        description: item.card_type || '',
        playerIn: null,
        playerOut: null
      });
    }

    if (item.type === 'substitution') {
      substitutions.push({
        type: item.type,
        name: `${item.player_in || 'Entrou'} / ${item.player_out || 'Saiu'}`,
        min: item.minute,
        extra: item.added_time ?? null,
        side: item.is_home ? 'home' : 'away',
        description: 'substitution',
        playerIn: item.player_in || null,
        playerOut: item.player_out || null
      });
    }

    if (item.type === 'period') {
      timeline.push({
        type: item.type,
        name: item.text || 'Período',
        min: item.minute,
        extra: null,
        side: null,
        description: item.text || ''
      });
    }

    if (item.type === 'injuryTime') {
      timeline.push({
        type: item.type,
        name: 'Acréscimos',
        min: item.minute,
        extra: item.length ?? null,
        side: null,
        description: 'injuryTime'
      });
    }

    if (item.type === 'varDecision') {
      timeline.push({
        type: item.type,
        name: item.player || 'VAR',
        min: item.minute,
        extra: null,
        side: item.is_home ? 'home' : 'away',
        description: `${item.decision || 'var'}${item.confirmed === false ? ' (not confirmed)' : ''}`
      });
    }
  }

  return {
    incidents,
    goals,
    cards,
    substitutions,
    timeline
  };
}

function extractPenaltyDetailed(shotmap) {
  if (!Array.isArray(shotmap) || shotmap.length === 0) {
    return { home: null, away: null, sequence: [] };
  }

  const shootoutShots = shotmap
    .filter((s) => s && (s.sit === 'shootout' || s.gtype === 'shootout'))
    .sort((a, b) => safeNum(a.min) - safeNum(b.min));

  if (shootoutShots.length === 0) {
    return { home: null, away: null, sequence: [] };
  }

  let home = 0;
  let away = 0;

  const sequence = shootoutShots.map((s) => {
    if (s.type === 'goal') {
      if (s.home) home += 1;
      else away += 1;
    }

    return {
      home: !!s.home,
      type: s.type || null,
      player_id: s.player_id ?? s.pid ?? null,
      min: s.min ?? null
    };
  });

  return { home, away, sequence };
}

function mergePlayerStatsIntoLineups(lineups, playerStatsRows) {
  if (!lineups || !playerStatsRows) return lineups;

  const statsMap = new Map();
  for (const row of playerStatsRows) {
    const playerId = row?.player_id ?? row?.player?.id ?? null;
    if (playerId === null || playerId === undefined) continue;
    statsMap.set(Number(playerId), row);
  }

  const applyStats = (player) => {
    if (!player || player.id === null || player.id === undefined) return player;
    const stats = statsMap.get(Number(player.id));
    if (!stats) return player;

    return {
      ...player,
      gols: safeNum(stats.goals),
      assists: safeNum(stats.goal_assist),
      amarelo: safeNum(stats.yellow_card) > 0,
      vermelho: safeNum(stats.red_card) > 0,
      rating: stats.rating ?? null
    };
  };

  const patchSide = (side) => ({
    ...side,
    players: (side.players || []).map(applyStats),
    substitutes: (side.substitutes || []).map(applyStats)
  });

  return {
    ...lineups,
    home: patchSide(lineups.home || {}),
    away: patchSide(lineups.away || {})
  };
}

function applyIncidentsToLineups(lineups, incidents, useIncidentGoals = true) {
  if (!lineups || !incidents) return lineups;

  const goalCountByPlayer = new Map();
  const cardTypeByPlayer = new Map();
  const subInByPlayer = new Map();
  const subOutByPlayer = new Map();

  for (const g of incidents.goals || []) {
    const key = `${g.side}:${g.name}`;
    goalCountByPlayer.set(key, (goalCountByPlayer.get(key) || 0) + 1);
  }

  for (const c of incidents.cards || []) {
    const key = `${c.side}:${c.name}`;
    cardTypeByPlayer.set(key, c.description || 'yellow');
  }

  for (const s of incidents.substitutions || []) {
    if (s.playerIn) subInByPlayer.set(`${s.side}:${s.playerIn}`, s.min);
    if (s.playerOut) subOutByPlayer.set(`${s.side}:${s.playerOut}`, s.min);
  }

  const patchSide = (side, isHome) => {
    const sideName = isHome ? 'home' : 'away';

    const updatePlayer = (player) => {
      if (!player) return player;

      const key = `${sideName}:${player.nome}`;
      const gCount = goalCountByPlayer.get(key) || 0;
      const cType = cardTypeByPlayer.get(key) || null;
      const subIn = subInByPlayer.get(key) || null;
      const subOut = subOutByPlayer.get(key) || null;

      const updatedGoals = useIncidentGoals && (player.gols === null || player.gols === undefined || player.gols === 0)
        ? gCount
        : player.gols;

      return {
        ...player,
        entrou: subIn ? `${subIn}'` : player.entrou,
        saiu: subOut ? `${subOut}'` : player.saiu,
        gols: updatedGoals,
        amarelo: cType ? cType === 'yellow' || cType === 'yellowRed' || player.amarelo : player.amarelo,
        vermelho: cType ? cType === 'red' || cType === 'yellowRed' || player.vermelho : player.vermelho
      };
    };

    return {
      ...side,
      players: (side.players || []).map(updatePlayer),
      substitutes: (side.substitutes || []).map(updatePlayer)
    };
  };

  return {
    ...lineups,
    home: patchSide(lineups.home || {}, true),
    away: patchSide(lineups.away || {}, false)
  };
}

async function fetchJson(path, { timeout = 15000, params = {} } = {}) {
  const response = await axiosClient.get(path, { timeout, params });
  return response.data;
}

async function fetchEventBundle(eventId) {
  const [detailRes, statsRes, incidentsRes, lineupsRes, playerStatsRes] = await Promise.allSettled([
    fetchJson(`/events/${eventId}/`, { timeout: 10000 }),
    fetchJson(`/events/${eventId}/stats/`, { timeout: 15000 }),
    fetchJson(`/events/${eventId}/incidents/`, { timeout: 12000 }),
    fetchJson(`/events/${eventId}/lineups/`, { timeout: 12000 }),
    fetchJson(`/events/${eventId}/player-stats/`, { timeout: 12000 })
  ]);

  return {
    detail: detailRes.status === 'fulfilled' ? detailRes.value : null,
    stats: statsRes.status === 'fulfilled' ? statsRes.value : null,
    incidents: incidentsRes.status === 'fulfilled' ? incidentsRes.value : null,
    lineups: lineupsRes.status === 'fulfilled' ? lineupsRes.value : null,
    playerStats: playerStatsRes.status === 'fulfilled' ? playerStatsRes.value : null
  };
}

function normalizeEventCore(event) {
  if (!event) return null;

  return {
    id: event.id,
    leagueId: event.league_id ?? null,
    leagueName: event.league_name ?? '',
    seasonId: event.season_id ?? null,
    homeTeamId: event.home_team_id ?? null,
    homeTeam: event.home_team ?? '',
    awayTeamId: event.away_team_id ?? null,
    awayTeam: event.away_team ?? '',
    eventDate: event.event_date ?? null,
    status: event.status ?? 'notstarted',
    period: event.period ?? null,
    currentMinute: event.current_minute ?? null,
    homeScore: event.home_score ?? null,
    awayScore: event.away_score ?? null,
    homeScoreHT: event.home_score_ht ?? null,
    awayScoreHT: event.away_score_ht ?? null,
    penaltyShootout: event.penalty_shootout ?? null,
    isLocalDerby: event.is_local_derby ?? null,
    isNeutralGround: event.is_neutral_ground ?? null,
    travelDistanceKm: event.travel_distance_km ?? null,
    weather: event.weather ?? null,
    pitchCondition: event.pitch_condition ?? null,
    attendance: event.attendance ?? null,
    liveWebsocket: event.live_websocket ?? null,
    roundNumber: event.round_number ?? null,
    roundName: event.round_name ?? null,
    groupName: event.group_name ?? null,
    extraTimeScore: event.extra_time_score ?? null,
    updatedAt: event.updated_at ?? event.last_updated ?? null
  };
}

async function processGameList(games, allowedLeagues, robotSettings, source) {
  if (!Array.isArray(games) || games.length === 0) return;

  for (const gameData of games) {
    try {
      const core = normalizeEventCore(gameData);
      if (!core?.id) continue;
      if (Array.isArray(allowedLeagues) && allowedLeagues.length > 0 && !allowedLeagues.includes(Number(core.leagueId))) continue;

      const match = await Match.findOne({ apiId: core.id });
      if (!match) continue;

      // If it's already truly finished and already has score, keep traffic low.
      if (
        match.status === 'finished' &&
        match.scoreA !== null &&
        match.scoreA !== undefined &&
        match.scoreB !== null &&
        match.scoreB !== undefined
      ) {
        continue;
      }

      const rawStatus = firstDefined(gameData.status, core.status);
      const rawPeriod = firstDefined(gameData.period, core.period);
      const proposedStatus = mapStatus(rawStatus, rawPeriod);

      // --- NOVA TRAVA: EVITAR ATUALIZAÇÕES FANTASMAS EM JOGOS FUTUROS ---
      if (match.status === 'scheduled' && proposedStatus === 'scheduled') {
        let apiDate = match.date;
        let apiTime = match.time;
        
        // Simular a mesma transformação de data que ocorre mais abaixo no código
        if (core.eventDate) {
          const d = new Date(core.eventDate);
          if (!Number.isNaN(d.getTime())) {
            const day = String(d.getUTCDate()).padStart(2, '0');
            const month = String(d.getUTCMonth() + 1).padStart(2, '0');
            const year = d.getUTCFullYear();
            const hh = String(d.getUTCHours()).padStart(2, '0');
            const mm = String(d.getUTCMinutes()).padStart(2, '0');
            apiDate = `${day}/${month}/${year}`;
            apiTime = `${hh}:${mm}`;
          }
        }

        const dadosIdenticos =
          match.time === apiTime &&
          match.date === apiDate &&
          match.teamA === (core.homeTeam || match.teamA) &&
          match.teamB === (core.awayTeam || match.teamB);

        // Se nada de importante mudou no jogo futuro, pulamos a atualização no Mongo
        if (dadosIdenticos) {
          continue; 
        }
      }
      // ------------------------------------------------------------------

      const status = shouldIgnoreStatusRegression(match.status, proposedStatus)
        ? match.status
        : proposedStatus;
      const statusChanged = match.status !== status;

      // --- TRAVA DE GRADE E AUDITORIA ---
      if (match.status === 'scheduled' && !['scheduled', 'cancelled'].includes(status)) {
        const configId = `league_${match.leagueId || core.leagueId || 1}`;
        const lockIdentifier = match.phaseName || match.group;
        const settingsUpdated = await Settings.findOneAndUpdate(
          { _id: configId, lockedPhases: { $ne: lockIdentifier } },
          {
            $addToSet: { lockedPhases: lockIdentifier, unlockedPhases: { $each: [lockIdentifier, 'podium'] } },
            $set: { statsLocked: false, blockSaveBets: true, blockSaveKnockout: true }
          },
          { new: true }
        );

        if (settingsUpdated) {
          auditService.generateAuditCSV(match.leagueId || 1, lockIdentifier)
            .then(async (csv) => {
              if (!csv) return;
              const users = await User.find({ leagues: Number(match.leagueId || 1) }, 'email');
              const emails = users.map((u) => u.email).filter((e) => !!e);
              if (emails.length > 0) {
                await emailService.sendBroadcastEmail(emails, `🔒 Auditoria: ${lockIdentifier}`, 'Trancado.', csv);
              }
            })
            .catch((e) => console.error('Audit Err:', e.message));
        }
      }

      const shouldFetchBundle =
        source === 'LIVE' ||
        status !== 'scheduled' ||
        !match.lineups?.home?.players?.length ||
        !match.lineups?.away?.players?.length ||
        !match.statistics?.length;

      let detail = core;
      let statsPayload = null;
      let incidentsPayload = null;
      let lineupsPayload = null;
      let playerStatsPayload = null;

      if (shouldFetchBundle) {
        const bundle = await fetchEventBundle(core.id);
        if (bundle.detail) detail = { ...core, ...normalizeEventCore(bundle.detail) };
        statsPayload = bundle.stats;
        incidentsPayload = bundle.incidents;
        lineupsPayload = bundle.lineups;
        playerStatsPayload = bundle.playerStats;
      }

      const eventDetail = normalizeEventCore(detail);
      const effectiveStatus = shouldIgnoreStatusRegression(match.status, mapStatus(firstDefined(gameData.status, eventDetail.status), firstDefined(gameData.period, eventDetail.period)))
        ? match.status
        : mapStatus(firstDefined(gameData.status, eventDetail.status), firstDefined(gameData.period, eventDetail.period));
      const effectiveStatusChanged = match.status !== effectiveStatus;

      // Scores: prioritize live payload first, then detail, then persisted values.
      const liveHomeScore = firstDefined(gameData.home_score, gameData.homeScore);
      const liveAwayScore = firstDefined(gameData.away_score, gameData.awayScore);
      const detailHomeScore = firstDefined(eventDetail.homeScore, eventDetail.home_score);
      const detailAwayScore = firstDefined(eventDetail.awayScore, eventDetail.away_score);

      const resolvedHomeScore = liveHomeScore !== null
        ? Number(liveHomeScore)
        : (
            detailHomeScore !== null
              ? Number(detailHomeScore)
              : (match.scoreA !== null && match.scoreA !== undefined ? Number(match.scoreA) : 0)
          );

      const resolvedAwayScore = liveAwayScore !== null
        ? Number(liveAwayScore)
        : (
            detailAwayScore !== null
              ? Number(detailAwayScore)
              : (match.scoreB !== null && match.scoreB !== undefined ? Number(match.scoreB) : 0)
          );

      // Penalties can come from event detail or shootout shots.
      let penA = firstDefined(eventDetail.penaltyShootout?.home, match.penaltiesA);
      let penB = firstDefined(eventDetail.penaltyShootout?.away, match.penaltiesB);
      let shootoutSequence = Array.isArray(match.shootoutDetail) ? match.shootoutDetail : [];

      if (statsPayload?.shotmap?.length) {
        const detailed = extractPenaltyDetailed(statsPayload.shotmap);
        if (detailed.home !== null) {
          penA = detailed.home;
          penB = detailed.away;
          shootoutSequence = detailed.sequence;
        }
      }

      const incidents = normalizeIncidentsV2(incidentsPayload);
      let lineups = mapLineupsV2(lineupsPayload);
      if (playerStatsPayload?.player_stats && Array.isArray(playerStatsPayload.player_stats)) {
        lineups = mergePlayerStatsIntoLineups(lineups, playerStatsPayload.player_stats);
      }
      lineups = applyIncidentsToLineups(lineups, incidents, !playerStatsPayload?.player_stats?.length);

      const liveMinute = firstDefined(gameData.current_minute, gameData.currentMinute);
      const detailMinute = firstDefined(eventDetail.currentMinute, eventDetail.current_minute);
      const resolvedMinute = shouldIgnoreMinuteRegression(match.minute, liveMinute)
        ? (shouldIgnoreMinuteRegression(match.minute, detailMinute) ? match.minute : `${detailMinute}'`)
        : `${liveMinute}'`;

      const updateData = {
        scoreA: resolvedHomeScore,
        scoreB: resolvedAwayScore,
        status: effectiveStatus,
        apiStatus: mapApiStatus(firstDefined(gameData.status, eventDetail.status), firstDefined(gameData.period, eventDetail.period)),
        minute: effectiveStatus === 'finished' ? 'Fim' : resolvedMinute,
        penaltiesA: penA,
        penaltiesB: penB,
        shootoutDetail: shootoutSequence,
        apiLastUpdated: firstDefined(gameData.last_updated, eventDetail.updatedAt, match.apiLastUpdated)
      };

      // Existing schema fields.
      if (eventDetail.leagueId !== null && eventDetail.leagueId !== undefined) {
        updateData.leagueId = eventDetail.leagueId;
      }
      if (eventDetail.leagueName) {
        updateData.leagueName = eventDetail.leagueName;
      }
      if (eventDetail.groupName || eventDetail.roundName) {
        updateData.group = eventDetail.groupName || eventDetail.roundName || match.group;
      }
      if (eventDetail.roundName || eventDetail.groupName) {
        updateData.phaseName = eventDetail.roundName || eventDetail.groupName || match.phaseName;
      }
      if (eventDetail.groupName || eventDetail.roundName) {
        updateData.phase = eventDetail.groupName ? 'group' : match.phase;
      }

      if (eventDetail.eventDate) {
        const d = new Date(eventDetail.eventDate);
        if (!Number.isNaN(d.getTime())) {
          const day = String(d.getUTCDate()).padStart(2, '0');
          const month = String(d.getUTCMonth() + 1).padStart(2, '0');
          const year = d.getUTCFullYear();
          const hh = String(d.getUTCHours()).padStart(2, '0');
          const mm = String(d.getUTCMinutes()).padStart(2, '0');
          updateData.date = `${day}/${month}/${year}`;
          updateData.time = `${hh}:${mm}`;
        }
      }

      if (eventDetail.homeTeam) updateData.teamA = eventDetail.homeTeam;
      if (eventDetail.awayTeam) updateData.teamB = eventDetail.awayTeam;

      if (eventDetail.isNeutralGround !== null && eventDetail.isNeutralGround !== undefined) {
        updateData.isNeutralGround = eventDetail.isNeutralGround;
      }
      if (eventDetail.isLocalDerby !== null && eventDetail.isLocalDerby !== undefined) {
        updateData.isLocalDerby = eventDetail.isLocalDerby;
      }
      if (eventDetail.travelDistanceKm !== null && eventDetail.travelDistanceKm !== undefined) {
        updateData.travelDistanceKm = eventDetail.travelDistanceKm;
      }
      if (eventDetail.weather !== null && eventDetail.weather !== undefined) {
        updateData.weather = eventDetail.weather;
      }
      if (eventDetail.pitchCondition !== null && eventDetail.pitchCondition !== undefined) {
        updateData.pitchCondition = eventDetail.pitchCondition;
      }
      if (eventDetail.attendance !== null && eventDetail.attendance !== undefined) {
        updateData.attendance = eventDetail.attendance;
      }
      if (eventDetail.homeScoreHT !== null && eventDetail.homeScoreHT !== undefined) {
        updateData.homeScoreHT = eventDetail.homeScoreHT;
      }
      if (eventDetail.awayScoreHT !== null && eventDetail.awayScoreHT !== undefined) {
        updateData.awayScoreHT = eventDetail.awayScoreHT;
      }
      if (eventDetail.extraTimeScore !== null && eventDetail.extraTimeScore !== undefined) {
        updateData.extraTimeScore = eventDetail.extraTimeScore;
      }

      if (effectiveStatus === 'finished') {
        if (penA !== null && penB !== null && penA !== penB) {
          updateData.qualifiedSide = penA > penB ? 'A' : 'B';
        } else if (resolvedHomeScore !== resolvedAwayScore) {
          updateData.qualifiedSide = resolvedHomeScore > resolvedAwayScore ? 'A' : 'B';
        }
      } else {
        const isKnockout = match.phase === 'knockout' || match.phase === 'mata-mata' || (!!eventDetail.roundName && !eventDetail.groupName);
        if (isKnockout) {
          if (penA !== null && penB !== null && penA !== penB) {
            updateData.qualifiedSide = penA > penB ? 'A' : 'B';
          } else if (resolvedHomeScore !== resolvedAwayScore) {
            updateData.qualifiedSide = resolvedHomeScore > resolvedAwayScore ? 'A' : 'B';
          }
        }
      }

      if (statsPayload?.stats) {
        const homeStats = { ...(statsPayload.stats.home || {}) };
        const awayStats = { ...(statsPayload.stats.away || {}) };

        const incidentsList = Array.isArray(incidentsPayload?.incidents) ? incidentsPayload.incidents : [];

        const redCardsHome = incidentsList.filter(
          (i) => i?.type === 'card' && i?.is_home === true && (i?.card_type === 'red' || i?.card_type === 'yellowRed')
        ).length;
        const redCardsAway = incidentsList.filter(
          (i) => i?.type === 'card' && i?.is_home === false && (i?.card_type === 'red' || i?.card_type === 'yellowRed')
        ).length;

        homeStats.red_cards = redCardsHome;
        awayStats.red_cards = redCardsAway;

        updateData.statistics = [
          {
            home: homeStats,
            away: awayStats
          }
        ];

        updateData.possession = {
          home: safeNum(homeStats.ball_possession, 0),
          away: safeNum(awayStats.ball_possession, 0)
        };

        updateData.xg = {
          home: safeNullableNum(homeStats.xg?.actual ?? homeStats.expected_goals) ?? 0,
          away: safeNullableNum(awayStats.xg?.actual ?? awayStats.expected_goals) ?? 0
        };
      }

      if (incidentsPayload) {
        updateData.goalsDetail = [
          ...incidents.goals,
          ...incidents.cards,
          ...incidents.substitutions,
          ...incidents.timeline
        ];
      }

      if (lineupsPayload || playerStatsPayload) {
        updateData.lineups = {
          home: lineups.home,
          away: lineups.away,
          confirmed: !!lineups.confirmed
        };
        updateData.unavailable = lineups.unavailable || [];
      }

      await Match.updateOne({ _id: match._id }, { $set: updateData });

      if (effectiveStatus === 'finished' && match.status !== 'finished') {
        const tid = match.leagueId || eventDetail.leagueId || '1';

        const snapshotDate =
          match.date ||
          updateData.date ||
          eventDetail.eventDate ||
          core.eventDate ||
          gameData.event_date ||
          null;

        try {
          await recalculateAllPoints(tid);

          // pequena espera para garantir persistência no Mongo
          await new Promise(resolve => setTimeout(resolve, 3000));

          if (snapshotDate) {
            await trySaveDailyPoints(snapshotDate, tid);
          }

        } catch (e) {
          console.error('❌ [finish processing]', e.message);
        }
      }
    } catch (err) {
      console.error(`❌ [Erro jogo ${gameData?.id ?? 'unknown'}]:`, err.message);
    }
  }
}

async function updateMatches() {
  try {
    const robotSettings = await Settings.findById('league_1');
    if (!robotSettings) return;

    const allowedLeagues = Array.isArray(robotSettings.api_leagues) ? robotSettings.api_leagues.map(Number) : [];
    if (allowedLeagues.length === 0) return;

    const now = Date.now();
    const yesterday = new Date(now - 86_400_000).toISOString().split('T')[0];
    const tomorrow = new Date(now + 86_400_000).toISOString().split('T')[0];

    try {
      const liveRes = await fetchJson('/events/live/', { timeout: 10000 });
      const liveGames = Array.isArray(liveRes?.events) ? liveRes.events : [];
      await processGameList(liveGames, allowedLeagues, robotSettings, 'LIVE');
    } catch (e) {
      console.error(`❌ [LIVE]: ${e.message}`);
    }

    try {
      let nextUrl = `/events/?date_from=${yesterday}&date_to=${tomorrow}&limit=200&offset=0`;
      while (nextUrl) {
        const response = await fetchJson(nextUrl, { timeout: 15000 });
        const games = Array.isArray(response?.results) ? response.results : [];
        await processGameList(games, allowedLeagues, robotSettings, 'EVENTS');
        nextUrl = response?.next ? response.next.replace(BASE_URL, '') : null;
      }

      await Settings.findByIdAndUpdate('league_1', { $set: { last_api_run: now } });
    } catch (e) {
      console.error(`❌ [EVENTS]: ${e.message}`);
    }
  } catch (err) {
    console.error('❌ [Global]:', err);
  }
}

module.exports = updateMatches;
