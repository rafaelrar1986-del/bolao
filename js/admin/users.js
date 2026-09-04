import { api } from '../api.js';
import { flagEmoji } from '../flags.js';
import { toast, openModal, closeModal } from '../ui.js';
import { renderTeamMedia } from '../matches/matchesUtils.js';
import { DEFAULT_SCORING, DEFAULT_CHAMPIONSHIP_RULES, SAVE_LOCK_KEYS } from './adminConstants.js';
import { R, registerAdminFunctions } from './adminRuntime.js';
import { escapeHtml, knockoutDisplayLabel } from './adminUtils.js';

async function openSetPodiumModal() {
  await R.loadLeagueSettings();
  R.renderOfficialPodiumFields();
  R.populatePodiumSelects();
  await R.loadOfficialPodiumIntoModal();
  openModal('set-podium-modal');
}

async function resetAllBets() {
  const leagueId = R.getAdminLeagueId();
  if (!confirm(`⚠️ APAGAR TODOS OS PALPITES DA LIGA ${leagueId}?`)) return;

  try {
    const res = await api.post('/api/bets/admin/reset-all', { leagueId });
    if (!res.success) throw new Error(res.message || 'Erro ao resetar');
    toast(`Apostas da liga ${leagueId} resetadas`, 'success');
    if (typeof R.loadAdminMatches === 'function') await R.loadAdminMatches();
  } catch (err) {
    toast(err.message || 'Erro ao resetar', 'error');
  }
}

async function openWhitelistModal() {
  const modalHtml = `
    <div id="modal-whitelist" class="modal active">
      <div class="modal-content card">
        <div class="modal-header">
          <h3>👤 Gerenciar Convidados</h3>
          <button class="close-modal" onclick="document.getElementById('modal-whitelist').remove()">&times;</button>
        </div>
        <div class="admin-form-group" style="margin: 20px 0; display: flex; gap: 8px; flex-wrap: wrap;">
          <input type="email" id="wl-email" placeholder="E-mail do amigo" class="admin-input" style="flex:1; padding:10px; border-radius:8px; border:1px solid #444; background:#222; color:#fff;">
          <input type="text" id="wl-label" placeholder="Nome (opcional)" class="admin-input" style="flex:1; padding:10px; border-radius:8px; border:1px solid #444; background:#222; color:#fff;">
          <button id="btn-save-wl" class="btn btn-success">Autorizar</button>
        </div>
        <h4 style="margin-bottom:10px;">E-mails Autorizados</h4>
        <div id="wl-list-container" style="max-height: 250px; overflow-y: auto; background: #1a1a1a; padding: 10px; border-radius: 8px;">
          <p style="text-align:center; color:#888;">Carregando lista...</p>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  R.loadWhitelist();

  document.getElementById('btn-save-wl').onclick = async () => {
    const email = document.getElementById('wl-email').value.trim().toLowerCase();
    const label = document.getElementById('wl-label').value.trim();
    if (!email) return toast('Digite um e-mail válido', 'error');

    try {
      const res = await api.post('/api/auth/whitelist', { email, label });
      if (res.success) {
        toast('E-mail autorizado!', 'success');
        document.getElementById('wl-email').value = '';
        document.getElementById('wl-label').value = '';
        R.loadWhitelist();
      } else {
        toast(res.message || 'Erro ao autorizar', 'error');
      }
    } catch (err) {
      toast('Falha na comunicação com o servidor', 'error');
    }
  };
}

async function loadWhitelist() {
  const container = document.getElementById('wl-list-container');
  try {
    const res = await api.get('/api/auth/whitelist');
    if (res.success && res.emails.length > 0) {
      container.innerHTML = res.emails.map(item => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #333;">
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight:bold; color:#fff;">${item.label || 'Convidado'}</span>
            <span style="font-size:12px; color:#aaa;">${item.email}</span>
          </div>
          <span style="font-size:10px; color:#666;">${new Date(item.createdAt).toLocaleDateString()}</span>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">Nenhum convidado na lista.</p>';
    }
  } catch (err) {
    container.innerHTML = '<p style="text-align:center; color: #ff4444;">Erro ao carregar lista.</p>';
  }
}

async function loadStatsLockStatus() {
  const btn = document.getElementById('btn-toggle-stats-lock');
  if (!btn) return;
  const leagueId = R.getAdminLeagueId();
  try {
    const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
    if (res && res.success) {
      const locked = res.data?.statsLocked === true;
      R.updateStatsBtnUI(locked);
    }
  } catch (err) {
    console.error('Erro ao carregar stats lock:', err);
  }
}

function updateStatsBtnUI(isLocked) {
  const btn = document.getElementById('btn-toggle-stats-lock');
  if (!btn) return;
  if (isLocked) {
    btn.innerText = '📊🔒'; 
    btn.style.backgroundColor = '#e03131';
    btn.style.color = 'white';
    btn.title = 'Estatísticas BLOQUEADAS';
  } else {
    btn.innerText = '📊'; 
    btn.style.backgroundColor = '#fcc419';
    btn.style.color = 'black';
    btn.title = 'Estatísticas LIBERADAS';
  }
}

async function toggleStatsLock() {
  const btn = document.getElementById('btn-toggle-stats-lock');
  if (!btn) return;
  const leagueId = R.getAdminLeagueId();
  const isCurrentlyLocked = btn.style.backgroundColor === 'rgb(224, 49, 49)' || btn.style.backgroundColor === '#e03131';
  const newValue = !isCurrentlyLocked;

  try {
    const res = await api.post('/api/settings/global', { leagueId, statsLocked: newValue, lockedReason: newValue ? 'ADMIN_LOCK' : null });
    if (res.success) {
      R.updateStatsBtnUI(newValue);
      toast(newValue ? `Estatísticas da liga ${leagueId} bloqueadas!` : `Estatísticas da liga ${leagueId} liberadas!`, 'info');
    }
  } catch (err) {
    console.error('Erro ao salvar stats lock:', err);
    toast('Erro ao alterar trava', 'error');
  }
}

function openEmailModal() {
  const oldModal = document.getElementById('modal-email');
  if (oldModal) oldModal.remove();

  const modalHtml = `
    <div id="modal-email" class="modal active">
      <div class="modal-content card" style="max-width: 550px;">
        <div class="modal-header">
          <h3>✉️ Enviar Comunicado Geral</h3>
          <button class="close-modal" onclick="document.getElementById('modal-email').remove()">&times;</button>
        </div>
        <form id="form-broadcast" style="display:flex; flex-direction:column; gap:12px; margin-top:15px;">
          <input type="text" id="email-subject" placeholder="Assunto do E-mail" required class="admin-input">
          <textarea id="email-message" placeholder="Escreva aqui..." rows="6" required class="admin-input" style="resize: vertical;"></textarea>
          <div style="border: 1px dashed #555; padding: 10px; border-radius: 5px; background: rgba(0,0,0,0.2);">
            <label style="display:block; font-size:12px; margin-bottom:5px; color:#aaa;">Anexar arquivo:</label>
            <input type="file" id="email-attachment">
          </div>
          <button type="submit" id="btn-send-email" class="btn btn-success" style="margin-top:10px;">🚀 Enviar para Todos</button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  document.getElementById('form-broadcast').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-send-email');
    const subject = document.getElementById('email-subject').value;
    const message = document.getElementById('email-message').value;
    const fileInput = document.getElementById('email-attachment');

    const formData = new FormData();
    formData.append('subject', subject);
    formData.append('message', message);
    if (fileInput.files[0]) formData.append('attachment', fileInput.files[0]);

    try {
      btn.disabled = true;
      btn.innerText = '⏳ Enviando...';
      const res = await api.post('/api/admin/send', formData);
      if (res.success) {
        alert('✅ E-mails enviados!');
        document.getElementById('modal-email').remove();
      }
    } catch (err) {
      console.error('Erro no envio:', err);
      const msg = err.data?.message || err.message || 'Erro ao conectar com o servidor';
      alert('❌ Erro: ' + msg);
    } finally {
      btn.disabled = false;
      btn.innerText = '🚀 Enviar para Todos';
    }
  };
}

