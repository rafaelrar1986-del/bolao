import { getLeagueLogoUrl } from './leagueLogo.js';
import { API_BASE_URL } from './config.js';

/* =====================
   Forgot password API
===================== */
async function forgotPassword(email) {
  const r = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message);
  return d;
}

async function resetPassword(email, recoveryCode, newPassword) {
  const r = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, recoveryCode, newPassword })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message);
  return d;
}

/* =====================
   Imports SPA
===================== */
import { api, setToken } from './api.js';
import { buildChampionshipRulesContent } from './championshipRulesView.js';

// Stubs para modulos que podem nao existir na nova versao
let initAuthTabs = () => {};
try { const m = await import('./auth-tabs.js'); initAuthTabs = m.initAuthTabs || initAuthTabs; } catch(e) {}

let toast = (msg, type = 'info') => {
  console.log(`[${type.toUpperCase()}]`, msg);
  const existing = document.getElementById('toast-container');
  if (!existing) {
    const div = document.createElement('div');
    div.id = 'toast-container';
    div.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(div);
  }
  const el = document.createElement('div');
  const colors = { success: '#2ecc71', error: '#e74c3c', warning: '#f39c12', info: '#3498db' };
  el.style.cssText = `background:${colors[type] || colors.info};color:#fff;padding:12px 20px;border-radius:8px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideIn 0.3s ease;max-width:320px;`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(100%)'; setTimeout(() => el.remove(), 300); }, 4000);
};
try { const m = await import('./ui.js'); if (m.toast) toast = m.toast; } catch(e) {}

let showTab = (tab) => {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`tab-${tab}`) || document.getElementById(tab);
  if (target) target.classList.add('active');
};
try { const m = await import('./ui.js'); if (m.showTab) showTab = m.showTab; } catch(e) {}

let showPaywall = () => {
  let pw = document.getElementById('paywall-wrapper');
  if (!pw) {
    pw = document.createElement('div');
    pw.id = 'paywall-wrapper';
    pw.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99998;display:flex;align-items:center;justify-content:center;';
    pw.innerHTML = `
      <div style="background:#1a1a1a;padding:40px;border-radius:16px;text-align:center;max-width:400px;color:#fff;">
        <h2 style="margin-bottom:16px;">Acesso Bloqueado</h2>
        <p style="color:#aaa;margin-bottom:24px;">Efetue o pagamento da cota para liberar o acesso completo ao bolao.</p>
        <button onclick="location.reload()" style="background:#e74c3c;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-weight:700;cursor:pointer;">Atualizar Pagamento</button>
      </div>`;
    document.body.appendChild(pw);
  }
  document.body.style.overflow = 'hidden';
};
try { const m = await import('./ui.js'); if (m.showPaywall) showPaywall = m.showPaywall; } catch(e) {}

let initMatches, updateMatchDom, getMissingGroupBets, getMissingGroupQualificationBets, getMissingExtrasBets, getMissingKnockoutQualifiers, buildSavePayload, saveLocalDraft, clearLocalDraft, markKnockoutGroupAsSaved, getKnockoutGroupByMatchId;
try {
  const m = await import('./matches4.js?v=1.16-accordion-preserve-all');
  initMatches = m.initMatches;
  updateMatchDom = m.updateMatchDom;
  getMissingGroupBets = m.getMissingGroupBets;
  getMissingGroupQualificationBets = m.getMissingGroupQualificationBets;
  getMissingExtrasBets = m.getMissingExtrasBets;
  getMissingKnockoutQualifiers = m.getMissingKnockoutQualifiers;
  buildSavePayload = m.buildSavePayload;
  saveLocalDraft = m.saveLocalDraft;
  clearLocalDraft = m.clearLocalDraft;
  markKnockoutGroupAsSaved = m.markKnockoutGroupAsSaved;
  getKnockoutGroupByMatchId = m.getKnockoutGroupByMatchId;
} catch(e) {
  console.warn('matches4.js nao carregado:', e.message);
  initMatches = async () => {};
  updateMatchDom = () => {};
  getMissingGroupBets = () => [];
  getMissingGroupQualificationBets = () => [];
  getMissingExtrasBets = () => [];
  getMissingKnockoutQualifiers = () => [];
  buildSavePayload = () => ({ groupMatches: {}, podium: [], extras: {} });
  saveLocalDraft = () => false;
  clearLocalDraft = () => {};
  markKnockoutGroupAsSaved = () => {};
  getKnockoutGroupByMatchId = () => null;
}

let initRanking, preloadRanking;
try { const m = await import('./ranking2.js?v=1.09'); initRanking = m.initRanking; preloadRanking = m.preloadRanking; } catch(e) {
  initRanking = () => {}; preloadRanking = () => {};
}

let initNewsTicker = () => {};
try { const m = await import('./newsTicker.js'); initNewsTicker = m.initNewsTicker; } catch(e) {}

let initNewsWall = () => {};
try { const m = await import('./newsWall.js'); initNewsWall = m.initNewsWall; } catch(e) {}

