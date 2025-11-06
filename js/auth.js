import { api, setToken, clearToken } from './api.js';
import { $, toast } from './ui.js';

export let currentUser = null;
export async function verifyToken(){
  try{
    const res = await api.me();
    currentUser = res.user;
    return currentUser;
  }catch(e){
    currentUser = null;
    clearToken();
    throw e;
  }
}

export function renderUserInfo(){
  const userInfo = $('#user-info');
  if(!currentUser){ userInfo.textContent = 'Não autenticado'; return; }
  const adminBadge = currentUser.isAdmin ? '<span class="admin-badge">ADMIN</span>' : '';
  userInfo.innerHTML = `Olá, ${currentUser.name}! ${adminBadge}`;
  const adminTab = document.getElementById('admin-tab');
  adminTab.style.display = currentUser.isAdmin ? 'inline-block':'none';
}

export function bindAuthForms(onLoggedIn){
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try{
      const data = await api.login(email,password);
      setToken(data.token);
      currentUser = data.user;
      toast('success','Login realizado!');
      onLoggedIn();
    }catch(err){ toast('error', 'Erro no login: '+err.message); }
  });

  registerForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    try{
      await api.register(name,email,password);
      toast('success','Conta criada! Faça login.');
      registerForm.reset();
    }catch(err){ toast('error','Erro no registro: '+err.message); }
  });
}
