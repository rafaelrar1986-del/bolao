// Admin facade/orchestrator. Domain logic is split under ./admin/.
import { R } from './admin/adminRuntime.js';
import { openModal, closeModal } from './ui.js';
import { renderPhaseControls } from './admin/adminPhaseVisibility.js';
R.renderPhaseControls = renderPhaseControls;
import './admin/settings.js';
import './admin/championship.js';
import './admin/locks.js';
import './admin/matches.js';
import './admin/users.js';
import './admin/robot.js';
import './admin/leagues.js';
import './adminBindings.js';

// Named exports preserved for app4.js and other consumers that historically imported
// these Admin lock helpers directly from the monolithic admin.js.
export { openModal, closeModal };

export const loadGlobalSaveLocks = (...args) => R.loadGlobalSaveLocks(...args);
export const isSaveBetsBlocked = (...args) => R.isSaveBetsBlocked(...args);
export const isSaveKnockoutBlocked = (...args) => R.isSaveKnockoutBlocked(...args);
export const isRequireAllBetsEnabled = (...args) => R.isRequireAllBetsEnabled(...args);
export const isBetEditingBeforeLockEnabled = (...args) => R.isBetEditingBeforeLockEnabled(...args);
export const refreshSaveLocksUI = (...args) => R.refreshSaveLocksUI(...args);
export const loadAdminUsers = (...args) => R.loadAdminUsers(...args);

/**
 * Re-enters the Admin panel using the league currently selected by the
 * participant as its starting management context. If Admin was already
 * initialized, reload the selected league so its data follows the new
 * administrative context without re-binding event listeners.
 */
export async function enterAdminPanel() {
  R.syncAdminLeagueWithSelectedLeague();

  if (!R.AdminState.adminInitialized) {
    initAdmin();
    return;
  }

  const select = document.getElementById('admin-league-selector');
  if (!select) return;

  try {
    await R.loadAdminLeagues({ selectCurrent: true });
    const adminLeagueId = R.getAdminLeagueId();
    if (!adminLeagueId) return;

    if (String(select.value) !== String(adminLeagueId)) {
      select.value = String(adminLeagueId);
    }

    if (typeof R.switchAdminLeague === 'function') {
      await R.switchAdminLeague();
    }
  } catch (err) {
    console.warn('Erro ao sincronizar liga ao entrar no Admin:', err);
  }
}