let initMyBets = () => {};
try { const m = await import('./myBets1.js?v=1.13'); initMyBets = m.initMyBets; } catch(e) {}

let initAllBets = () => {};
try { const m = await import('./allBets.js?v=1.13'); initAllBets = m.initAllBets; } catch(e) {}

let initAdmin, enterAdminPanel, loadGlobalSaveLocks, isSaveBetsBlocked, isRequireAllBetsEnabled;
try {
  const m = await import('./admin.js?v=1.23');
  initAdmin = m.initAdmin;
  enterAdminPanel = m.enterAdminPanel;
  loadGlobalSaveLocks = m.loadGlobalSaveLocks;
  isSaveBetsBlocked = m.isSaveBetsBlocked;
  isRequireAllBetsEnabled = m.isRequireAllBetsEnabled;
} catch(e) {
  initAdmin = () => {};
  enterAdminPanel = async () => {};
  loadGlobalSaveLocks = async () => {};
  isSaveBetsBlocked = () => false;
  isRequireAllBetsEnabled = () => false;
}

let initStats = () => Promise.resolve();
try { const m = await import('./stats.js'); initStats = m.initStats; } catch(e) {}

let initProfile = () => {};
try { const m = await import('./profile.js'); initProfile = m.initProfile; } catch(e) {}

let initUserProfile = () => {};
try { const m = await import('./userProfile.js?v=1.06'); initUserProfile = m.initUserProfile; } catch(e) {}

let ClassificacaoPage = () => {};
try { const m = await import('./classf.js'); ClassificacaoPage = m.default || ClassificacaoPage; } catch(e) {}

let flagEmoji = (team) => {
  const map = {
    'brasil': '🇧🇷', 'brazil': '🇧🇷', 'argentina': '🇦🇷', 'franca': '🇫🇷', 'france': '🇫🇷',
    'alemanha': '🇩🇪', 'germany': '🇩🇪', 'espanha': '🇪🇸', 'spain': '🇪🇸', 'italia': '🇮🇹',
    'italy': '🇮🇹', 'portugal': '🇵🇹', 'inglaterra': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'england': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'holanda': '🇳🇱', 'netherlands': '🇳🇱', 'belgica': '🇧🇪', 'belgium': '🇧🇪',
    'croacia': '🇭🇷', 'croatia': '🇭🇷', 'uruguai': '🇺🇾', 'uruguay': '🇺🇾',
    'colombia': '🇨🇴', 'equador': '🇪🇨', 'ecuador': '🇪🇨', 'chile': '🇨🇱',
    'paraguai': '🇵🇾', 'paraguay': '🇵🇾', 'bolivia': '🇧🇴', 'peru': '🇵🇪',
    'venezuela': '🇻🇪', 'mexico': '🇲🇽', 'eua': '🇺🇸', 'usa': '🇺🇸',
    'canada': '🇨🇦', 'japao': '🇯🇵', 'japan': '🇯🇵', 'coreia': '🇰🇷',
    'korea': '🇰🇷', 'australia': '🇦🇺', 'irã': '🇮🇷', 'iran': '🇮🇷',
    'arabia': '🇸🇦', 'saudi': '🇸🇦', 'qatar': '🇶🇦', 'marrocos': '🇲🇦',
    'morocco': '🇲🇦', 'senegal': '🇸🇳', 'tunisia': '🇹🇳', 'gana': '🇬🇭',
    'ghana': '🇬🇭', 'camaroes': '🇨🇲', 'cameroon': '🇨🇲', 'polonia': '🇵🇱',
    'poland': '🇵🇱', 'servia': '🇷🇸', 'serbia': '🇷🇸', 'suica': '🇨🇭',
    'switzerland': '🇨🇭', 'dinamarca': '🇩🇰', 'denmark': '🇩🇰', 'succia': '🇸🇪',
    'sweden': '🇸🇪', 'noruega': '🇳🇴', 'norway': '🇳🇴', 'ucrania': '🇺🇦',
    'ukraine': '🇺🇦', 'austria': '🇦🇹', 'tcheca': '🇨🇿', 'czech': '🇨🇿',
    'hungria': '🇭🇺', 'hungary': '🇭🇺', 'romenia': '🇷🇴', 'romania': '🇷🇴',
    'turquia': '🇹🇷', 'turkey': '🇹🇷', 'grecia': '🇬🇷', 'greece': '🇬🇷',
    'russia': '🇷🇺', 'pais de gales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    'escocia': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'irlanda': '🇮🇪',
    'ireland': '🇮🇪', 'finlandia': '🇫🇮', 'finland': '🇫🇮'
  };
  const key = String(team || '').toLowerCase().trim();
  return map[key] || '🏳️';
};
try { const m = await import('./flags.js'); if (m.flagEmoji) flagEmoji = m.flagEmoji; } catch(e) {}

/* =====================
   Estado global
===================== */
let currentUser = null;
window.currentUser = null;
let rankingInitialized = false;
let isInitialLoading = true;

