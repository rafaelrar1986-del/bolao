import { api } from '../api.js';
import { flagEmoji } from '../flags.js';
import { toast, openModal, closeModal } from '../ui.js';
import { renderTeamMedia } from '../matches/matchesUtils.js';
import { DEFAULT_SCORING, DEFAULT_CHAMPIONSHIP_RULES, SAVE_LOCK_KEYS } from './adminConstants.js';
import { R, registerAdminFunctions } from './adminRuntime.js';
import { escapeHtml, knockoutDisplayLabel } from './adminUtils.js';

async function openRobotSettings() {
    try {
        const container = document.getElementById('robot-leagues-container');
        const multiSelect = document.getElementById('input-api-leagues-multi');
        if (container) container.innerHTML = '<p class="text-center w-100"><i class="fas fa-spinner fa-spin"></i> Carregando ligas...</p>';

        const [resSettings, resLeagues] = await Promise.all([
            api.get(`/api/settings/global?leagueId=${localStorage.getItem('selectedLeagueId') || '1'}`),
            api.get('/api/admin/robot/available-leagues')
        ]);

        if (resLeagues.success && resLeagues.results) {
            R.renderRobotLeagues(resLeagues.results);
            R.setupLeagueSelects(resLeagues.results);
        }

        if (resSettings.success && resSettings.data) {
            const s = resSettings.data;
            document.getElementById('input-cron-interval').value = s.cron_interval || 5;
            document.getElementById('input-api-season').value = s.api_season || 2026;
            if (multiSelect && s.api_leagues) {
                Array.from(multiSelect.options).forEach(opt => {
                    opt.selected = s.api_leagues.includes(parseInt(opt.value));
                });
            }
            const lastRunDisplay = document.getElementById('last-run-display');
            if (lastRunDisplay) {
                lastRunDisplay.innerText = s.last_api_run > 0 
                    ? new Date(s.last_api_run).toLocaleString('pt-BR') 
                    : 'Nunca executado';
            }
        }
        openModal('robot-settings-modal');
    } catch (err) {
        console.error('Erro ao carregar settings:', err);
        toast('Erro ao carregar configurações do robô', 'error');
    }
}

function renderRobotLeagues(leagues) {
    const container = document.getElementById('robot-leagues-container');
    if (!container) return;
    container.innerHTML = '';
    leagues.sort((a, b) => a.name.localeCompare(b.name));
    leagues.forEach(league => {
        const div = document.createElement('div');
        div.className = 'col-md-4 mb-2';
        div.innerHTML = `
            <div class="form-check">
                <input class="form-check-input robot-league-checkbox" type="checkbox" value="${league.id}" id="league-${league.id}" data-name="${league.name}">
                <label class="form-check-label" for="league-${league.id}" style="cursor:pointer">${league.name}</label>
            </div>
        `;
        container.appendChild(div);
    });
}

function setupLeagueSelects(leagues) {
    const multiSelect = document.getElementById('input-api-leagues-multi');
    if (!multiSelect) return;
    multiSelect.innerHTML = leagues.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
}

async function saveRobotSettings() {
    const multiSelect = document.getElementById('input-api-leagues-multi');
    const leaguesArray = Array.from(multiSelect.selectedOptions).map(opt => parseInt(opt.value));
    const payload = {
        leagueId: localStorage.getItem('selectedLeagueId') || '1',
        cron_interval: Number(document.getElementById('input-cron-interval').value),
        api_season: Number(document.getElementById('input-api-season').value),
        api_leagues: leaguesArray
    };
    try {
        const res = await api.post('/api/settings/global', payload);
        if (res.success) {
            toast('Configurações atualizadas!', 'success');
            closeModal('robot-settings-modal');
        }
    } catch (err) {
        console.error('Erro ao salvar settings:', err);
        toast('Erro ao salvar configurações', 'error');
    }
}

