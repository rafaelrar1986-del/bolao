import { api } from '../api.js';
import { toast, closeModal } from '../ui.js';
import { R, registerAdminFunctions } from './adminRuntime.js';
import { getLeagueLogoUrl } from '../leagueLogo.js';


function updateAdminLeagueLogo(leagueOrId, leagueName = '') {
  const img = document.getElementById('admin-dashboard-league-logo');
  const fallback = document.getElementById('admin-dashboard-league-fallback');
  const holder = img?.closest('.admin-dashboard-league-icon');
  if (!img || !fallback || !holder) return;

  const league = leagueOrId && typeof leagueOrId === 'object'
    ? leagueOrId
    : { id: leagueOrId, name: leagueName };
  const logoUrl = getLeagueLogoUrl(league);

  img.hidden = true;
  fallback.hidden = false;
  img.alt = league.name ? `Símbolo de ${league.name}` : 'Símbolo da liga';
  img.onload = () => {
    img.hidden = false;
    fallback.hidden = true;
  };
  img.onerror = () => {
    img.hidden = true;
    fallback.hidden = false;
  };

  if (!logoUrl) {
    img.removeAttribute('src');
    return;
  }
  img.src = logoUrl;
}

function setAdminLeague(id, name = '') {
  const leagueId = String(id);
  localStorage.setItem('adminSelectedLeagueId', leagueId);
  if (name) localStorage.setItem('adminSelectedLeagueName', name);
  return leagueId;
}

async function loadAdminLeagues({ selectCurrent = true } = {}) {
  const select = document.getElementById('admin-league-selector');
  if (!select) return [];
  try {
    const res = await api.getAdminLeagues();
    const leagues = Array.isArray(res?.data) ? res.data : [];
    R.AdminState.leagues = leagues;
    const current = R.getAdminLeagueId();
    select.innerHTML = leagues.length
      ? leagues.map(l => `<option value="${escapeHtml(String(l.leagueId))}">${escapeHtml(l.name || `Liga ${l.leagueId}`)}</option>`).join('')
      : '<option value="">Nenhum campeonato cadastrado</option>';
    if (selectCurrent && leagues.some(l => String(l.leagueId) === String(current))) {
      select.value = String(current);
    } else if (leagues.length) {
      select.value = String(leagues[0].leagueId);
      R.setAdminLeagueId(leagues[0].leagueId, leagues[0].name);
    }
    const currentLeague = leagues.find(l => String(l.leagueId) === String(select.value));
    if (currentLeague) {
      R.setAdminLeagueId(currentLeague.leagueId, currentLeague.name);
      updateAdminLeagueLogo(currentLeague);
    } else {
      updateAdminLeagueLogo('', '');
    }
    return leagues;
  } catch (err) {
    console.error('Erro ao carregar campeonatos do Admin:', err);
    toast(err.message || 'Erro ao carregar campeonatos', 'error');
    return [];
  }
}