/* =====================
   Logica de Protecao (Paywall)
===================== */
function verificarBloqueio(err) {
  if (!err || err.status !== 402) {
    if (err?.message) console.error("Erro de API:", err.message);
    return;
  }
  const isAdmin = window.currentUser?.isAdmin === true;

  // Um 402 vindo do backend é a autoridade sobre o acesso atual. Não usamos
  // currentLeaguePaid em memória aqui, pois o Admin pode ter desaprovado o
  // pagamento enquanto o usuário ainda estava com a sessão aberta.
  if (isAdmin) {
    const paywall = document.getElementById('paywall-wrapper');
    if (paywall) paywall.remove();
    document.body.style.overflow = '';
    return;
  }
  if (!isInitialLoading) showPaywall();
}

/* =====================
   Helpers DOM
===================== */
const $loginSection = () => document.getElementById('login-section');
const $appSection   = () => document.getElementById('app-section');
const $leagueSection = () => document.getElementById('league-selection-section');
const $userInfo     = () => document.getElementById('user-info');

function getTimeRemaining(dateString) {
  if (!dateString) return "Indefinido";
  const total = Date.parse(dateString) - Date.parse(new Date());
  if (total <= 0) return "Fechado";
  const minutes = Math.floor((total / 1000 / 60) % 60);
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes}m`;
}

/* =====================
   REGULAMENTO MODAL
===================== */
async function initRegulamentoModal() {
  const old = document.getElementById('modal-regulamento');
  if (old) old.remove();

  const leagueId = localStorage.getItem('selectedLeagueId') || '';
  const leagueName = localStorage.getItem('selectedLeagueName') || 'este campeonato';

  let rulesData = {};
  try {
    if (leagueId) {
      const res = await api.getMatchRules(leagueId);
      rulesData = res?.data || {};
    }
  } catch (err) {
    console.warn('Não foi possível carregar as regras do campeonato:', err);
  }

  const view = buildChampionshipRulesContent(rulesData, { includeHelp: false });

  const modalHTML = `
    <div id="modal-regulamento" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:999999;align-items:center;justify-content:center;padding:20px;">
      <div style="background:#fff;padding:30px;max-width:600px;width:100%;border-radius:12px;color:#333;text-align:left;max-height:85vh;overflow-y:auto;">
        <h2 style="text-align:center;margin-top:0;">REGULAMENTO OFICIAL</h2>
        <div style="text-align:center;font-size:13px;color:#777;margin-bottom:14px;">
          ${String(leagueName).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
        </div>

        <div style="font-size:14px;line-height:1.6;margin:20px 0;">
          ${view.html}
          <p><strong>PRAZOS:</strong> as apostas devem ser realizadas antes do bloqueio definido para cada partida/fase. Aposta não realizada = 0 pontos.</p>
        </div>

        <button id="btn-concordo" style="display:block;width:100%;padding:12px 30px;background:#4caf50;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:bold;">
          Li e estou ciente
        </button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  document.getElementById('btn-concordo').onclick = () => {
    const accepted = JSON.parse(
      localStorage.getItem('regulamento_aceito_por_liga') || '{}'
    );
    accepted[String(leagueId)] = true;
    localStorage.setItem('regulamento_aceito_por_liga', JSON.stringify(accepted));
    document.getElementById('modal-regulamento').style.display = 'none';
    afterLogin();
  };
}

function updateLiveConsumers(matchId, data) {
  if (typeof updateMatchDom === 'function') {
    updateMatchDom(matchId, data);
  }
  const modal = document.getElementById('modal-detalhes');
  if (modal && modal.dataset.openedMatchId === String(matchId)) {
    if (typeof window.syncModalData === 'function') {
      window.syncModalData(data);
    }
  }
}