async function runRobotSync() {
    const selectedCheckboxes = document.querySelectorAll('.robot-league-checkbox:checked');
    const elFrom = document.getElementById('robot-date-from');
    const elTo = document.getElementById('robot-date-to');
    const elPhase = document.getElementById('sync-match-phase');
    const elKnockout = document.getElementById('sync-match-group-knockout');
    const loader = document.getElementById('robot-sync-loader');

    if (selectedCheckboxes.length === 0) return toast("Selecione pelo menos uma liga!", "error");
    if (!elFrom?.value || !elTo?.value) return toast("Preencha as datas!", "error");

    const dateFrom = elFrom.value;
    const dateTo = elTo.value;
    const selectedPhase = elPhase ? elPhase.value : 'auto';
    const isPointsRun = (selectedPhase === 'points_run');
    // Pontos corridos é uma fase própria. Não converter para 'group',
    // pois isso faz as partidas serem persistidas/renderizadas como grupos.
    const phaseToApi = isPointsRun ? 'pontos_corridos' : selectedPhase;
    const knockoutPhase = elKnockout ? elKnockout.value : null;

    if (loader) loader.style.display = 'block';
    let totalCriados = 0;
    let totalAtualizados = 0;

    try {
        for (const cb of selectedCheckboxes) {
            const leagueId = cb.value;
            const leagueName = cb.getAttribute('data-name');
            toast(`Sincronizando: ${leagueName}...`, 'info');

            const payload = { 
                leagueId, leagueName, dateFrom, dateTo,
                phaseType: phaseToApi,
                knockoutPhase: phaseToApi === 'knockout' ? knockoutPhase : null,
                unifyGroups: isPointsRun,
                isPointsRun: isPointsRun 
            };

            const res = await api.post('/api/admin/robot/sync', payload);
            if (res && res.success) {
                totalCriados += res.details?.criados || 0;
                totalAtualizados += res.details?.atualizados || 0;
            }
        }

        toast(`✅ Sincronia concluída! Criados: ${totalCriados} | Atualizados: ${totalAtualizados}`, 'success');
        if (typeof closeModal === 'function') closeModal('robot-settings-modal');
        if (typeof R.loadAdminMatches === 'function') await R.loadAdminMatches();
    } catch (err) {
        console.error('Erro na sincronização:', err);
        toast('Erro ao processar sincronização.', 'error');
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

function updateAdminBulkBar() {
  const bar = document.getElementById('admin-bulk-bar');
  if (!bar) return;
  const count = R.selectedAdminMatchIds.size;
  const countEl = bar.querySelector('[data-admin-selected-count]');
  if (countEl) countEl.textContent = `${count} selecionada${count === 1 ? '' : 's'}`;
  bar.classList.toggle('is-visible', count > 0);
}

async function bulkSelectedMatches(action) {
  const ids = [...R.selectedAdminMatchIds].map(Number).filter(Number.isInteger);
  if (!ids.length) {
    toast('Selecione pelo menos uma partida.', 'info');
    return;
  }
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  const isReopen = action === 'reopen';
  if (!confirm(
    `⚠️ ${isReopen ? 'REABRIR' : 'EXCLUIR'} ${ids.length} partida(s)?\n\n` +
    (isReopen
      ? 'Os placares e pontos dessas partidas serão limpos.'
      : 'A exclusão é definitiva e remove essas partidas dos palpites.')
  )) return;

  try {
    const res = isReopen
      ? await api.post('/api/matches/admin/unfinish-bulk', { leagueId, matchIds: ids })
      : await api.del('/api/matches/admin/delete-bulk', { leagueId, matchIds: ids });

    R.selectedAdminMatchIds.clear();
    toast(res.message || (isReopen ? 'Partidas reabertas.' : 'Partidas excluídas.'), 'success');
    await R.loadAdminMatches();
  } catch (err) {
    console.error('Erro na ação em lote:', err);
    toast(err.message || 'Erro ao executar ação em lote.', 'error');
  }
}

function updateBetLockVisual(blocked) {
  const btn = document.getElementById('btn-toggle-save-bets');
  if (!btn) return;
  btn.classList.toggle('is-locked', !!blocked);
  btn.classList.toggle('is-unlocked', !blocked);
  const icon = btn.querySelector('i');
  if (icon) icon.className = blocked ? 'fas fa-lock' : 'fas fa-unlock';
  btn.setAttribute('aria-label', blocked ? 'Palpites bloqueados' : 'Palpites liberados');
}

async function bulkDelete(params) {
    const scope = params.roundNumber
      ? `a rodada ${params.roundNumber}`
      : params.groupName
        ? `o grupo "${params.groupName}"`
        : `a liga "${params.leagueName}"`;
    if (!confirm(`⚠️ EXCLUSÃO DEFINITIVA: Deseja apagar todas as partidas de ${scope}?`)) return;
    try {
        const res = await api.del('/api/matches/admin/delete-bulk', params);
        if (res.success) {
            toast(res.message || 'Excluído com sucesso', 'success');
            await R.loadAdminMatches();
        }
    } catch (err) {
        console.error('Erro no bulkDelete:', err);
        toast(err.message || "Erro ao excluir", 'error');
    }
}

async function bulkUnfinish(params) {
    const scope = params.roundNumber
      ? `a rodada ${params.roundNumber}`
      : params.groupName
        ? `o grupo "${params.groupName}"`
        : `a liga "${params.leagueName}"`;
    if (!confirm(`Deseja REABRIR (limpar placares e pontos) de ${scope}?`)) return;
    try {
        const res = await api.post('/api/matches/admin/unfinish-bulk', params);
        if (res.success) {
            toast(res.message || 'Partidas reabertas', 'success');
            await R.loadAdminMatches();
        }
    } catch (err) {
        console.error('Erro no bulkUnfinish:', err);
        toast("Erro ao reabrir", 'error');
    }
}

registerAdminFunctions({openRobotSettings: openRobotSettings, renderRobotLeagues: renderRobotLeagues, setupLeagueSelects: setupLeagueSelects, saveRobotSettings: saveRobotSettings, runRobotSync: runRobotSync, updateAdminBulkBar: updateAdminBulkBar, bulkSelectedMatches: bulkSelectedMatches, updateBetLockVisual: updateBetLockVisual, bulkDelete: bulkDelete, bulkUnfinish: bulkUnfinish});
