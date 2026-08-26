// api.js (v2 — alinhado com backend: suporte a 423 STATS_LOCKED e 402 Payment Required)
import { API_BASE_URL } from './config.js';

let TOKEN = null;

export function setToken(t) {
  TOKEN = t || null;
}

/**
 * Função base para requisições
 */
async function request(method, path, body) {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

  // Detecta se o corpo é um FormData (para envios com arquivos/comprovantes)
  const isFormData = body instanceof FormData;

  const headers = {};

  // Só define Content-Type como JSON se NÃO for um formulário
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  const res = await fetch(url, {
    method,
    headers,
    body: isFormData ? body : (body != null ? JSON.stringify(body) : undefined),
  });

  let data;
  try {
    data = await res.json();
  } catch (_) {
    // caso o backend retorne vazio ou não seja JSON
    data = { success: res.ok };
  }

  // --- TRATAMENTO DE ERROS ---
  if (!res.ok || data?.success === false) {
    const msg = data?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;

    // FLAG DE PAGAMENTO: Se o status for 402, marcamos o erro
    // para que o frontend saiba que deve exibir o Paywall (QR Code).
    if (res.status === 402) {
      err.requiresPayment = true;
    }

    // FLAG DE BLOQUEIO DE ESTATÍSTICAS: Se o status for 423, marcamos
    // para que o frontend saiba que deve exibir a tela de bloqueio.
    if (res.status === 423) {
      err.isStatsLocked = true;
      err.lockedReason = data?.reason || 'STATS_LOCKED';
    }

    throw err;
  }

  return data;
}

