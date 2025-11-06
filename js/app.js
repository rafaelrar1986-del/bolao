// js/app.js
// Bootstrap da SPA: autenticação, tabs, exibição condicional de Admin e init dos módulos

import { api, setToken } from './api.js';
import { toast, showTab } from './ui.js';
import { initMatches } from './matches.js';
import { initRanking } from './ranking.js';
import { initMyBets } from './myBets.js';
import { initAllBets } from './allBets.js';
import { initAdmin } from './admin.js';

// Estado global simples
let currentUser = null;

// Elementos
const $loginSection = () => document.getElementById('login-section');
const $appSection = () => document.getElementById('app-section');
const $adminTab = () => document.getElementById('admin-tab');
const $userInfo = () => document.getElementById('user-info');

// ======== Helpers ========
function applyTokenFromStorage() {
  const token = localStorage.getItem('token');
  if (token) setToken(token);
  return token;
}

async function fetchMe() {
  try {
    const me = await api.get('/api/auth/me');
    if (me && me.success && me.user) return me.user;
  } catch (err) {
    // token inválido ou expirado
  }
  return null;
}

function renderUserInfo() {
  if (!$userInfo()) return;
  const badge = currentUser?.isAdmin
    ? '<span class="admin-badge">ADMIN</span>'
    : '';
  $userInfo().innerHTML = `Olá, ${currentUser?.name || 'usuário'}! ${badge}`;
}

function toggleAdminTab() {
  if (!$adminTab()) return;
  $adminTab().style.display = currentUser?.isAdmin ? 'block' : 'none';
}

// ======== Tabs ========
function wireTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      showTab(tabName);

      // carregamentos on-demand por aba
      if (tabName === 'ranking') {
        // ranking se atualiza dentro do módulo ao abrir
      } else if (tabName === 'my-bets') {
        // meus palpites idem
      } else if (tabName === 'admin' && currentUser?.isAdmin) {
        // admin atualiza dentro do módulo
      } else if (tabName === 'stats') {
        // se houver stats, seu módulo chamará
      } else if (tabName === 'all-bets') {
        // todos os palpites já lida no módulo
      }
    });
  });
}

// ======== Auth (login/register) ========
function wireAuthForms() {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      try {
        const res = await api.post('/api/auth/login', { email, password });
        if (!res.success || !res.token || !res.user) {
          throw new Error(res.message || 'Login inválido');
        }
        localStorage.setItem('token', res.token);
        setToken(res.token);
        currentUser = res.user;
        afterLogin();
      } catch (err) {
        console.error(err);
        toast(err.message || 'Erro no login', 'error');
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;

      try {
        const res = await api.post('/api/auth/register', { name, email, password });
        if (!res.success) throw new Error(res.message || 'Erro no cadastro');
        toast('Conta criada! Faça login.', 'success');
        registerForm.reset();
      } catch (err) {
        console.error(err);
        toast(err.message || 'Erro no cadastro', 'error');
      }
    });
  }
}

// ======== Fluxo pós login ========
function afterLogin() {
  // mostra app
  if ($loginSection()) $loginSection().style.display = 'none';
  if ($appSection()) $appSection().style.display = 'block';

  // mostra/esconde admin
  toggleAdminTab();
  renderUserInfo();

  // inicializa módulos
  initMatches();
  initRanking();
  initMyBets();
  initAllBets();

  if (currentUser?.isAdmin) {
    initAdmin();
  }

  // permanece na aba atual ou vai para "Fazer Palpites"
  showTab(document.querySelector('.tab.active')?.dataset?.tab || 'bets');
}

// ======== Init principal ========
export async function initApp() {
  wireAuthForms();
  wireTabs();

  // Tenta autenticar pelo token salvo
  const token = applyTokenFromStorage();
  if (token) {
    const me = await fetchMe();
    if (me) {
      currentUser = me;
      afterLogin();
      return;
    } else {
      // token inválido → limpa
      localStorage.removeItem('token');
      setToken(null);
    }
  }

  // Sem auth → mostra login
  if ($loginSection()) $loginSection().style.display = 'block';
  if ($appSection()) $appSection().style.display = 'none';
}

// Auto-bootstrap como fallback (evita erro se o HTML esquecer de chamar initApp)
document.addEventListener('DOMContentLoaded', () => {
  // não precisa aguardar nada do HTML, o módulo cuida de tudo
  initApp();
});

// (Opcional) Expor currentUser se precisar em outros módulos
export function getCurrentUser() {
  return currentUser;
}
