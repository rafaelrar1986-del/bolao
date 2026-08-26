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
  // Admin não precisa de paywall.
  if (window.currentUser && window.currentUser.isAdmin) {
    console.log("Acesso verificado: usuário administrador.");
    return;
  }

  if (document.querySelector('.paywall-container')) return;

  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  let pixKey = '';
  let pixQrCode = '';

  try {
    const res = await api.get(`/api/settings/global?leagueId=${encodeURIComponent(leagueId)}`);
    pixKey = String(res?.data?.pixKey || '').trim();
    pixQrCode = String(res?.data?.pixQrCode || '').trim();
  } catch (err) {
    console.warn('Não foi possível carregar os dados PIX do campeonato:', err);
  }

  const qrHtml = pixQrCode
    ? `<img src="${pixQrCode}" alt="QR Code PIX" style="max-width:220px; max-height:220px; object-fit:contain;">`
    : `<div style="padding:20px; color:#888;">QR Code ainda não configurado para este campeonato.</div>`;

  const pixHtml = pixKey
    ? `<div class="pix-input-group">
         <input type="text" value="${pixKey.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}" id="pixCode" readonly>
         <button class="btn-copy" onclick="copyPix()">Copiar</button>
       </div>`
    : `<div class="pix-input-group"><input type="text" value="Chave PIX ainda não configurada" id="pixCode" readonly></div>`;

  const html = `
    <div class="paywall-container" id="paywall-wrapper">
      <div class="paywall-card">
        <h2>🔒 Acesso bloqueado</h2>
        <p>Para participar deste campeonato, realize o pagamento via PIX.</p>

        <div class="pix-qr-container">
          ${qrHtml}
        </div>

        ${pixHtml}

        <p class="paywall-status">A liberação é feita manualmente pelo administrador.</p>

        <button class="btn-refresh" onclick="location.reload()">
          Já paguei, atualizar site
        </button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  document.body.style.overflow = 'hidden';
}


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