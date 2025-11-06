
import { apiPost, apiGet, setToken } from './api.js';

export let currentUser = null;

export async function doLogin(email, password){
  const data = await apiPost('/api/auth/login', { email, password }, false);
  setToken(data.token);
  currentUser = data.user;
  return currentUser;
}
export async function doRegister(name, email, password){
  return apiPost('/api/auth/register', { name, email, password }, false);
}
export async function loadMe(){
  try{
    const me = await apiGet('/api/auth/me', true);
    currentUser = me.user;
    return currentUser;
  }catch(e){
    currentUser = null;
    return null;
  }
}
export function logout(){
  setToken(null);
  currentUser = null;
}
