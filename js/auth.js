import { api, setToken } from './api.js';
import { notify } from './ui.js';

export let currentUser = null;

export async function initAuth(){
  const token = localStorage.getItem('token');
  if(token){
    try {
      const res = await api.me();
      currentUser = res.user;
    } catch(e){
      localStorage.removeItem('token');
    }
  }
}

export function bindAuthForms(onAuthenticated){
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');

  loginForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();
    try{
      const res = await api.login({ email, password });
      setToken(res.token);
      currentUser = res.user;
      onAuthenticated();
    }catch(err){
      notify('error', 'Erro no login: ' + err.message);
    }
  });

  regForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value.trim();
    try{
      await api.register({ name, email, password });
      notify('success','Conta criada! Faça login.');
      regForm.reset();
    }catch(err){
      notify('error', 'Erro no registro: ' + err.message);
    }
  });
}