/* =====================
    LOGICA DE MULTICAMPEONATO
===================== */
async function showLeagueSelection() {
  $loginSection().hidden = true;
  $appSection().hidden = true;
  if ($leagueSection()) $leagueSection().hidden = false;

  try {
    const res = await api.get('/api/matches/leagues');
    const container = document.getElementById('leagues-container');
    if (!container) return;
    container.innerHTML = '';

    const leagues = res.success ? res.data : res;
    if (!Array.isArray(leagues)) {
      toast("Erro ao carregar torneios", "error");
      return;
    }

    leagues.forEach(league => {
      const leagueLogoUrl = getLeagueLogoUrl(league);

      const timeDisplay = getTimeRemaining(league.nextMatchDate);
      const isClosed = league.count === 0;

      const statusText = isClosed
        ? `<span style="color: #ffc107; font-weight: bold;">Rodada Finalizada</span>`
        : `${league.count} partidas disponiveis`;

      const nextMatchInfo = isClosed
        ? 'Confira os resultados e o ranking!'
        : (league.nextMatchTeams ? `Proximo: <strong>${league.nextMatchTeams}</strong>` : 'Rodada aberta');

      const footerLabel = isClosed
        ? `<i class="fas fa-trophy"></i> <span>Ranking Atualizado</span>`
        : `<i class="fas fa-clock"></i> <span>Fecha em: <strong>${timeDisplay}</strong></span>`;

      const card = document.createElement('div');
      card.className = 'league-card-modern';
      card.innerHTML = `
        <div class="league-card-glass ${isClosed ? 'league-readonly' : ''}">
          <div class="league-logo-container">
            <img src="${leagueLogoUrl}"
                 class="league-logo-img"
                 alt="${league.name}"
                 onerror="this.onerror=null; this.src='https://via.placeholder.com/60?text=🏆';" loading="lazy">
          </div>
          <div class="league-info">
            <h3 class="league-title">${league.name}</h3>
            <p class="league-info-text">${statusText}</p>
            <p class="league-info-text">${nextMatchInfo}</p>
          </div>
          <div class="league-actions">
            <button class="btn-modern-primary">${isClosed ? 'Ver Resultados' : 'Entrar'}</button>
            <span class="ver-mais-link">Ver Ranking</span>
          </div>
          <div class="league-footer-info">
            ${footerLabel}
          </div>
        </div>
      `;
      card.onclick = () => selectLeague(league.id, league.name);
      container.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    toast("Erro ao carregar torneios", "error");
  }
}

async function selectLeague(id, name) {
  const leagueId = String(id ?? '').trim();
  if (!leagueId) {
    toast('Campeonato inválido.', 'error');
    return;
  }

  // afterLogin centraliza o registro da solicitação, a leitura das regras e
  // a verificação do acesso. Assim a seleção nunca dispara duas solicitações.
  localStorage.setItem('selectedLeagueId', leagueId);
  localStorage.setItem('selectedLeagueName', name || '');
  await afterLogin();
}

/* =====================
   Session helpers
===================== */
function applyTokenFromStorage() {
  const token = localStorage.getItem('token');
  if (token) setToken(token);
  return token;
}

window.refreshUserSession = async () => {
  const me = await fetchMe(localStorage.getItem('selectedLeagueId') || '');
  if (me) {
    currentUser = me;
    window.currentUser = me;
    const isPaid = me.isAdmin === true ||
      me.currentLeaguePaid === true ||
      me.currentLeaguePaymentRequired === false ||
      (String(localStorage.getItem('selectedLeagueId') || '') === '1' && me.hasPaid === true);
    if (isPaid || me.isAdmin) {
      const paywall = document.getElementById('paywall-wrapper');
      if (paywall) paywall.remove();
      document.body.style.overflow = '';
      renderUserInfo();
    } else {
      showPaywall();
    }
    return me;
  }
  return null;
};

async function fetchMe(leagueId = '') {
  try {
    const res = await api.me(leagueId || undefined);
    if (res?.success && res.user) {
      currentUser = res.user;
      window.currentUser = res.user;
      return res.user;
    }
  } catch (err) {
    verificarBloqueio(err);
  }
  return null;
}

/* =====================
   UI helpers
===================== */
function renderUserInfo() {
  const infoEl = $userInfo();
  if (!infoEl) return;

  const leagueName = localStorage.getItem('selectedLeagueName') || '';
  const userName = currentUser?.name || 'usuario';
  const isAdmin = currentUser?.isAdmin;

  const leagueStyle = "font-size: 10px; font-weight: 800; color: #e74c3c; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 2px;";
  const userRowStyle = "display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; color: #fff;";
  const adminBadgeStyle = "background: #e74c3c; color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 800; text-transform: uppercase; margin-left: 5px;";

  infoEl.style.display = "flex";
  infoEl.style.flexDirection = "column";
  infoEl.style.alignItems = "flex-start";

  let html = '';
  if (leagueName) {
    html += `<span style="${leagueStyle}">${leagueName}</span>`;
  }
  html += `
    <div style="${userRowStyle}">
      <span> ${userName}!</span>
      ${isAdmin ? `<span style="${adminBadgeStyle}">ADMIN</span>` : ''}
    </div>
  `;
  infoEl.innerHTML = html;
}

function syncBottomNav(activeTab) {
  document.querySelectorAll('.app-nav button')
    .forEach(btn => btn.classList.toggle('active', btn.dataset.tab === activeTab));
}

function renderUserRankingSummary() {
  if (!currentUser || !window.getUserRankingSummary) return;
  const summary = window.getUserRankingSummary(currentUser.id || currentUser._id);
  if (!summary) return;
  const posEl = document.getElementById('user-rank-position');
  const ptsEl = document.getElementById('user-rank-points');
  const wrapper = document.getElementById('user-ranking-summary');
  if (posEl) posEl.textContent = `🏆 ${summary.position}o lugar`;
  if (ptsEl) ptsEl.textContent = `⭐ ${summary.points} pts`;
  if (wrapper) wrapper.removeAttribute('hidden');
}
window.renderUserRankingSummary = renderUserRankingSummary;

function wireRankingSummaryClick() {
  const summary = document.getElementById('user-ranking-summary');
  if (summary) {
    summary.style.cursor = 'pointer';
    summary.onclick = () => navigateTo('ranking');
  }
}

async function syncMoreMenuVisibility() {
  try {
    const res = await api.get('/api/bets/more-access');
    const btn = document.getElementById('btn-more');
    if (!btn) return;
    if (res?.canAccessMore || currentUser?.isAdmin) {
      btn.removeAttribute('hidden');
      btn.removeAttribute('disabled');
    } else {
      btn.setAttribute('hidden', '');
    }
  } catch (err) {
    verificarBloqueio(err);
  }
}

/* =====================
   Navegacao unica
===================== */
async function navigateTo(tab) {
  if (tab === "profile") initProfile();
  if (tab === "classificacao") ClassificacaoPage();
  if (!tab) return;

  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  showTab(tab);

  if (tab === 'admin' && currentUser?.isAdmin) {
    await enterAdminPanel();
  }

  if (tab !== 'user-profile') {
    syncBottomNav(tab);
  }

  if (tab !== 'ranking') rankingInitialized = false;
  if (tab === 'ranking' && !rankingInitialized) {
    requestAnimationFrame(() => {
      initRanking();
      rankingInitialized = true;
    });
  }
  if (tab === 'stats') initStats().catch(verificarBloqueio);
}

window.openUserProfile = async (userId) => {
  if (!userId) return;
  await navigateTo('user-profile');
  initUserProfile(userId);
};

function wireTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => navigateTo(tab.dataset.tab));
  });
}

