
// api.js (module)
const BASE = window.API_URL;

export async function api(path, opts = {}, useAuth = false) {
  const headers = {"Content-Type":"application/json"};
  const token = localStorage.getItem('token');
  if (useAuth && token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers
  });
  let data = {}
  try { data = await res.json(); } catch(e) { data = {}; }
  if (!res.ok) throw new Error(data.message || 'Erro na requisição');
  return data;
}

export const login = (email, password) => api('/api/auth/login', { method:'POST', body: JSON.stringify({email,password}) });
export const registerUser = (name,email,password) => api('/api/auth/register', { method:'POST', body: JSON.stringify({name,email,password}) });
export const me = () => api('/api/auth/me', {}, true);

export const getMatches = () => api('/api/matches');
export const getLeaderboard = () => api('/api/bets/leaderboard', {}, true);
export const getMyBets = () => api('/api/bets/my-bets', {}, true);
export const getBetStatus = () => api('/api/bets/status', {}, true);
export const saveBetsApi = (payload) => api('/api/bets/save', { method:'POST', body: JSON.stringify(payload) }, true);

export const getMatchesForFilter = () => api('/api/bets/matches-for-filter', {}, true);
export const getUsersForFilter = () => api('/api/bets/users-for-filter', {}, true);

export function getAllBets(params={}) {
  const q = new URLSearchParams(params);
  return api('/api/bets/all-bets?'+q.toString(), {}, true);
}

export const getPointsStats = () => api('/api/points/stats', {}, true);
