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
  initAdminLeagueDropdown();
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
    syncAdminLeagueDropdown(leagues);
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
  syncAdminLeagueDropdown(R.AdminState.leagues || []);
  R.activeAdminTab = 'group';
  R.selectedAdminMatchIds.clear();
  R.CurrentSettings = { ...R.CurrentSettings };
  try { await R.loadLeagueSettings(); } catch (_) {}
  try { await R.loadGlobalSaveLocks(); } catch (_) {}
  try { await R.loadStatsLockStatus(); } catch (_) {}
  try { await R.loadAdminMatches(); } catch (_) {}
  try { await R.renderPhaseControls(); } catch (_) {}
  try {
    const usersSection = document.getElementById('admin-users-section');
    if (usersSection?.style.display === 'block' && typeof window.loadAdminUsers === 'function') {
      await window.loadAdminUsers(true);
    }
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('admin-league-changed', { detail: { id: select.value, name: option?.textContent || '' } }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function syncAdminLeagueDropdown(leagues = R.AdminState.leagues || []) {
  const dropdown = document.getElementById('admin-league-dropdown');
  const select = document.getElementById('admin-league-selector');
  const trigger = document.getElementById('admin-league-dropdown-trigger');
  const label = document.getElementById('admin-league-dropdown-label');
  const menu = document.getElementById('admin-league-dropdown-menu');
  if (!dropdown || !select || !trigger || !label || !menu) return;

  const currentId = String(select.value || '');
  const current = leagues.find(l => String(l.leagueId) === currentId);
  label.textContent = current?.name || (currentId ? `Liga ${currentId}` : 'Nenhum campeonato cadastrado');
  menu.innerHTML = leagues.length
    ? leagues.map((league, index) => {
        const id = String(league.leagueId);
        const selected = id === currentId;
        return `<button type="button" class="admin-league-dropdown-option${selected ? ' is-selected' : ''}" role="option" aria-selected="${selected}" data-league-id="${escapeHtml(id)}" data-index="${index}">${escapeHtml(league.name || `Liga ${id}`)}${selected ? '<i class="fas fa-check" aria-hidden="true"></i>' : ''}</button>`;
      }).join('')
    : '<div class="admin-league-dropdown-empty">Nenhum campeonato cadastrado</div>';

  menu.querySelectorAll('.admin-league-dropdown-option').forEach(option => {
    option.addEventListener('click', async () => {
      const id = option.dataset.leagueId;
      if (!id) return;
      select.value = id;
      closeAdminLeagueDropdown();
      await switchAdminLeague();
      syncAdminLeagueDropdown(leagues);
    });
  });
}

function closeAdminLeagueDropdown() {
  const trigger = document.getElementById('admin-league-dropdown-trigger');
  const menu = document.getElementById('admin-league-dropdown-menu');
  if (!trigger || !menu) return;
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
}

function toggleAdminLeagueDropdown() {
  const trigger = document.getElementById('admin-league-dropdown-trigger');
  const menu = document.getElementById('admin-league-dropdown-menu');
  if (!trigger || !menu) return;
  const opening = menu.hidden;
  menu.hidden = !opening;
  trigger.setAttribute('aria-expanded', String(opening));
}

function initAdminLeagueDropdown() {
  const trigger = document.getElementById('admin-league-dropdown-trigger');
  const menu = document.getElementById('admin-league-dropdown-menu');
  if (!trigger || !menu || trigger.dataset.bound === '1') return;
  trigger.dataset.bound = '1';
  trigger.addEventListener('click', toggleAdminLeagueDropdown);
  document.addEventListener('click', event => {
    const dropdown = document.getElementById('admin-league-dropdown');
    if (dropdown && !dropdown.contains(event.target)) closeAdminLeagueDropdown();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAdminLeagueDropdown();
  });
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
            <label for="create-league-start">Data de início <small>(API quando aplicável)</small></label>
            <input id="create-league-start" class="form-control" type="date">
          </div>
          <div class="form-group">
            <label for="create-league-end">Data final <small>(API quando aplicável)</small></label>
            <input id="create-league-end" class="form-control" type="date">
          </div>
        </div>
        <small style="color:#999;">Na API, as datas da temporada são preenchidas automaticamente e apenas exibidas. No manual, continuam opcionais e editáveis.</small>
        <button type="submit" class="btn btn-success" style="width:100%;"><i class="fas fa-plus"></i> Criar campeonato</button>
      </form>
    </div>`;
  document.body.appendChild(modal);

  const checkbox = modal.querySelector('#create-league-api');
  const name = modal.querySelector('#create-league-name');
  const select = modal.querySelector('#create-league-api-select');

  const startInput = modal.querySelector('#create-league-start');
  const endInput = modal.querySelector('#create-league-end');

  const setApiDates = (league) => {
    const season = league?.current_season || league?.currentSeason || null;
    startInput.value = season?.start_date ? String(season.start_date).slice(0, 10) : '';
    endInput.value = season?.end_date ? String(season.end_date).slice(0, 10) : '';
  };

  const updateDateMode = () => {
    const isApi = checkbox.checked;
    startInput.readOnly = isApi;
    endInput.readOnly = isApi;
    startInput.classList.toggle('api-readonly-date', isApi);
    endInput.classList.toggle('api-readonly-date', isApi);
  };

  const updateMode = async () => {
    if (!checkbox.checked) {
      name.style.display = '';
      name.value = '';
      select.style.display = 'none';
      startInput.value = '';
      endInput.value = '';
      updateDateMode();
      return;
    }
    name.style.display = 'none';
    select.style.display = '';
    select.innerHTML = '<option value="">Carregando competições da API...</option>';
    startInput.value = '';
    endInput.value = '';
    updateDateMode();
    try {
      const res = await api.getRobotAvailableLeagues();
      const leagues = Array.isArray(res?.results) ? res.results : (Array.isArray(res?.data) ? res.data : (Array.isArray(res?.leagues) ? res.leagues : []));
      R.AdminState.availableApiLeagues = leagues;
      select.innerHTML = leagues.length
        ? '<option value="">Selecione...</option>' + leagues.map(l => `<option value="${Number(l.id)}">${escapeHtml(l.name)}</option>`).join('')
        : '<option value="">Nenhuma competição disponível</option>';
      updateDateMode();
    } catch (err) {
      console.error('Erro ao carregar competições da API:', err);
      select.innerHTML = '<option value="">Erro ao carregar</option>';
      toast(err.message || 'Erro ao carregar competições da API', 'error');
    }
  };

  checkbox.addEventListener('change', updateMode);
  select.addEventListener('change', () => {
    const opt = select.selectedOptions[0];
    const selectedLeague = R.AdminState.availableApiLeagues?.find(l => String(l.id) === String(select.value));
    if (opt?.value) {
      name.value = opt.textContent;
      setApiDates(selectedLeague);
    } else {
      name.value = '';
      startInput.value = '';
      endInput.value = '';
    }
    updateDateMode();
  });
  modal.querySelector('#create-league-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const isApi = checkbox.checked;
    const selected = select.selectedOptions?.[0];
    const payload = {
      source: isApi ? 'api' : 'manual',
      name: isApi ? (selected?.textContent || '') : name.value.trim(),
      apiLeagueId: isApi ? Number(select.value) : null,
      startDate: startInput.value || null,
      endDate: endInput.value || null
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
