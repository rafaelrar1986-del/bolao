// js/auth.js — adaptado para nova versão do backend
import { api, setToken } from './api.js';
import { $, toast } from './ui.js';

export let currentUser = null;

/** Verifica token e retorna usuário logado */
export async function verifyToken() {
  try {
    const leagueId = localStorage.getItem('selectedLeagueId');
    const res = await api.me(leagueId);
    if (res?.success && res.user) {
      currentUser = res.user;
      return currentUser;
    }
    throw new Error(res?.message || 'Sessao invalida');
  } catch (e) {
    currentUser = null;
    setToken(null);
    localStorage.removeItem('token');
    throw e;
  }
}

/** Renderiza info do usuário no header */
export function renderUserInfo() {
  const userInfo = $('#user-info');
  if (!userInfo) return;

  if (!currentUser) {
    userInfo.textContent = 'Nao autenticado';
    return;
  }

  const leagueName = localStorage.getItem('selectedLeagueName') || '';
  const adminBadge = currentUser.isAdmin ? '<span class="admin-badge">ADMIN</span>' : '';
  const leagueBadge = leagueName ? `<span class="league-badge">${leagueName}</span>` : '';

  userInfo.innerHTML = `${leagueBadge} Olá, ${currentUser.name}! ${adminBadge}`;

  // Mostra/esconde abas admin
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = currentUser.isAdmin ? '' : 'none';
  });
}

/** Faz logout limpo */
export function logout() {
  currentUser = null;
  setToken(null);
  localStorage.removeItem('token');
  localStorage.removeItem('selectedLeagueId');
  localStorage.removeItem('selectedLeagueName');
  localStorage.removeItem('regulamento_aceito');
  window.location.reload();
}

/** Liga os formulários de login/registro */
export function bindAuthForms(onLoggedIn) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  // Login
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    btn?.classList.add('loading');

    try {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      const data = await api.login(email, password);

      if (!data?.success || !data.token) {
        throw new Error(data?.message || 'Login invalido');
      }

      localStorage.setItem('token', data.token);
      setToken(data.token);
      currentUser = data.user;

      toast('Login realizado!', 'success');
      onLoggedIn(data.user);
    } catch (err) {
      // Erro 402 = paywall — não é erro de credencial
      if (err.status === 402) {
        toast('Pagamento pendente. Selecione um campeonato.', 'warning');
        onLoggedIn(null, err); // passa erro para callback tratar paywall
      } else {
        toast(err.message || 'Email ou senha invalidos', 'error');
      }
    } finally {
      btn?.classList.remove('loading');
    }
  });

  // Registro
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = registerForm.querySelector('button[type="submit"]');
    btn?.classList.add('loading');

    try {
      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;

      const data = await api.register(name, email, password);

      if (!data?.success) {
        throw new Error(data?.message || 'Erro no cadastro');
      }

      toast('Conta criada! Faca login.', 'success');
      registerForm.reset();

      // Volta para aba de login
      const loginTab = document.querySelector('[data-target="login"]');
      loginTab?.click();
    } catch (err) {
      toast(err.message || 'Erro ao criar conta', 'error');
    } finally {
      btn?.classList.remove('loading');
    }
  });
}