export function initAdmin() {
  if (R.AdminState.adminInitialized) return;
  // The public league is the default administrative context on first entry.
  R.syncAdminLeagueWithSelectedLeague();
  R.AdminState.adminInitialized = true;
  console.log('✅ initAdmin executado');
  window.closeModal = closeModal;
  window.openModal = openModal;
  window.openAddMatchModal = R.openAddMatchModal;
  window.openFinishMatchModal = R.openFinishMatchModal;
  window.openSetPodiumModal = R.openSetPodiumModal;
  window.openCreateLeagueModal = R.openCreateLeagueModal;
  window.switchAdminLeague = R.switchAdminLeague;
  window.loadAdminLeagues = R.loadAdminLeagues;

  // 🆕 NOVOS HANDLERS GLOBAIS
  window.openScoringRulesModal = R.openScoringRulesModal;
  window.saveScoringRules = R.saveScoringRules;
  window.openChampionshipRulesModal = R.openChampionshipRulesModal;
  window.saveChampionshipRules = R.saveChampionshipRules;
  window.openChampionshipResultsModal = R.openChampionshipResultsModal;
  window.saveChampionshipResults = R.saveChampionshipResults;
  window.openBetLockModeModal = R.openBetLockModeModal;
  window.saveBetLockMode = R.saveBetLockMode;
  window.openBetReceiptValidationModal = R.openBetReceiptValidationModal;

  window.handleAddMatch = R.handleAddMatch;
  window.prepareFinishMatch = R.prepareFinishMatch;
  window.finishMatch = R.finishMatch;

  window.editMatch = R.editMatch;
  window.adminUnfinishMatch = R.adminUnfinishMatch;
  window.adminDeleteMatchForce = R.adminDeleteMatchForce;

  window.recalculateAllPoints = R.recalculateAllPoints;
  window.checkDataIntegrity = R.checkDataIntegrity;
  window.resetAllBets = R.resetAllBets;
  window.setPodium = R.setPodium;

  const adminLeagueSelector = document.getElementById('admin-league-selector');
  if (adminLeagueSelector) {
    adminLeagueSelector.addEventListener('change', R.switchAdminLeague);
  }

  const btnWhitelist = document.getElementById('btn-open-whitelist-modal');
  if (btnWhitelist) btnWhitelist.addEventListener('click', R.openWhitelistModal);

  // Carrega primeiro as regras do campeonato. A lista de partidas usa essas
  // regras para decidir se a seção correta é Grupos, Pontos Corridos ou Mata-mata.
  // Antes, loadAdminMatches() era disparado em paralelo e a UI podia nascer
  // como "Grupos" e nunca ser redesenhada quando as regras chegavam.

  R.loadStatsLockStatus();
  const btnStats = document.getElementById('btn-toggle-stats-lock');
  if (btnStats) btnStats.addEventListener('click', R.toggleStatsLock);

  const btnEmail = document.getElementById('btn-open-email-modal');
  if (btnEmail) btnEmail.addEventListener('click', R.openEmailModal);
  const btnReceiptValidation = document.getElementById('btn-open-receipt-validation');
  if (btnReceiptValidation) {
    btnReceiptValidation.addEventListener('click', R.openBetReceiptValidationModal);
  }

  const btnAdd = document.getElementById('btn-open-add-modal');
  if (btnAdd) btnAdd.addEventListener('click', R.openAddMatchModal);

  const btnFinish = document.getElementById('btn-open-finish-modal');
  if (btnFinish) btnFinish.addEventListener('click', R.openFinishMatchModal);

  const btnPodium = document.getElementById('btn-open-podium-modal');
  if (btnPodium) btnPodium.addEventListener('click', R.openSetPodiumModal);

  // 🆕 BOTÕES NOVOS DE REGRAS
  const btnScoring = document.getElementById('btn-open-scoring-modal');
  if (btnScoring) btnScoring.addEventListener('click', R.openScoringRulesModal);

  const btnChampRules = document.getElementById('btn-open-championship-rules-modal');
  if (btnChampRules) btnChampRules.addEventListener('click', R.openChampionshipRulesModal);

  const btnChampResults = document.getElementById('btn-open-championship-results-modal');
  if (btnChampResults) btnChampResults.addEventListener('click', R.openChampionshipResultsModal);

  const btnBetLockMode = document.getElementById('btn-open-bet-lock-mode-modal');
  if (btnBetLockMode) btnBetLockMode.addEventListener('click', R.openBetLockModeModal);

  const btnRecalc = document.getElementById('btn-recalc');
  if (btnRecalc) btnRecalc.addEventListener('click', R.recalculateAllPoints);
  const btnIntegrity = document.getElementById('btn-integrity');
  if (btnIntegrity) btnIntegrity.addEventListener('click', R.checkDataIntegrity);

  R.wireSaveLocksAdmin();

  const btnTestMode = document.getElementById('btn-toggle-test-mode');
  if (btnTestMode) {
    btnTestMode.addEventListener('click', R.toggleLeagueTestMode);
  }
  R.refreshTestModeUI();

  // Primeiro resolve o campeonato que o Admin está gerenciando.
  // O estado público selectedLeagueId do participante permanece intocado.
  R.loadAdminLeagues({ selectCurrent: true })
    .catch(err => console.warn('Erro ao carregar campeonatos do Admin:', err))
    .finally(() => {
      R.loadLeagueSettings()
        .catch(err => console.warn('Erro ao carregar regras antes da lista de partidas:', err))
        .finally(() => {
          R.loadAdminMatches();
          renderPhaseControls();
        });
    });
}