function wireBottomNav() {
  document.querySelectorAll('.app-nav button').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.tab));
  });
}

/* =====================
   Auth forms
===================== */
function showInlineError(inputId, message) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.classList.add('input-error');
  let msg = input.parentNode.querySelector('.input-error-msg');
  if (!msg) {
    msg = document.createElement('div');
    msg.className = 'input-error-msg';
    input.parentNode.appendChild(msg);
  }
  msg.textContent = message;
  input.addEventListener('input', () => {
    input.classList.remove('input-error');
    msg.remove();
  }, { once: true });
}

function wireAuthForms() {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  loginForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    btn?.classList.add('loading');
    try {
      const res = await api.post('/api/auth/login', {
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value
      });
      if (!res?.success || !res.token) throw new Error(res?.message || 'Login invalido');

      localStorage.setItem('token', res.token);
      setToken(res.token);
      currentUser = res.user;
      window.currentUser = res.user;
      isInitialLoading = false;

      await showLeagueSelection();
      document.body.classList.remove('pre-auth');
    } catch (err) {
      if (err.status === 402) {
        isInitialLoading = false;
        await showLeagueSelection();
      } else {
        showInlineError('login-email', err.message || 'Email ou senha invalidos');
      }
    } finally {
      btn?.classList.remove('loading');
    }
  });

  registerForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = registerForm.querySelector('button[type="submit"]');
    btn?.classList.add('loading');
    try {
      const res = await api.post('/api/auth/register', {
        name: document.getElementById('register-name').value.trim(),
        email: document.getElementById('register-email').value.trim(),
        password: document.getElementById('register-password').value
      });
      if (!res?.success) throw new Error(res?.message || 'Erro no cadastro');
      toast('Conta criada! Faca login.', 'success');
      registerForm.reset();
    } catch (err) {
      showInlineError('register-email', err.message || 'Erro ao criar conta');
    } finally {
      btn?.classList.remove('loading');
    }
  });
}

function waitForGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (window.google?.accounts?.id || Date.now() - startedAt > 8000) {
        clearInterval(timer);
        resolve(window.google || null);
      }
    }, 100);
  });
}

async function completeGoogleLogin(credential) {
  try {
    const res = await api.post('/api/auth/google', { credential });
    if (!res?.success || !res.token) throw new Error(res?.message || 'Não foi possível entrar com Google');

    localStorage.setItem('token', res.token);
    setToken(res.token);
    currentUser = res.user;
    window.currentUser = res.user;
    isInitialLoading = false;

    await showLeagueSelection();
    document.body.classList.remove('pre-auth');
  } catch (err) {
    showInlineError('login-email', err.message || 'Não foi possível entrar com Google');
  }
}

async function wireGoogleLogin() {
  const fallbackButton = document.getElementById('google-login-button');
  const googleContainer = document.getElementById('google-login-container');
  if (!fallbackButton || !googleContainer) return;

  let config = null;
  try {
    config = await api.get('/api/auth/google-config');
  } catch (_) {
    config = null;
  }

  const google = await waitForGoogleIdentity();
  if (config?.enabled && config.clientId && google?.accounts?.id) {
    google.accounts.id.initialize({
      client_id: config.clientId,
      callback: ({ credential }) => {
        if (credential) void completeGoogleLogin(credential);
      }
    });
    google.accounts.id.renderButton(googleContainer, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: 300
    });
    fallbackButton.hidden = true;
    googleContainer.hidden = false;
    return;
  }

  fallbackButton.addEventListener('click', () => {
    toast('Login Google ainda não foi configurado no servidor.', 'warning');
  });
}

function wirePasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const inputId = toggle.getAttribute('data-password-toggle');
      const input = inputId ? document.getElementById(inputId) : null;
      if (!input) return;

      const shouldShow = input.type === 'password';
      input.type = shouldShow ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(shouldShow));
      toggle.setAttribute('aria-label', shouldShow ? 'Ocultar senha' : 'Mostrar senha');
      toggle.setAttribute('title', shouldShow ? 'Ocultar senha' : 'Mostrar senha');
      toggle.querySelector('.eye-open')?.toggleAttribute('hidden', shouldShow);
      toggle.querySelector('.eye-closed')?.toggleAttribute('hidden', !shouldShow);
    });
  });
}

async function afterLogin() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '';

  if (!leagueId) {
    await showLeagueSelection();
    return;
  }

  // Recarrega o usuário para obter o status de pagamento DA LIGA selecionada.
  const freshUser = await fetchMe(leagueId);
  if (freshUser) {
    currentUser = freshUser;
    window.currentUser = freshUser;
  }

  // Garante que uma entrada direta/recarregamento também registre o pedido
  // da liga, sem duplicá-lo. O backend ignora o pedido para ligas gratuitas
  // ou já pagas.
  if (!currentUser?.isAdmin && leagueId && currentUser?.currentLeaguePaid !== true &&
      currentUser?.currentLeaguePaymentRequired !== false) {
    try {
      await api.requestLeaguePayment(leagueId);
    } catch (err) {
      console.warn('Não foi possível registrar a solicitação da liga:', err);
    }
  }

  const isPaid = currentUser?.isAdmin === true ||
    currentUser?.currentLeaguePaid === true ||
    currentUser?.currentLeaguePaymentRequired === false ||
    (String(leagueId) === '1' && currentUser?.hasPaid === true);

  const acceptedMap = JSON.parse(
    localStorage.getItem('regulamento_aceito_por_liga') || '{}'
  );
  const legacyAccepted =
    String(leagueId) === '1' &&
    localStorage.getItem('regulamento_aceito') === 'true';
  const jaAceitou = acceptedMap[String(leagueId)] === true || legacyAccepted;

  // Cada campeonato tem seu próprio aceite. O usuário deve ler as regras
  // específicas antes de entrar na área daquele campeonato.
  if (!jaAceitou && !currentUser?.isAdmin) {
    await initRegulamentoModal();
    const modal = document.getElementById('modal-regulamento');
    if (modal) modal.style.display = 'flex';
    return;
  }

  if (isPaid || currentUser?.isAdmin) {
    const p = document.getElementById('paywall-wrapper');
    if (p) p.remove();
    document.body.style.overflow = '';
  } else {
    showPaywall();
  }

  $loginSection().hidden = true;
  if ($leagueSection()) $leagueSection().hidden = true;
  $appSection().hidden = false;
  document.body.classList.add('has-app-nav');

  const desktopTabs = document.querySelector('.tabs');
  const mobileNav = document.getElementById('app-nav');
  if (desktopTabs) desktopTabs.style.display = '';
  if (mobileNav) mobileNav.style.display = '';

  renderUserInfo();

  document.querySelectorAll('[data-admin-only]').forEach(el => {
    if (!currentUser?.isAdmin) {
      el.hidden = true;
      el.style.setProperty('display', 'none', 'important');
    } else {
      el.hidden = false;
      el.style.display = '';
    }
  });

  initNewsTicker();
  initNewsWall();

  if (!window.__newsTickerInterval) {
    window.__newsTickerInterval = setInterval(() => { initNewsTicker(); }, 5 * 60 * 1000);
  }

  rankingInitialized = false;
  navigateTo('bets');

  try {
    await initMatches();
    initRealTimeUpdates();
    preloadRanking();
  } catch (err) {
    verificarBloqueio(err);
  }

  Promise.all([
    loadGlobalSaveLocks().catch(err => console.error("Erro ao carregar locks:", err)),
    Promise.resolve(typeof initMyBets === 'function' ? initMyBets() : null).catch(err => console.error("Erro ao carregar minhas apostas:", err)),
    Promise.resolve(typeof initAllBets === 'function' ? initAllBets() : null).catch(err => console.error("Erro ao carregar palpites gerais:", err)),
    Promise.resolve(typeof syncMoreMenuVisibility === 'function' ? syncMoreMenuVisibility() : null).catch(err => console.error("Erro ao verificar menu mais:", err))
  ]).then(() => {
    if (currentUser?.isAdmin) initAdmin();
  });
}

function performLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('selectedLeagueId');
  localStorage.removeItem('selectedLeagueName');
  localStorage.removeItem('regulamento_aceito');
  localStorage.removeItem('regulamento_aceito_por_liga');
  setToken(null);
  currentUser = null;
  window.currentUser = null;
  window.location.reload();
}

/* =====================
   Save bets
===================== */
function saveBetsDraftLocal() {
  const ok = saveLocalDraft();
  toast(ok ? '📝 Progresso salvo neste dispositivo.' : 'Não foi possível salvar o progresso neste dispositivo.', ok ? 'success' : 'error');
}