async function switchAdminLeague() {
  const select = document.getElementById('admin-league-selector');
  const option = select?.selectedOptions?.[0];
  if (!select?.value) return;
  R.setAdminLeagueId(select.value, option?.textContent || '');
  const currentLeague = R.AdminState.leagues.find(l => String(l.leagueId) === String(select.value));
  updateAdminLeagueLogo(currentLeague || { leagueId: select.value, id: select.value, name: option?.textContent || '' });
  R.activeAdminTab = 'group';
  R.selectedAdminMatchIds.clear();
  R.CurrentSettings = { ...R.CurrentSettings };
  try { await R.loadLeagueSettings(); } catch (_) {}
  try { await R.loadGlobalSaveLocks(); } catch (_) {}
  try { await R.loadStatsLockStatus(); } catch (_) {}
  try { await R.loadAdminMatches(); } catch (_) {}
  try { await R.renderPhaseControls(); } catch (_) {}
  window.dispatchEvent(new CustomEvent('admin-league-changed', { detail: { id: select.value, name: option?.textContent || '' } }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

async function openCreateLeagueModal() {
  document.getElementById('create-league-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'create-league-modal';
  modal.className = 'modal active';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:560px;">
      <div class="modal-header">
        <h3><i class="fas fa-trophy"></i> Criar campeonato</h3>
        <button class="close-modal" type="button" onclick="closeModal('create-league-modal')">&times;</button>
      </div>
      <form id="create-league-form" style="display:flex;flex-direction:column;gap:14px;">
        <div class="form-group">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <label for="create-league-name" style="margin:0;">Nome do campeonato</label>
            <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-weight:700;white-space:nowrap;">
              <input type="checkbox" id="create-league-api"> API
            </label>
          </div>
          <input id="create-league-name" class="form-control" type="text" maxlength="120" placeholder="Nome do campeonato" autocomplete="off">
          <select id="create-league-api-select" class="form-control" style="display:none;margin-top:8px;"></select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="create-league-start">Data de início <small>(opcional)</small></label>
            <input id="create-league-start" class="form-control" type="date">
          </div>
          <div class="form-group">
            <label for="create-league-end">Data final <small>(opcional)</small></label>
            <input id="create-league-end" class="form-control" type="date">
          </div>
        </div>
        <small style="color:#999;">As datas são opcionais, tanto para campeonatos manuais quanto para campeonatos da API.</small>
        <button type="submit" class="btn btn-success" style="width:100%;"><i class="fas fa-plus"></i> Criar campeonato</button>
      </form>
    </div>`;
  document.body.appendChild(modal);

  const checkbox = modal.querySelector('#create-league-api');
  const name = modal.querySelector('#create-league-name');
  const select = modal.querySelector('#create-league-api-select');

  const updateMode = async () => {
    if (!checkbox.checked) {
      name.style.display = '';
      name.value = '';
      select.style.display = 'none';
      return;
    }
    name.style.display = 'none';
    select.style.display = '';
    select.innerHTML = '<option value="">Carregando competições da API...</option>';
    try {
      const res = await api.getRobotAvailableLeagues();
      const leagues = Array.isArray(res?.results) ? res.results : (Array.isArray(res?.data) ? res.data : (Array.isArray(res?.leagues) ? res.leagues : []));
      select.innerHTML = leagues.length
        ? '<option value="">Selecione...</option>' + leagues.map(l => `<option value="${Number(l.id)}">${escapeHtml(l.name)}</option>`).join('')
        : '<option value="">Nenhuma competição disponível</option>';
    } catch (err) {
      console.error('Erro ao carregar competições da API:', err);
      select.innerHTML = '<option value="">Erro ao carregar</option>';
      toast(err.message || 'Erro ao carregar competições da API', 'error');
    }
  };

  checkbox.addEventListener('change', updateMode);
  select.addEventListener('change', () => {
    const opt = select.selectedOptions[0];
    if (opt?.value) name.value = opt.textContent;
  });
  modal.querySelector('#create-league-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const isApi = checkbox.checked;
    const selected = select.selectedOptions?.[0];
    const payload = {
      source: isApi ? 'api' : 'manual',
      name: isApi ? (selected?.textContent || '') : name.value.trim(),
      apiLeagueId: isApi ? Number(select.value) : null,
      startDate: modal.querySelector('#create-league-start').value || null,
      endDate: modal.querySelector('#create-league-end').value || null
    };
    if (!payload.name || (isApi && (!payload.apiLeagueId || payload.apiLeagueId <= 0))) {
      toast(isApi ? 'Selecione um campeonato da API.' : 'Informe o nome do campeonato.', 'error');
      return;
    }
    try {
      const res = await api.createAdminLeague(payload);
      if (!res?.success) throw new Error(res?.message || 'Erro ao criar campeonato');
      const created = res.data;
      R.setAdminLeagueId(created.leagueId, created.name);
      closeModal('create-league-modal');
      await loadAdminLeagues();
      const selector = document.getElementById('admin-league-selector');
      if (selector) selector.value = String(created.leagueId);
      await switchAdminLeague();
      toast(`Campeonato "${created.name}" criado com sucesso.`, 'success');
    } catch (err) {
      console.error('Erro ao criar campeonato:', err);
      toast(err.message || 'Erro ao criar campeonato', 'error');
    }
  });
}

registerAdminFunctions({ loadAdminLeagues, switchAdminLeague, openCreateLeagueModal, updateAdminLeagueLogo });
