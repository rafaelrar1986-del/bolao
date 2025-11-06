import { API_BASE_URL } from './config.js';

export function getToken(){ return localStorage.getItem('token'); }
export function setToken(t){ localStorage.setItem('token', t); }
export function clearToken(){ localStorage.removeItem('token'); }

async function request(path, { method='GET', headers={}, body } = {}){
  const opts = { method, headers: { 'Content-Type':'application/json', ...headers } };
  const token = getToken();
  if(token) opts.headers['Authorization'] = `Bearer ${token}`;
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE_URL}${path}`, opts);
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  login: (email,password)=>request('/api/auth/login',{method:'POST',body:{email,password}}),
  register: (name,email,password)=>request('/api/auth/register',{method:'POST',body:{name,email,password}}),
  me: ()=>request('/api/auth/me'),

  // matches
  listMatches: ()=>request('/api/matches'),
  adminAll: ()=>request('/api/matches/admin/all'),
  adminAdd: (payload)=>request('/api/matches/admin/add',{method:'POST',body:payload}),
  adminEdit: (id, payload)=>request(`/api/matches/admin/edit/${id}`,{method:'PUT',body:payload}),
  adminFinish: (id, payload)=>request(`/api/matches/admin/finish/${id}`,{method:'POST',body:payload}),

  // bets
  myBets: ()=>request('/api/bets/my-bets'),
  saveBets: (payload)=>request('/api/bets/save',{method:'POST',body:payload}),
  leaderboard: ()=>request('/api/bets/leaderboard'),
  betsStatus: ()=>request('/api/bets/status'),

  // all bets
  allBets: (params)=>{
    const q = new URLSearchParams(params || {}).toString();
    return request(`/api/bets/all-bets${q ? ('?'+q): ''}`);
  },
  matchesForFilter: ()=>request('/api/bets/matches-for-filter'),
  usersForFilter: ()=>request('/api/bets/users-for-filter'),

  // points
  pointsStats: ()=>request('/api/points/stats'),
  processPodium:(podium)=>request('/api/points/process-podium',{method:'POST',body:podium}),
  recalcAll: ()=>request('/api/points/recalculate-all',{method:'POST'}),
  integrity: ()=>request('/api/points/integrity-check'),

};