async function saveAllBets({ validateKnockout }) {
  if (isSaveBetsBlocked()) return;

  if (validateKnockout) {
    const missingKO = getMissingKnockoutQualifiers();
    if (missingKO.length > 0) {
      toast('Selecione os classificados no mata-mata!', 'warning');
      return;
    }
  }

  if (isRequireAllBetsEnabled()) {
    const missingGroup = getMissingGroupBets();
    if (missingGroup.length > 0) {
      toast(`Faltam ${missingGroup.length} palpites na fase de grupos.`, 'warning');
      return;
    }

    const missingGroupQualification = getMissingGroupQualificationBets();
    if (missingGroupQualification.length > 0) {
      toast(`Complete a classificação dos grupos (${missingGroupQualification.length} grupo(s) pendente(s)).`, 'warning');
      return;
    }

    const missingExtras = getMissingExtrasBets();
    if (missingExtras.length > 0) {
      const labels = missingExtras.map(item => item.label).join(', ');
      toast(`Preencha os Extras obrigatórios: ${labels}.`, 'warning');
      return;
    }

    // Valida podio dinamico: so exige as posicoes que o admin habilitou (podiumSize)
    const podiumSection = document.querySelector('.podium-section');
    const isPodiumVisible = podiumSection && podiumSection.style.display !== 'none';
    if (isPodiumVisible) {
      const podiumSelects = Array.from(document.querySelectorAll('[id^="podium-select-"]'));
      const emptyPositions = podiumSelects
        .map((sel, idx) => ({ sel, pos: idx + 1 }))
        .filter(({ sel }) => !sel.value);
      if (emptyPositions.length > 0) {
        const positions = emptyPositions.map(e => `${e.pos}o`).join(', ');
        toast(`Selecione o podio completo! Faltam: ${positions}`, 'warning');
        return;
      }
    }
  }

  try {
    // buildSavePayload ja monta o payload completo (incluindo podio e leagueId)
    const payload = buildSavePayload();

    // Garante leagueId no payload (fallback caso buildSavePayload nao inclua)
    if (!payload.leagueId) {
      payload.leagueId = localStorage.getItem('selectedLeagueId');
    }

    const res = await api.post('/api/bets/save', payload);

    if (!res?.success) throw new Error(res.message || 'Erro ao salvar');

    clearLocalDraft();
      toast('✅ Apostas enviadas com sucesso!', 'success');
    syncMoreMenuVisibility();

    setTimeout(async () => {
      await initMatches();
      document.getElementById('matches-container')?.scrollIntoView({ behavior: 'smooth' });
    }, 500);

  } catch (err) {
    verificarBloqueio(err);
    if (err.status !== 402) {
      toast(err.message || 'Erro ao salvar', 'error');
    }
  }
}

