import { API_BASE_URL } from './config.js';

let TOKEN = localStorage.getItem('token') || null;
export function setToken(t){ TOKEN = t; if(t){ localStorage.setItem('token', t);} else { localStorage.removeItem('token'); } }

async function request(path, opts = {}){
  const headers = opts.headers ? {...opts.headers} : {};
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  if(TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(`${API_BASE_URL}${path}`, { ...opts, headers });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.message || 'Erro na requisição');
  return data;
}

export const api = {
  // auth
  me(){ return request('/api/auth/me'); },
  login(body){ return request('/api/auth/login', { method:'POST', body: JSON.stringify(body) }); },
  register(body){ return request('/api/auth/register', { method:'POST', body: JSON.stringify(body) }); },

  // matches
  listMatches(){ return request('/api/matches'); },
  adminAll(){ return request('/api/matches/admin/all'); },
  adminAdd(body){ return request('/api/matches/admin/add', { method:'POST', body: JSON.stringify(body) }); },
  adminFinish(id, body){ return request(`/api/matches/admin/finish/${id}`, { method:'POST', body: JSON.stringify(body) }); },

  // bets
  myBets(){ return request('/api/bets/my-bets'); },
  saveBets(body){ return request('/api/bets/save', { method:'POST', body: JSON.stringify(body) }); },
  leaderboard(){ return request('/api/bets/leaderboard'); },

  // all-bets
  allBets(params){ 
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/api/bets/all-bets${qs ? ('?'+qs) : ''}`);
  },
  matchesForFilter(){ return request('/api/bets/matches-for-filter'); },
  usersForFilter(){ return request('/api/bets/users-for-filter'); },

  // points
  recalcAll(){ return request('/api/points/recalculate-all', { method:'POST' }); },
  integrityCheck(){ return request('/api/points/integrity-check'); },
  processPodium(body){ return request('/api/points/process-podium', { method:'POST', body: JSON.stringify(body) }); }
}
