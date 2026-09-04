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

async function removeWhitelistEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return;
  if (!confirm(`Remover ${normalized} da whitelist?`)) return;
  try {
    const res = await api.removeWhitelist(normalized);
    if (!res.success) throw new Error(res.message || 'Erro ao remover e-mail');
    toast('E-mail removido da whitelist.', 'success');
    await loadWhitelist();
  } catch (err) {
    toast(err.message || 'Erro ao remover e-mail da whitelist.', 'error');
  }
}

async function makeUserAdmin(email, name) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return;
  if (!confirm(`Promover ${name || normalized} a administrador?`)) return;
  try {
    const res = await api.makeAdmin(normalized);
    if (!res.success) throw new Error(res.message || 'Erro ao promover usuário');
    toast(`${name || normalized} agora é administrador.`, 'success');
    await loadAdminUsers(true);
  } catch (err) {
    toast(err.message || 'Erro ao promover usuário.', 'error');
  }
}

async function deleteAdminUser(userId, name) {
  if (!userId) return;
  if (!confirm(`⚠️ EXCLUIR PERMANENTEMENTE o usuário ${name || ''}?\n\nAs apostas, histórico de pontos, comprovantes e mensagens dele também serão removidos.`)) return;
  try {
    const res = await api.deleteAdminUser(userId);
    if (!res.success) throw new Error(res.message || 'Erro ao excluir usuário');
    toast(`Usuário ${name || ''} excluído.`, 'success');
    await loadAdminUsers(true);
  } catch (err) {
    toast(err.message || 'Erro ao excluir usuário.', 'error');
  }
}

window.removeWhitelistEmail = removeWhitelistEmail;
window.makeUserAdmin = makeUserAdmin;
window.deleteAdminUser = deleteAdminUser;

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
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px; color:#666;">${new Date(item.createdAt).toLocaleDateString()}</span>
            <button type="button" class="btn btn-outline-danger btn-sm" onclick="removeWhitelistEmail('${String(item.email || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">Remover</button>
          </div>
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

let adminUsersActiveTab = 'users';

function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}

function escapeInline(value) {
    return String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r?\n/g, ' ');
}

function setAdminUsersTabUI(tab) {
    ['users', 'payments', 'participants'].forEach(name => {
        const btn = document.getElementById(`admin-tab-${name}`);
        if (!btn) return;
        btn.classList.toggle('admin-tab-active', name === tab);
    });
}

async function loadAdminUsers(forceReload = false) {
    const section = document.getElementById('admin-users-section');
    if (!section) return;
    if (section.style.display === 'block' && !forceReload) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    adminUsersActiveTab = 'users';
    await loadAdminUsersTab('users');
}

