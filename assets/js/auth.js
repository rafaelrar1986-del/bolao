
// auth.js (module)
import { login, registerUser, me } from './api.js';
import { show, hide } from './utils.js';

export let currentUser = null;
export let isAdmin = false;

export async function verifyToken() {
  const token = localStorage.getItem('token');
  if (!token) return false;
  try {
    const data = await me();
    currentUser = data.user;
    isAdmin = !!currentUser.isAdmin;
    return true;
  } catch (e) {
    localStorage.removeItem('token');
    return false;
  }
}

export function setupAuthUI({ onLoggedIn }) {
  const loginSection = document.getElementById('login-section');
  const appSection = document.getElementById('app-section');
  const userInfo = document.getElementById('user-info');
  const adminTab = document.getElementById('admin-tab');

  const showApp = () => {
    hide(loginSection);
    show(appSection);
    userInfo.innerHTML = `Olá, ${currentUser.name}! ${isAdmin ? '<span class="badge">ADMIN</span>' : ''}`;
    adminTab.style.display = isAdmin ? 'inline-block' : 'none';
    onLoggedIn();
  };

  document.getElementById('login-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const data = await login(email, password);
      localStorage.setItem('token', data.token);
      currentUser = data.user;
      isAdmin = !!currentUser.isAdmin;
      showApp();
    } catch (err) {
      alert('Erro no login: ' + err.message);
    }
  });

  document.getElementById('register-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    try {
      await registerUser(name, email, password);
      alert('Conta criada! Agora faça login.');
      e.target.reset();
    } catch (err) {
      alert('Erro no registro: ' + err.message);
    }
  });

  return { showApp };
}