export const api = {
  // Verbos genéricos
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path, body) => request('DELETE', path, body),

  // ================================================================
  // 🔑 AUTHENTICATION
  // ================================================================
  login: (email, password) =>
    request('POST', '/api/auth/login', { email, password }),
  register: (name, email, password) =>
    request('POST', '/api/auth/register', { name, email, password }),
  me: () => request('GET', '/api/auth/me'),
  updateMyAvatar: (avatar) =>
    request('PUT', '/api/auth/me/avatar', { avatar }),

  // ================================================================
  // 🔐 WHITELIST
  // ================================================================
  getWhitelist: () => request('GET', '/api/auth/whitelist'),
  addWhitelist: (email) => request('POST', '/api/auth/whitelist', { email }),
  removeWhitelist: (email) => request('DELETE', `/api/auth/whitelist/${email}`),

  // ================================================================
  // 💰 ADMIN: USUÁRIOS & PAGAMENTOS
  // ================================================================
  getAdminUsers: (leagueId) =>
    request('GET', `/api/admin/users?leagueId=${encodeURIComponent(leagueId || '')}`),
  approvePayment: (userId, leagueId) =>
    request('PUT', `/api/admin/approve-user/${userId}`, { leagueId }),
  getLeagueAccess: (leagueId) =>
    request('GET', `/api/auth/league-access?leagueId=${encodeURIComponent(leagueId || '')}`),
  selectLeague: (leagueId, leagueName) =>
    request('POST', '/api/auth/league-access/select', { leagueId, leagueName }),
  getSecurityStats: () =>
    request('GET', '/api/admin/security-stats'),

  // ================================================================
  // 📧 ADMIN: EMAIL BROADCAST
  // ================================================================
  sendEmailBroadcast: (formData) =>
    request('POST', '/api/admin/send', formData),

  // ================================================================
  // 🤖 ADMIN: ROBÔ
  // ================================================================
  getRobotAvailableLeagues: () =>
    request('GET', '/api/admin/robot/available-leagues'),
  syncRobot: (payload) =>
    request('POST', '/api/admin/robot/sync', payload),

  // ================================================================
  // 🎯 BETS (Protegidas por checkPaid no Backend)
  // ================================================================
  saveBets: (payload) => request('POST', '/api/bets/save', payload),
  myBets: (leagueId) => request('GET', `/api/bets/my-bets?leagueId=${leagueId || '1'}`),
  status: () => request('GET', '/api/bets/status'),
  saveSingleBet: (payload) => request('POST', '/api/bets/single', payload),

  // ================================================================
  // 🏆 RANKING & LEADERBOARD
  // ================================================================
  leaderboard: (leagueId, type) => {
    let url = `/api/bets/leaderboard?leagueId=${leagueId || '1'}`;
    if (type) url += `&type=${type}`;
    return request('GET', url);
  },

  // ================================================================
  // 👁️ ALL-BETS / FILTROS
  // ================================================================
  allBets: (params = {}) => {
    const qp = new URLSearchParams(params).toString();
    const suffix = qp ? `?${qp}` : '';
    return request('GET', `/api/bets/all-bets${suffix}`);
  },
  matchesForFilter: (leagueId) => {
    let url = '/api/bets/matches-for-filter';
    if (leagueId) url += `?leagueId=${leagueId}`;
    return request('GET', url);
  },
  usersForFilter: (leagueId) => {
    let url = '/api/bets/users-for-filter';
    if (leagueId) url += `?leagueId=${leagueId}`;
    return request('GET', url);
  },

  // ================================================================
  // ⚙️ ADMIN: MATCHES
  // ================================================================
  listMatchesAdmin: (leagueId) => {
    let url = '/api/matches/admin/all';
    if (leagueId) url += `?leagueId=${leagueId}`;
    return request('GET', url);
  },
  addMatch: (payload) => request('POST', '/api/matches/admin/add', payload),
  editMatch: (matchId, payload) =>
    request('PUT', `/api/matches/admin/edit/${matchId}`, payload),
  finishMatch: (matchId, payload) =>
    request('POST', `/api/matches/admin/finish/${matchId}`, payload),
  unfinishMatchBulk: (payload) =>
    request('POST', '/api/matches/admin/unfinish-bulk', payload),
  deleteMatchBulk: (payload) =>
    request('DELETE', '/api/matches/admin/delete-bulk', payload),

  // ================================================================
  // 🏆 PUBLIC MATCHES
  // ================================================================
  listMatches: (leagueId) => {
    if (leagueId == null || String(leagueId).trim() === '') {
      throw new Error('leagueId é obrigatório para listar partidas');
    }
    return request(
      'GET',
      `/api/matches?leagueId=${encodeURIComponent(String(leagueId).trim())}`
    );
  },
  getMatchRules: (leagueId) => {
    if (leagueId == null || String(leagueId).trim() === '') {
      throw new Error('leagueId é obrigatório para regras da partida');
    }
    return request('GET', `/api/matches/rules/${encodeURIComponent(String(leagueId).trim())}`);
  },
  getMatchTechnical: (matchId, leagueId) => {
    if (leagueId == null || String(leagueId).trim() === '') {
      throw new Error('leagueId é obrigatório para dados técnicos da partida');
    }
    return request(
      'GET',
      `/api/matches/match-technical/${encodeURIComponent(String(matchId))}?leagueId=${encodeURIComponent(String(leagueId).trim())}`
    );
  },

  // ================================================================
  // 📊 POINTS / PODIUM
  // ================================================================
  setPodium: (first, second, third, fourth) =>
    request('POST', '/api/points/process-podium', {
      first,
      second,
      third,
      fourth,
    }),
  getOfficialPodium: (leagueId) => {
    let url = '/api/points/podium';
    if (leagueId) url += `?leagueId=${leagueId}`;
    return request('GET', url);
  },
  recalcAll: () => request('POST', '/api/points/recalculate-all', {}),
  integrityCheck: (leagueId) => {
    let url = '/api/points/integrity-check';
    if (leagueId) url += `?leagueId=${leagueId}`;
    return request('GET', url);
  },

  // ================================================================
  // ⚠️ ADMIN: RESET
  // ================================================================
  resetAllBets: (leagueId) =>
    request('POST', '/api/bets/admin/reset-all', { leagueId }),

  // ================================================================
  // 🌐 GLOBAL SETTINGS
  // ================================================================
  getSettings: (leagueId) =>
    request('GET', `/api/settings/global?leagueId=${leagueId || '1'}`),

  updateSettings: (payload) =>
    request('POST', '/api/settings/global', payload),

  // ================================================================
  // 👤 USERS
  // ================================================================
  getUserProfile: (userId) =>
    request('GET', `/api/users/${userId}/profile`),

  // ================================================================
  // 📰 NEWS
  // ================================================================
  createNews: (payload) => request('POST', '/api/news', payload),
  getNews: (leagueId) => request('GET', `/api/news?leagueId=${leagueId || '1'}`),
  reactNews: (messageId, emoji) =>
    request('POST', `/api/news/${messageId}/react`, { emoji }),

  // ================================================================
  // 📈 POINTS HISTORY
  // ================================================================
  getPointsHistoryUsers: () =>
    request('GET', '/api/points-history/users/list'),
  getPointsHistoryRanking: (leagueId) =>
    request('GET', `/api/points-history/ranking?leagueId=${encodeURIComponent(leagueId)}`),
  comparePointsHistory: (userId, otherUserId, leagueId) =>
    request('GET', `/api/points-history/compare/${userId}?otherUserId=${encodeURIComponent(otherUserId)}&leagueId=${encodeURIComponent(leagueId)}`),
  getUserPointsHistory: (userId, leagueId) =>
    request('GET', `/api/points-history/${userId}?leagueId=${encodeURIComponent(leagueId)}`),
  getUserRankingHistory: (userId, leagueId) =>
    request('GET', `/api/points-history/ranking/${userId}?leagueId=${encodeURIComponent(leagueId)}`),
  getTickerHighlights: (leagueId) =>
    request('GET', `/api/points-history/ticker/highlights?leagueId=${encodeURIComponent(leagueId)}`),

  // ================================================================
  // 🏟️ GROUPS
  // ================================================================
  getGroupStandings: (leagueId, live) => {
    let url = `/api/groups/standings?leagueId=${leagueId || '1'}`;
    if (live) url += '&live=true';
    return request('GET', url);
  },
  getKnockoutMatches: (leagueId) =>
    request('GET', `/api/groups/knockout?leagueId=${leagueId || '1'}`),

  // ================================================================
  // ⚔️ DUELS
  // ================================================================
  getDuels: (userId, leagueId) =>
    request('GET', `/api/duels/${userId}?leagueId=${leagueId || '1'}`),

  // ================================================================
  // 🌐 PUBLIC
  // ================================================================
  getActiveLeagues: () =>
    request('GET', '/api/public/active-leagues'),

  // ================================================================
  // 🔐 ACESSO ADICIONAL
  // ================================================================
  moreAccess: () => request('GET', '/api/bets/more-access'),
};