async function loadAdminUsers(forceReload = false) {
    const section = document.getElementById('admin-users-section');
    const container = document.getElementById('admin-users-list');
    if (!container || !section) return;

    if (section.style.display === 'block' && !forceReload) {
        section.style.display = 'none';
        return; 
    }

    section.style.display = 'block';
    container.innerHTML = '<p style="text-align:center; color:#888; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</p>';

    try {
        const leagueId = R.getAdminLeagueId();
        const response = await api.get(`/api/admin/users?leagueId=${encodeURIComponent(leagueId)}`);
        const users = response.users || [];

        if (!users || users.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#888;">Nenhum usuário encontrado.</p>';
            return;
        }

        container.innerHTML = users.map(user => {
            const safeId = String(user._id);
            const safeName = String(user.name || 'Sem Nome')
              .replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'");
            return `
            <div class="user-row" style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#222;border-radius:8px;margin-bottom:8px;border-left:4px solid ${user.hasPaid ? '#00ff00' : '#ffcc00'};">
                <div style="display:flex;flex-direction:column;">
                    <strong style="color:#fff;">${String(user.name || 'Sem Nome').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</strong>
                    <span style="font-size:12px;color:#888;">${String(user.email || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
                </div>
                <div>
                    ${user.paymentRequired === false
                      ? `<span style="color:#61dafb;font-weight:bold;">🆓 GRATUITO</span>`
                      : user.hasPaid
                      ? `<span style="color:#00ff00;font-weight:bold;">✅ PAGO</span>
                         <button class="btn btn-outline-danger btn-sm" onclick="handleDisapproveUser('${safeId}', '${safeName}')">Desaprovar PIX</button>`
                      : `<button class="btn btn-success btn-sm" onclick="handleApproveUser('${safeId}', '${safeName}')">Aprovar PIX</button>`
                    }
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error("Erro ao carregar usuários:", err);
        toast("Erro ao carregar usuários", "error");
        section.style.display = 'none';
    }
}

registerAdminFunctions({openSetPodiumModal: openSetPodiumModal, resetAllBets: resetAllBets, openWhitelistModal: openWhitelistModal, loadWhitelist: loadWhitelist, loadStatsLockStatus: loadStatsLockStatus, updateStatsBtnUI: updateStatsBtnUI, toggleStatsLock: toggleStatsLock, openEmailModal: openEmailModal, loadAdminUsers: loadAdminUsers});
