
import { API_BASE_URL } from './config.js';

let token = localStorage.getItem('token') || null;
export function setToken(t){ token = t; if(t) localStorage.setItem('token', t); else localStorage.removeItem('token'); }

export async function apiGet(path, auth=false){
  const headers = {'Content-Type':'application/json'};
  if(auth && token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  if(!res.ok) throw await res.json().catch(()=>({message:'Erro'}));
  return res.json();
}
export async function apiPost(path, body, auth=false){
  const headers = {'Content-Type':'application/json'};
  if(auth && token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, { method:'POST', headers, body: JSON.stringify(body||{}) });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw data;
  return data;
}
export async function apiPut(path, body, auth=false){
  const headers = {'Content-Type':'application/json'};
  if(auth && token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, { method:'PUT', headers, body: JSON.stringify(body||{}) });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw data;
  return data;
}
export async function apiDelete(path, auth=false){
  const headers = {'Content-Type':'application/json'};
  if(auth && token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, { method:'DELETE', headers });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw data;
  return data;
}