async function loadAdminUsersTab(tab = adminUsersActiveTab) {
    const section = document.getElementById('admin-users-section');
    const container = document.getElementById('admin-users-list');
    if (!section || !container) return;
    adminUsersActiveTab = tab;
    section.style.display = 'block';
    setAdminUsersTabUI(tab);
    container.innerHTML = '<p style="text-align:center;color:#888;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</p>';

    try {
        const leagueId = R.getAdminLeagueId();
        let users = [];
        let response;
        if (tab === 'users') {
            response = await api.getAdminAllUsers();
            users = response.users || [];
        } else if (tab === 'participants') {
            if (!leagueId) throw new Error('Selecione o campeonato que está sendo gerenciado.');
            response = await api.getAdminParticipants(leagueId);
            users = response.users || [];
        } else {
            if (!leagueId) throw new Error('Selecione o campeonato que está sendo gerenciado.');
            response = await api.getAdminUsers(leagueId);
            users = response.users || [];
        }

        if (!users.length) {
            const empty = tab === 'users'
                ? 'Nenhum usuário cadastrado.'
                : tab === 'participants'
                    ? 'Nenhum participante nesta liga.'
                    : 'Nenhum usuário com pedido ou pagamento nesta liga.';
            container.innerHTML = `<p style="text-align:center;color:#888;padding:20px;">${empty}</p>`;
            return;
        }

        if (tab === 'users') {
            container.innerHTML = users.map(user => {
                const id = escapeInline(user._id);
                const name = escapeInline(user.name || 'Sem Nome');
                const email = escapeInline(user.email || '');
                return `<div class="user-row" style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#222;border-radius:8px;margin-bottom:8px;gap:10px;">
                    <div style="display:flex;flex-direction:column;min-width:0;">
                      <strong style="color:#fff;">${escapeHtml(user.name || 'Sem Nome')}</strong>
                      <span style="font-size:12px;color:#888;word-break:break-all;">${escapeHtml(user.email || '')}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                      ${user.isAdmin
                        ? '<span style="color:#ffd43b;font-weight:bold;">👑 ADMIN</span>'
                        : `<button class="btn btn-outline-primary btn-sm" onclick="makeUserAdmin('${escapeInline(user.email)}','${name}')">👑 Tornar Admin</button>`}
                      <button class="btn btn-outline-danger btn-sm" onclick="deleteAdminUser('${id}','${name}')">🗑️ Excluir</button>
                    </div>
                  </div>`;
            }).join('');
            return;
        }

        if (tab === 'participants') {
            container.innerHTML = users.map(user => {
                const id = escapeInline(user._id);
                const name = escapeInline(user.name || 'Sem Nome');
                return `<div class="user-row" style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#222;border-radius:8px;margin-bottom:8px;gap:10px;">
                    <div style="display:flex;flex-direction:column;min-width:0;">
                      <strong style="color:#fff;">${escapeHtml(user.name || 'Sem Nome')}</strong>
                      <span style="font-size:12px;color:#888;word-break:break-all;">${escapeHtml(user.email || '')}</span>
                      <span style="font-size:11px;color:#61dafb;">Liga ${escapeHtml(leagueId)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                      ${user.paidForLeague ? '<span style="color:#00ff00;font-weight:bold;">✅ PAGO</span>' : '<span style="color:#ffcc00;font-weight:bold;">⚠️ SEM PAGAMENTO</span>'}
                      <button class="btn btn-outline-danger btn-sm" onclick="removeUserFromAdminLeague('${id}','${name}')">Remover da Liga</button>
                    </div>
                  </div>`;
            }).join('');
            return;
        }

        container.innerHTML = users.map(user => {
            const id = escapeInline(user._id);
            const name = escapeInline(user.name || 'Sem Nome');
            return `<div class="user-row" style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#222;border-radius:8px;margin-bottom:8px;border-left:4px solid ${user.hasPaid ? '#00ff00' : '#ffcc00'};gap:10px;">
                <div style="display:flex;flex-direction:column;min-width:0;">
                  <strong style="color:#fff;">${escapeHtml(user.name || 'Sem Nome')}</strong>
                  <span style="font-size:12px;color:#888;word-break:break-all;">${escapeHtml(user.email || '')}</span>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                  ${user.paymentRequired === false
                    ? '<span style="color:#61dafb;font-weight:bold;">🆓 GRATUITO</span>'
                    : user.hasPaid
                      ? `<span style="color:#00ff00;font-weight:bold;">✅ PAGO</span><button class="btn btn-outline-danger btn-sm" onclick="handleDisapproveUser('${id}','${name}')">Desaprovar PIX</button>`
                      : `<span style="color:#ffcc00;font-weight:bold;">⏳ PENDENTE</span><button class="btn btn-success btn-sm" onclick="handleApproveUser('${id}','${name}')">Aprovar PIX</button>`}
                </div>
              </div>`;
        }).join('');
    } catch (err) {
        console.error('Erro ao carregar painel de usuários:', err);
        toast(err.message || 'Erro ao carregar usuários.', 'error');
        container.innerHTML = `<p style="text-align:center;color:#ff6666;padding:20px;">${escapeHtml(err.message || 'Erro ao carregar usuários.')}</p>`;
    }
}

async function removeUserFromAdminLeague(userId, name) {
    const leagueId = R.getAdminLeagueId();
    if (!leagueId) {
        toast('Selecione o campeonato que está sendo gerenciado.', 'warning');
        return;
    }
    if (!confirm(`Remover ${name || 'este usuário'} da liga ${leagueId}?\n\nA conta e o histórico de apostas serão preservados, mas o acesso/pagamento desta liga será removido.`)) return;
    try {
        const res = await api.removeUserFromLeague(userId, leagueId);
        if (!res.success) throw new Error(res.message || 'Erro ao remover usuário da liga.');
        toast(`${name || 'Usuário'} removido da liga.`, 'success');
        await loadAdminUsersTab('participants');
    } catch (err) {
        toast(err.message || 'Erro ao remover usuário da liga.', 'error');
    }
}

window.loadAdminUsersTab = loadAdminUsersTab;
window.removeUserFromAdminLeague = removeUserFromAdminLeague;

registerAdminFunctions({openSetPodiumModal: openSetPodiumModal, resetAllBets: resetAllBets, openWhitelistModal: openWhitelistModal, loadWhitelist: loadWhitelist, removeWhitelistEmail: removeWhitelistEmail, makeUserAdmin: makeUserAdmin, deleteAdminUser: deleteAdminUser, loadStatsLockStatus: loadStatsLockStatus, updateStatsBtnUI: updateStatsBtnUI, toggleStatsLock: toggleStatsLock, openEmailModal: openEmailModal, loadAdminUsers: loadAdminUsers, loadAdminUsersTab: loadAdminUsersTab, removeUserFromAdminLeague: removeUserFromAdminLeague});
