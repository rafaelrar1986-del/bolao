// Global bindings kept for existing inline HTML handlers.
import { R } from './admin/adminRuntime.js';
import { openModal, closeModal, toast } from './ui.js';
import { api } from './api.js';
import { renderTeamMedia } from './matches/matchesUtils.js';

// Legacy inline HTML handlers must be available as soon as the Admin module loads.
// Do not wait for initAdmin(): an earlier initialization error must not disable modal close/open actions.
window.openModal = openModal;
window.closeModal = closeModal;

window.switchAdminTab = function(tab) {
  R.activeAdminTab = tab;
  R.renderAdminMatches(R.AdminState.matches);
};

window.loadMatchDetailsAdmin = function loadMatchDetailsAdmin() {
  const select = document.getElementById('finish-match-select');
  const detailsDiv = document.getElementById('match-details');
  if (!select || !detailsDiv) return;

  const matchId = Number(select.value);
  if (!matchId) {
    detailsDiv.style.display = 'none';
    return;
  }

  const match = R.AdminState.matches.find((m) => m.matchId === matchId);
  if (!match) return;

  const nameContainer = document.getElementById('selected-match-name');
  if (nameContainer) {
    nameContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 5px;"><span>${match.teamA}</span>${renderTeamMedia(match.teamA, match.logoA)}</div>
        <span style="color: #888;">vs</span>
        <div style="display: flex; align-items: center; gap: 5px;">${renderTeamMedia(match.teamB, match.logoB)}<span>${match.teamB}</span></div>
      </div>
    `;
  }

  const penBox = document.getElementById('admin-penalties-box');
  const regularBox = document.getElementById('admin-regular-time-box');
  const qualField = document.getElementById('qualified-side');
  const scoreAInput = document.getElementById('score-a');
  const scoreBInput = document.getElementById('score-b');
  const regAInput = document.getElementById('regular-time-score-a');
  const regBInput = document.getElementById('regular-time-score-b');
  const lblA = document.getElementById('lbl-score-a');
  const lblB = document.getElementById('lbl-score-b');

  const isKnockout = match.phase === 'knockout';

  // Sempre limpa os campos ao trocar de partida para não carregar valores da anterior.
  if (scoreAInput) scoreAInput.value = '';
  if (scoreBInput) scoreBInput.value = '';
  if (regAInput) regAInput.value = '';
  if (regBInput) regBInput.value = '';
  const penAInput = document.getElementById('penalties-a');
  const penBInput = document.getElementById('penalties-b');
  if (penAInput) penAInput.value = '';
  if (penBInput) penBInput.value = '';

  if (isKnockout) {
    if (regularBox) regularBox.style.display = 'block';
    if (penBox) penBox.style.display = 'block';
    if (lblA) lblA.textContent = 'Placar final A';
    if (lblB) lblB.textContent = 'Placar final B';
    if (regAInput) regAInput.placeholder = '90 min';
    if (regBInput) regBInput.placeholder = '90 min';
    if (qualField) {
      qualField.innerHTML = `
        <option value="">Selecione quem avança (se necessário)...</option>
        <option value="A">${R.withFlag(match.teamA)}</option>
        <option value="B">${R.withFlag(match.teamB)}</option>
      `;
    }
  } else {
    if (regularBox) regularBox.style.display = 'none';
    if (penBox) penBox.style.display = 'none';
    if (lblA) lblA.textContent = 'Placar final A';
    if (lblB) lblB.textContent = 'Placar final B';
    if (qualField) qualField.innerHTML = '<option value="">Fase de Grupos</option>';
  }

  detailsDiv.style.display = 'block';
};

window.handleApproveUser = async (id, name) => {
    if (!confirm(`Confirmar pagamento de ${name}?`)) return;
    try {
        const res = await api.put(`/api/admin/approve-user/${id}`);
        if (res.success || res.message) {
            toast(`Acesso liberado para ${name}!`, "success");
            R.loadAdminUsers();
        }
    } catch (err) {
        toast(err.message || "Erro na aprovação", "error");
    }
};

window.loadAdminUsers = R.loadAdminUsers;

window.showMatchBetsModal = async function(matchId, matchName) {
    try {
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!leagueId) {
        console.error("League ID não encontrado no localStorage.");
        return;
    }

    const [usersRes, allBetsRes] = await Promise.all([
        api.get(`/api/bets/users-for-filter?leagueId=${leagueId}`), 
        api.get(`/api/bets/all-bets?matchId=${matchId}&leagueId=${leagueId}`)
    ]);

        const allUsers = usersRes.data || [];
        const betsData = allBetsRes.data || [];
        const usersWhoBet = new Set(betsData.map(b => b.userName));

        let listHtml = `
            <div style="max-height: 450px; overflow-y: auto; padding: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 12px; color: #aaa; border-bottom: 1px solid #333; padding-bottom: 10px;">
                    <span><i class="fas fa-circle" style="color: #2ecc71;"></i> Apostou</span>
                    <span><i class="fas fa-circle" style="color: #e74c3c;"></i> Pendente</span>
                </div>
                <div class="list-group">
        `;

        allUsers.sort((a, b) => a.name.localeCompare(b.name)).forEach(user => {
            const hasBet = usersWhoBet.has(user.name);
            const color = hasBet ? '#2ecc71' : '#e74c3c';
            const icon = hasBet ? 'fa-check-circle' : 'fa-times-circle';
            listHtml += `
                <div class="list-group-item" style="background: #1a1a1a; border: 1px solid #333; color: white; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; padding: 12px; border-radius: 8px;">
                    <span style="color: ${color}; font-weight: 500;"><i class="fas ${icon} me-2"></i> ${user.name}</span>
                    <span style="font-size: 11px; color: ${color}; border: 1px solid ${color}44; padding: 2px 8px; border-radius: 10px; background: ${hasBet ? 'rgba(46, 204, 113, 0.05)' : 'rgba(231, 76, 60, 0.05)'}">${hasBet ? 'CONFIRMADO' : 'PENDENTE'}</span>
                </div>
            `;
        });

        listHtml += `</div></div>`;

        const titleEl = document.getElementById('modal-match-bets-title');
        const bodyEl = document.getElementById('modal-match-bets-body');
        if (titleEl) titleEl.innerText = `Apostas: ${matchName}`;
        if (bodyEl) bodyEl.innerHTML = listHtml;
        openModal('modal-match-bets');
    } catch (err) {
        console.error('Erro ao processar lista de apostas:', err);
        if (typeof toast === 'function') toast('Erro ao carregar dados', 'error');
    }
};

window.toggleAdminSelectionMode = function() {
  R.adminMatchSelectionMode = !R.adminMatchSelectionMode;
  if (!R.adminMatchSelectionMode) {
    R.selectedAdminMatchIds.clear();
  }
  R.renderAdminMatches(R.AdminState.matches);
  R.updateAdminBulkBar();
};

window.toggleAdminMatchSelection = function(matchId, checked) {
  const id = String(matchId);
  if (checked) R.selectedAdminMatchIds.add(id);
  else R.selectedAdminMatchIds.delete(id);
  const card = document.querySelector(`#admin-matches-list .admin-match-card[data-match-id="${id}"]`);
  if (card) card.classList.toggle('is-selected', checked);
  R.updateAdminBulkBar();
};

window.toggleAdminGroupSelection = function(input, ids) {
  const shouldSelect = Boolean(input.checked);
  (ids || []).forEach(id => {
    const key = String(id);
    if (shouldSelect) R.selectedAdminMatchIds.add(key);
    else R.selectedAdminMatchIds.delete(key);
  });
  R.renderAdminMatches(R.AdminState.matches);
};

window.toggleAdminSection = function(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('is-collapsed');
};

window.openAdminMatchesPanel = async function() {
  const panel = document.getElementById('admin-matches-panel');
  if (!panel) return;
  R.adminMatchesPanelOpen = true;
  panel.hidden = false;
  panel.classList.add('is-open');
  await R.loadAdminMatches();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.closeAdminMatchesPanel = function() {
  const panel = document.getElementById('admin-matches-panel');
  if (!panel) return;
  R.adminMatchesPanelOpen = false;
  panel.classList.remove('is-open');
  panel.hidden = true;
  R.selectedAdminMatchIds.clear();
  R.adminMatchSelectionMode = false;
  R.updateAdminBulkBar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.bulkUnfinishSelected = () => R.bulkSelectedMatches('reopen');

window.bulkDeleteSelected = () => R.bulkSelectedMatches('delete');

window.bulkDelete = R.bulkDelete;

window.bulkUnfinish = R.bulkUnfinish;

window.openRobotSettings = R.openRobotSettings;

window.saveRobotSettings = R.saveRobotSettings;

window.switchRobotTab = window.switchRobotTab || function(tab) {
  document.querySelectorAll('.robot-tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.robot-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`robot-tab-${tab}`)?.classList.add('active');
  document.getElementById(`tab-${tab}-btn`)?.classList.add('active');
};

window.runRobotSync = R.runRobotSync;

window.loadAdminMatches = R.loadAdminMatches;

window.editMatch = R.editMatch;

window.prepareFinishMatch = R.prepareFinishMatch;

window.adminUnfinishMatch = R.adminUnfinishMatch;

window.adminDeleteMatchForce = R.adminDeleteMatchForce;

window.resetOfficialPodium = R.resetOfficialPodium;

window.recalculateAllPoints = R.recalculateAllPoints;

window.checkDataIntegrity = R.checkDataIntegrity;

window.resetAllBets = R.resetAllBets;

window.renderAdminMatches = R.renderAdminMatches;

window.toggleAdminCardActions = function(cardEl, event) {
  if (
    event.target.closest('.admin-row-actions') ||
    event.target.closest('button') ||
    event.target.closest('.team-logo') ||
    event.target.closest('img') ||
    event.target.closest('.badge')
  ) {
    return;
  }

  // No modo de seleção, o card inteiro funciona como área de seleção.
  if (R.adminMatchSelectionMode) {
    const checkbox = cardEl.querySelector('.admin-match-select input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
      window.toggleAdminMatchSelection(cardEl.dataset.matchId, checkbox.checked);
    }
    return;
  }

  // No modo normal, tocar no card revela apenas as ações daquele card.
  const allCards = document.querySelectorAll('#admin-matches-list .admin-match-card');
  allCards.forEach(c => { if (c !== cardEl) c.classList.remove('active-actions'); });
  cardEl.classList.toggle('active-actions');
};

if (R.loadLeagueSettings) window.loadLeagueSettings=R.loadLeagueSettings;
if (R.openBetReceiptValidationModal) window.openBetReceiptValidationModal=R.openBetReceiptValidationModal;
if (R.openBetLockModeModal) window.openBetLockModeModal=R.openBetLockModeModal;
if (R.saveBetLockMode) window.saveBetLockMode=R.saveBetLockMode;
if (R.openScoringRulesModal) window.openScoringRulesModal=R.openScoringRulesModal;
if (R.saveScoringRules) window.saveScoringRules=R.saveScoringRules;
if (R.openChampionshipRulesModal) window.openChampionshipRulesModal=R.openChampionshipRulesModal;
if (R.saveChampionshipRules) window.saveChampionshipRules=R.saveChampionshipRules;
if (R.openChampionshipResultsModal) window.openChampionshipResultsModal=R.openChampionshipResultsModal;
if (R.saveChampionshipResults) window.saveChampionshipResults=R.saveChampionshipResults;
if (R.loadGlobalSaveLocks) window.loadGlobalSaveLocks=R.loadGlobalSaveLocks;
if (R.toggleLeagueTestMode) window.toggleLeagueTestMode=R.toggleLeagueTestMode;
if (R.refreshTestModeUI) window.refreshTestModeUI=R.refreshTestModeUI;
if (R.updateGlobalSaveLocks) window.updateGlobalSaveLocks=R.updateGlobalSaveLocks;
if (R.isSaveBetsBlocked) window.isSaveBetsBlocked=R.isSaveBetsBlocked;
if (R.isSaveKnockoutBlocked) window.isSaveKnockoutBlocked=R.isSaveKnockoutBlocked;
if (R.isRequireAllBetsEnabled) window.isRequireAllBetsEnabled=R.isRequireAllBetsEnabled;
if (R.isBetEditingBeforeLockEnabled) window.isBetEditingBeforeLockEnabled=R.isBetEditingBeforeLockEnabled;
if (R.setBetEditingBeforeLockEnabled) window.setBetEditingBeforeLockEnabled=R.setBetEditingBeforeLockEnabled;
if (R.setSaveBetsBlocked) window.setSaveBetsBlocked=R.setSaveBetsBlocked;
if (R.setSaveKnockoutBlocked) window.setSaveKnockoutBlocked=R.setSaveKnockoutBlocked;
if (R.setRequireAllBetsEnabled) window.setRequireAllBetsEnabled=R.setRequireAllBetsEnabled;
if (R.refreshSaveLocksUI) window.refreshSaveLocksUI=R.refreshSaveLocksUI;
if (R.wireSaveLocksAdmin) window.wireSaveLocksAdmin=R.wireSaveLocksAdmin;
if (R.loadAdminMatches) window.loadAdminMatches=R.loadAdminMatches;
if (R.getAdminChampionshipMode) window.getAdminChampionshipMode=R.getAdminChampionshipMode;
if (R.renderAdminMatches) window.renderAdminMatches=R.renderAdminMatches;
if (R.renderSingleMatchRow) window.renderSingleMatchRow=R.renderSingleMatchRow;
if (R.getConfiguredPodiumSize) window.getConfiguredPodiumSize=R.getConfiguredPodiumSize;
if (R.getPodiumFieldConfig) window.getPodiumFieldConfig=R.getPodiumFieldConfig;
if (R.renderOfficialPodiumFields) window.renderOfficialPodiumFields=R.renderOfficialPodiumFields;
if (R.populatePodiumSelects) window.populatePodiumSelects=R.populatePodiumSelects;
if (R.openAddMatchModal) window.openAddMatchModal=R.openAddMatchModal;
if (R.setupPhaseToggle) window.setupPhaseToggle=R.setupPhaseToggle;
if (R.loadOfficialPodiumIntoModal) window.loadOfficialPodiumIntoModal=R.loadOfficialPodiumIntoModal;
if (R.handleAddMatch) window.handleAddMatch=R.handleAddMatch;
if (R.openFinishMatchModal) window.openFinishMatchModal=R.openFinishMatchModal;
if (R.prepareFinishMatch) window.prepareFinishMatch=R.prepareFinishMatch;
if (R.finishMatch) window.finishMatch=R.finishMatch;
if (R.editMatch) window.editMatch=R.editMatch;
if (R.handleEditMatch) window.handleEditMatch=R.handleEditMatch;
if (R.adminUnfinishMatch) window.adminUnfinishMatch=R.adminUnfinishMatch;
if (R.adminDeleteMatchForce) window.adminDeleteMatchForce=R.adminDeleteMatchForce;
if (R.setPodium) window.setPodium=R.setPodium;
if (R.resetOfficialPodium) window.resetOfficialPodium=R.resetOfficialPodium;
if (R.recalculateAllPoints) window.recalculateAllPoints=R.recalculateAllPoints;
if (R.checkDataIntegrity) window.checkDataIntegrity=R.checkDataIntegrity;
if (R.openSetPodiumModal) window.openSetPodiumModal=R.openSetPodiumModal;
if (R.resetAllBets) window.resetAllBets=R.resetAllBets;
if (R.openWhitelistModal) window.openWhitelistModal=R.openWhitelistModal;
if (R.loadWhitelist) window.loadWhitelist=R.loadWhitelist;
if (R.loadStatsLockStatus) window.loadStatsLockStatus=R.loadStatsLockStatus;
if (R.updateStatsBtnUI) window.updateStatsBtnUI=R.updateStatsBtnUI;
if (R.toggleStatsLock) window.toggleStatsLock=R.toggleStatsLock;
if (R.openEmailModal) window.openEmailModal=R.openEmailModal;
if (R.loadAdminUsers) window.loadAdminUsers=R.loadAdminUsers;
if (R.openRobotSettings) window.openRobotSettings=R.openRobotSettings;
if (R.renderRobotLeagues) window.renderRobotLeagues=R.renderRobotLeagues;
if (R.setupLeagueSelects) window.setupLeagueSelects=R.setupLeagueSelects;
if (R.saveRobotSettings) window.saveRobotSettings=R.saveRobotSettings;
if (R.runRobotSync) window.runRobotSync=R.runRobotSync;
if (R.updateAdminBulkBar) window.updateAdminBulkBar=R.updateAdminBulkBar;
if (R.bulkSelectedMatches) window.bulkSelectedMatches=R.bulkSelectedMatches;
if (R.updateBetLockVisual) window.updateBetLockVisual=R.updateBetLockVisual;
if (R.bulkDelete) window.bulkDelete=R.bulkDelete;
if (R.bulkUnfinish) window.bulkUnfinish=R.bulkUnfinish;