/* =====================
   Modais e menus
===================== */
function initForgotPasswordModal() {
  const modal = document.getElementById('forgot-modal');
  const open  = document.getElementById('open-forgot');
  const close = document.getElementById('fp-close');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const btnSend  = document.getElementById('fp-send');
  const btnReset = document.getElementById('fp-reset');
  if (!modal || !open) return;
  open.addEventListener('click', e => {
    e.preventDefault();
    modal.removeAttribute('hidden');
    modal.classList.add('active');
    step1?.classList.add('active');
    step2?.classList.remove('active');
  });
  close?.addEventListener('click', () => {
    modal.classList.remove('active');
    modal.setAttribute('hidden', '');
  });
  btnSend?.addEventListener('click', async () => {
    try {
      await forgotPassword(document.getElementById('fp-email').value);
      step1?.classList.remove('active');
      step2?.classList.add('active');
      toast('Codigo enviado!', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  btnReset?.addEventListener('click', async () => {
    try {
      await resetPassword(
        document.getElementById('fp-email').value,
        document.getElementById('fp-code').value,
        document.getElementById('fp-pass').value
      );
      toast('Senha redefinida!', 'success');
      modal.classList.remove('active');
      modal.setAttribute('hidden', '');
    } catch (err) { toast(err.message, 'error'); }
  });
}

function initMoreMenu() {
  const btnMore = document.getElementById('btn-more');
  const moreMenu = document.getElementById('more-menu');
  if (!btnMore || !moreMenu) return;
  moreMenu.setAttribute('hidden', '');
  btnMore.addEventListener('click', e => {
    e.stopPropagation();
    moreMenu.toggleAttribute('hidden');
  });
  moreMenu.querySelectorAll('button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.tab);
      moreMenu.setAttribute('hidden', '');
    });
  });
  moreMenu.querySelector('[data-action="logout"]')?.addEventListener('click', performLogout);
  document.addEventListener('click', e => {
    if (!moreMenu.contains(e.target) && !btnMore.contains(e.target)) {
      moreMenu.setAttribute('hidden', '');
    }
  });
}

/* =====================
   SSE - Realtime
===================== */
function initRealTimeUpdates() {
  if (!window.sseMsgCount) window.sseMsgCount = 0;
  if (window.sseSource) window.sseSource.close();

  const source = new EventSource(`${API_BASE_URL}/api/events`);
  window.sseSource = source;

  source.onmessage = async (event) => {
    window.sseMsgCount++;
    try {
      const rawData = JSON.parse(event.data);

      if (rawData.type === 'MATCH_UPDATE') {
        const incomingId = String(rawData.matchId ?? rawData._id ?? rawData.id);
        const data = { ...rawData, matchId: incomingId };

        const currentState = window.STATE;
        let oldMatch = (currentState?.matches || []).find(m => String(m.matchId) === incomingId);

        if (oldMatch) {
          console.log(`[SSE] Jogo ${incomingId} recebido.`, {
            status: data.status,
            gols: `${data.scoreA}x${data.scoreB}`,
            minuto: data.minute,
            penalties: `${data.penaltiesA}x${data.penaltiesB}`,
            detalhesGols: data.goalsDetail?.length || 0
          });

          const scoreChanged = oldMatch.scoreA !== data.scoreA || oldMatch.scoreB !== data.scoreB;
          const statusChanged = oldMatch.status !== data.status;
          const minuteChanged = data.hasOwnProperty('minute') && data.minute !== oldMatch.minute;
          const goalsDetailChanged = JSON.stringify(data.goalsDetail || []) !== JSON.stringify(oldMatch.goalsDetail || []);
          const penaltiesChanged =
            (data.hasOwnProperty('penaltiesA') && data.penaltiesA !== oldMatch.penaltiesA) ||
            (data.hasOwnProperty('penaltiesB') && data.penaltiesB !== oldMatch.penaltiesB);
          const shootoutDetailChanged = JSON.stringify(data.shootoutDetail || []) !== JSON.stringify(oldMatch.shootoutDetail || []);

          if (minuteChanged) {
            console.log(`%c[SSE] MINUTO ATUALIZADO: ${oldMatch.minute}' -> ${data.minute}'`, "color: #00d4ff; font-style: italic;");
          }
          if (penaltiesChanged) {
            console.log(`%c[SSE] MUDANCA DE PENALTIS! De ${oldMatch.penaltiesA}x${oldMatch.penaltiesB} para ${data.penaltiesA}x${data.penaltiesB}`, "color: #00ff00; font-weight: bold;");
          }
          if (goalsDetailChanged) {
             console.log(`%c[SSE] ATUALIZACAO DE MARCADORES DETECTADA!`, "color: #ffd700; font-weight: bold;");
          }
          if (shootoutDetailChanged) {
             console.log(`%c[SSE] ATUALIZACAO DE BOLINHAS DE PENALTIS DETECTADA!`, "color: #ff00ff; font-weight: bold;");
          }

          Object.assign(oldMatch, data);

          if (scoreChanged || statusChanged || penaltiesChanged || minuteChanged || goalsDetailChanged || shootoutDetailChanged) {
            console.log(`[SSE] Disparando updateMatchDom para ID: ${incomingId}`);
            if (typeof updateMatchDom === 'function') {
              updateLiveConsumers(incomingId, data);
            } else {
              console.error("[SSE] ERRO: updateMatchDom nao e uma funcao!");
            }
          }
        }
      }
    } catch (err) {
      console.error("Erro no processamento SSE:", err);
    }
  };

  source.onerror = () => {
    console.warn("SSE connection lost. Reconnecting in 5s...");
    source.close();
    setTimeout(initRealTimeUpdates, 5000);
  };
}

/* =====================
   Inicializacao
===================== */
async function initApp() {
  document.body.classList.remove('has-app-nav');

  wireAuthForms();
  void wireGoogleLogin();
  wirePasswordToggles();
  wireTabs();
  wireBottomNav();
  initMoreMenu();
  initAuthTabs();
  initForgotPasswordModal();
  wireRankingSummaryClick();

  document.getElementById('btn-logout')?.addEventListener('click', performLogout);

  const officialSaveButton = document.getElementById('save-bets');
  if (officialSaveButton) {
    officialSaveButton.textContent = '📤 Enviar apostas';
    let draftButton = document.getElementById('save-bets-draft');
    if (!draftButton) {
      draftButton = document.createElement('button');
      draftButton.id = 'save-bets-draft';
      draftButton.type = 'button';
      draftButton.className = officialSaveButton.className;
      draftButton.style.marginRight = '8px';
      draftButton.textContent = '📝 Salvar progresso';
      officialSaveButton.parentElement?.insertBefore(draftButton, officialSaveButton);
    }
    draftButton.addEventListener('click', saveBetsDraftLocal);
  }

  document.getElementById('save-bets')?.addEventListener('click', () => {
    saveAllBets({ validateKnockout: false });
  });

  document.getElementById('save-knockout-bets')?.addEventListener('click', () => {
    saveAllBets({ validateKnockout: true });
  });

  const token = applyTokenFromStorage();
  const savedLeague = localStorage.getItem('selectedLeagueId');

  if (token) {
    const me = await fetchMe();

    if (me) {
      isInitialLoading = false;

      if (!savedLeague) {
        await showLeagueSelection();
      } else {
        await afterLogin();
      }

      return;
    }

    localStorage.removeItem('token');
  }

  isInitialLoading = false;
  $loginSection().hidden = false;
  $appSection().hidden = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp, { once: true });
} else {
  initApp();
}
