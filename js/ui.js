import { api } from './api.js';
// ui.js

// =======================
// 🎨 SISTEMA DE TOASTS
// =======================
const messagesBox = () => document.getElementById('global-messages');

// 🔒 mensagens que NÃO devem gerar toast (estado esperado ou tratado por UI específica)
const SILENT_PATTERNS = [
  'LOCKED',
  'Estatísticas bloqueadas',
  'STATS_LOCKED',
  'HTTP 423',
  'HTTP 402',              // 💰 Silencia o erro de pagamento no Toast
  'Pagamento pendente',     // 💰 Silencia a mensagem customizada
  'requires payment'
];

let lastToastMessage = null;

export function toast(message, type = 'info', timeout = 3000) {
  const box = messagesBox();
  if (!box || !message) return;

  // 🔕 ignora mensagens de bloqueio conhecidas ou que possuem UI própria (Paywall)
  const isSilent = typeof message === 'string' && 
                   SILENT_PATTERNS.some(p => message.toLowerCase().includes(p.toLowerCase()));
  
  if (isSilent) return;

  if (message === lastToastMessage) return;
  lastToastMessage = message;

  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = message;

  box.appendChild(div);

  setTimeout(() => {
    div.style.opacity = '0';
    setTimeout(() => {
      div.remove();
      if (lastToastMessage === message) {
        lastToastMessage = null;
      }
    }, 300);
  }, timeout);
}

// =======================
// 💰 INTERFACE DE PAYWALL (BLOQUEIO)
// =======================
export async function showPaywall() {
  const current = window.currentUser || {};
  if (current.isAdmin) return;

  const leagueId = localStorage.getItem('selectedLeagueId') || '';
  if (!leagueId) return;

  let payment = {};
  try {
    const res = await api.getSettings(leagueId);
    payment = res?.data?.payment || {};
    // Liga gratuita nunca deve exibir Paywall.
    if (payment.required === false) {
      const existing = document.getElementById('paywall-wrapper');
      if (existing) existing.remove();
      document.body.style.overflow = '';
      return;
    }
  } catch (err) {
    console.warn('Não foi possível carregar o pagamento desta liga:', err);
  }

  // O usuário pode trocar de campeonato enquanto a configuração carrega.
  // Nesse caso, não podemos desenhar o pagamento da liga anterior.
  if (String(localStorage.getItem('selectedLeagueId') || '') !== String(leagueId)) {
    return;
  }

  // Nunca reutiliza QR/chave de outra liga.
  const rawPixQrCode = typeof payment.pixQrCode === 'string' ? payment.pixQrCode.trim() : '';
  const pixQrCode = /^(data:image\/(png|jpeg|jpg|webp);base64,|https?:\/\/)/i.test(rawPixQrCode)
    ? rawPixQrCode
    : '';
  const pixKey = typeof payment.pixKey === 'string' ? payment.pixKey : '';

  let pw = document.getElementById('paywall-wrapper');
  if (pw) pw.remove();

  pw = document.createElement('div');
  pw.className = 'paywall-container';
  pw.id = 'paywall-wrapper';

  const qrHtml = pixQrCode
    ? `<div class="pix-qr-container"><img src="${pixQrCode}" alt="QR Code PIX desta liga" style="max-width:220px;max-height:220px;object-fit:contain;"></div>`
    : `<div class="pix-qr-container" style="padding:25px;color:#aaa;">QR Code ainda não configurado para este campeonato.</div>`;

  const pixHtml = pixKey
    ? `<div class="pix-input-group">
         <input type="text" value="${String(pixKey).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}" id="pixCode" readonly>
         <button class="btn-copy" onclick="copyPix()">Copiar</button>
       </div>`
    : '';

  pw.innerHTML = `
    <div class="paywall-card">
      <h1>Quase lá! 🏁</h1>
      <p>Para liberar seus palpites e ver o ranking deste campeonato, confirme o pagamento da cota.</p>
      ${qrHtml}
      ${pixHtml}
      <p class="paywall-status">A liberação é feita manualmente pelo administrador.</p>
      <button class="btn-refresh" type="button" onclick="window.exitSelectedLeaguePayment()">Já paguei, atualizar site</button>
      <button class="btn-paywall-exit" type="button" onclick="window.exitSelectedLeaguePayment()">↩ Sair</button>
    </div>
  `;

  document.body.appendChild(pw);
  document.body.style.overflow = 'hidden';
}

// Sai da liga atualmente selecionada sem fazer logout.
// O token de autenticação permanece salvo; a tela volta diretamente para
// a seleção de ligas. O eventual pedido de pagamento já registrado não é
// cancelado aqui: sair da tela não significa cancelar a solicitação.
window.exitSelectedLeaguePayment = () => {
  localStorage.removeItem('selectedLeagueId');
  localStorage.removeItem('selectedLeagueName');

  const paywall = document.getElementById('paywall-wrapper');
  if (paywall) paywall.remove();
  document.body.style.overflow = '';

  // Volta diretamente para a seleção de ligas, preservando a sessão.
  // Não recarregamos a página: isso evita que mecanismos de login automático
  // (especialmente Google Identity) sejam inicializados novamente.
  document.body.classList.remove('has-app-nav');
  if (typeof window.showLeagueSelection === 'function') {
    void window.showLeagueSelection();
  } else {
    // Fallback seguro caso o módulo principal ainda não tenha exposto o fluxo.
    const loginSection = document.getElementById('login-section');
    const appSection = document.getElementById('app-section');
    const leagueSection = document.getElementById('league-selection-section');
    if (loginSection) loginSection.hidden = true;
    if (appSection) appSection.hidden = true;
    if (leagueSection) leagueSection.hidden = false;
  }
};

// Helper global para o botão de cópia
window.copyPix = () => {
  const input = document.getElementById('pixCode');
  if (!input) return;
  
  input.select();
  input.setSelectionRange(0, 99999); // Para mobile
  navigator.clipboard.writeText(input.value);
  
  const btn = document.querySelector('.btn-copy');
  if (btn) {
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
  }
};

// =======================
// 🧭 CONTROLE DE TABS
// =======================
export function showTab(tabName) {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabName);
  });
}

// =======================
// 🪟 MODAIS
// =======================
export function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

// =======================
// 🔍 SELETORES RÁPIDOS
// =======================
export function $(selector, base = document) {
  return base.querySelector(selector);
}

export function $all(selector, base = document) {
  return [...base.querySelectorAll(selector)];
}