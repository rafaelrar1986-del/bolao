import { api } from '../api.js';
import { flagEmoji } from '../flags.js';
import { toast, openModal, closeModal } from '../ui.js';
import { renderTeamMedia } from '../matches/matchesUtils.js';
import { DEFAULT_SCORING, DEFAULT_CHAMPIONSHIP_RULES, SAVE_LOCK_KEYS } from './adminConstants.js';
import { R, registerAdminFunctions } from './adminRuntime.js';
import { escapeHtml, knockoutDisplayLabel } from './adminUtils.js';

async function loadGlobalSaveLocks() {
  try {
    const leagueId = R.getAdminLeagueId();
    const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
    if (res && res.success && res.data) {
      R.GLOBAL_SAVE_LOCKS = { ...R.GLOBAL_SAVE_LOCKS, ...res.data };
      R.refreshTestModeUI();
    }
  } catch (e) {
    console.warn('Não foi possível carregar configurações globais', e);
  }
}

async function toggleLeagueTestMode() {
  const leagueId = R.getAdminLeagueId();
  const currentlyEnabled = R.GLOBAL_SAVE_LOCKS.testMode === true;
  const enabled = !currentlyEnabled;

  if (enabled) {
    const confirmed = window.confirm(
      'ATIVAR MODO DE TESTE?\n\n' +
      'Isso permitirá editar regras após o início do campeonato e fazer apostas em partidas já iniciadas ou finalizadas.\n\n' +
      'As travas atuais serão guardadas para restauração quando o modo for encerrado.'
    );
    if (!confirmed) return;
  } else {
    const confirmed = window.confirm(
      'ENCERRAR MODO DE TESTE?\n\n' +
      'A configuração anterior da liga será restaurada.'
    );
    if (!confirmed) return;
  }

  try {
    const res = await api.post('/api/settings/test-mode', {
      leagueId,
      enabled
    });

    if (!res?.success) {
      throw new Error(res?.message || 'Não foi possível alterar o modo de teste.');
    }

    R.GLOBAL_SAVE_LOCKS = {
      ...R.GLOBAL_SAVE_LOCKS,
      ...(res.data || {}),
      testMode: Boolean(res.testMode)
    };

    // Atualiza o estado do frontend de partidas imediatamente.
    if (window.STATE) {
      window.STATE.testMode = Boolean(res.testMode);
      window.STATE.lockedPhases = new Set(res.data?.lockedPhases || []);
      window.STATE.unlockedPhases = new Set(res.data?.unlockedPhases || []);
      window.STATE.betLockMode =
        res.data?.betLockMode === 'match' ? 'match' : 'grade';
    }

    // Se a página já estiver aberta, a rotina de salvar do app passa a
    // enxergar os bloqueios restaurados/liberados sem precisar relogar.
    R.GLOBAL_SAVE_LOCKS.blockSaveBets = Boolean(res.data?.blockSaveBets);
    R.GLOBAL_SAVE_LOCKS.blockSaveKnockout = Boolean(res.data?.blockSaveKnockout);

    R.refreshTestModeUI();

    if (window.STATE && typeof window.renderMatches === 'function') {
      try { window.renderMatches(); } catch (_) {}
    }
    if (window.STATE && typeof window.renderKnockoutMatches === 'function') {
      try { window.renderKnockoutMatches(); } catch (_) {}
    }

    window.dispatchEvent(new CustomEvent('league-test-mode-changed', {
      detail: { enabled: Boolean(res.testMode) }
    }));

    toast(
      enabled
        ? '🧪 Modo de teste ATIVADO. Partidas encerradas e regras estão liberadas.'
        : '🔒 Modo de teste encerrado. Configuração anterior restaurada.',
      'success'
    );
  } catch (err) {
    console.error('Erro ao alternar modo de teste:', err);
    toast(err.message || 'Erro ao alterar modo de teste.', 'error');
  }
}

function refreshTestModeUI() {
  const btn = document.getElementById('btn-toggle-test-mode');
  if (!btn) return;

  const enabled = R.GLOBAL_SAVE_LOCKS.testMode === true;
  btn.classList.toggle('btn-danger', enabled);
  btn.classList.toggle('btn-warning', !enabled);
  btn.innerHTML = enabled
    ? '<i class="fas fa-flask"></i><span style="white-space:nowrap;">Teste ON</span>'
    : '<i class="fas fa-flask"></i><span style="white-space:nowrap;">Teste</span>';
  btn.title = enabled
    ? 'Modo de teste ativo — clique para encerrar e restaurar as travas'
    : 'Ativar modo de teste temporário';
}

async function updateGlobalSaveLocks(patch) {
  try {
    const leagueId = R.getAdminLeagueId();
    const dataToSend = { ...patch, leagueId };
    const res = await api.post('/api/settings/global', dataToSend);
    if (res && res.success && res.data) {
      R.GLOBAL_SAVE_LOCKS = { ...R.GLOBAL_SAVE_LOCKS, ...res.data };
      return true;
    }
  } catch (e) {
    console.warn('Falha ao atualizar configurações globais', e);
  }
  return false;
}

function isSaveBetsBlocked() {
  try {
    if (R.GLOBAL_SAVE_LOCKS && typeof R.GLOBAL_SAVE_LOCKS.blockSaveBets !== 'undefined') {
      return !!R.GLOBAL_SAVE_LOCKS.blockSaveBets;
    }
    return localStorage.getItem(SAVE_LOCK_KEYS.bets) === '1';
  } catch (e) { return false; }
}

function isSaveKnockoutBlocked() {
  try {
    if (R.GLOBAL_SAVE_LOCKS && typeof R.GLOBAL_SAVE_LOCKS.blockSaveKnockout !== 'undefined') {
      return !!R.GLOBAL_SAVE_LOCKS.blockSaveKnockout;
    }
    return localStorage.getItem(SAVE_LOCK_KEYS.knockout) === '1';
  } catch (e) { return false; }
}

function isRequireAllBetsEnabled() {
  try {
    if (R.GLOBAL_SAVE_LOCKS && typeof R.GLOBAL_SAVE_LOCKS.requireAllBets !== 'undefined') {
      return !!R.GLOBAL_SAVE_LOCKS.requireAllBets;
    }
    return localStorage.getItem(SAVE_LOCK_KEYS.requireAll) === '1';
  } catch (e) { return false; }
}

function isBetEditingBeforeLockEnabled() {
  return R.GLOBAL_SAVE_LOCKS?.allowBetEditingBeforeLock !== false;
}

async function setBetEditingBeforeLockEnabled(value) {
  const ok = await R.updateGlobalSaveLocks({ allowBetEditingBeforeLock: !!value });
  if (!ok) return false;
  R.GLOBAL_SAVE_LOCKS.allowBetEditingBeforeLock = !!value;
  return true;
}

async function setSaveBetsBlocked(value) {
  try {
    const ok = await R.updateGlobalSaveLocks({ blockSaveBets: !!value });
    if (!ok) {
      if (value) localStorage.setItem(SAVE_LOCK_KEYS.bets, '1');
      else localStorage.removeItem(SAVE_LOCK_KEYS.bets);
    }
  } catch (e) {}
}

async function setSaveKnockoutBlocked(value) {
  try {
    const ok = await R.updateGlobalSaveLocks({ blockSaveKnockout: !!value });
    if (!ok) {
      if (value) localStorage.setItem(SAVE_LOCK_KEYS.knockout, '1');
      else localStorage.removeItem(SAVE_LOCK_KEYS.knockout);
    }
  } catch (e) {}
}

async function setRequireAllBetsEnabled(value) {
  try {
    const ok = await R.updateGlobalSaveLocks({ requireAllBets: !!value });
    if (!ok) {
      if (value) localStorage.setItem(SAVE_LOCK_KEYS.requireAll, '1');
      else localStorage.removeItem(SAVE_LOCK_KEYS.requireAll);
    }
  } catch (e) {}
}

function refreshSaveLocksUI() {
  const btnBets = document.getElementById('btn-toggle-save-bets');
  const btnKO = document.getElementById('btn-toggle-save-knockout');
  const btnRequireAll = document.getElementById('btn-toggle-require-all-bets');
  const btnEditBets = document.getElementById('btn-toggle-edit-bets-before-lock');

  if (btnBets) {
    const blocked = R.isSaveBetsBlocked();
    btnBets.innerHTML = `<i class="fas ${blocked ? 'fa-lock' : 'fa-lock-open'}"></i>`;
    btnBets.classList.toggle('btn-danger', blocked);
    btnBets.classList.toggle('btn-secondary', !blocked);
    btnBets.classList.toggle('is-blocked', blocked);
    btnBets.title = blocked ? 'Desbloquear salvar palpites' : 'Bloquear salvar palpites';
  }

  if (btnKO) {
    const blocked = R.isSaveKnockoutBlocked();
    btnKO.innerHTML = `<i class="fas ${blocked ? 'fa-lock' : 'fa-lock-open'}"></i>`;
    btnKO.classList.toggle('btn-danger', blocked);
    btnKO.classList.toggle('btn-secondary', !blocked);
    btnKO.classList.toggle('is-blocked', blocked);
    btnKO.title = blocked ? 'Desbloquear salvar mata-mata' : 'Bloquear salvar mata-mata';
  }

  if (btnRequireAll) {
    const enabled = R.isRequireAllBetsEnabled();
    btnRequireAll.innerHTML = `<i class="fas ${enabled ? 'fa-check-circle' : 'fa-circle'}"></i>`;
    btnRequireAll.classList.toggle('btn-primary', enabled);
    btnRequireAll.classList.toggle('btn-secondary', !enabled);
    btnRequireAll.classList.toggle('is-active', enabled);
    btnRequireAll.title = enabled ? 'Não exigir todos os palpites' : 'Exigir todos os palpites antes de salvar';
  }

  if (btnEditBets) {
    const enabled = R.isBetEditingBeforeLockEnabled();
    btnEditBets.innerHTML = `<i class="fas ${enabled ? 'fa-pencil-alt' : 'fa-ban'}"></i>`;
    btnEditBets.classList.toggle('btn-primary', enabled);
    btnEditBets.classList.toggle('btn-secondary', !enabled);
    btnEditBets.classList.toggle('is-active', enabled);
    btnEditBets.title = enabled
      ? 'Impedir edição de palpites já salvos antes do bloqueio'
      : 'Permitir edição de palpites já salvos antes do bloqueio';
  }

  const saveBetsBtn = document.getElementById('save-bets');
  if (saveBetsBtn) {
    const blocked = R.isSaveBetsBlocked();
    saveBetsBtn.disabled = blocked;
    saveBetsBtn.classList.toggle('btn-disabled', blocked);
    saveBetsBtn.style.opacity = blocked ? '0.6' : '';
    saveBetsBtn.style.cursor = blocked ? 'not-allowed' : '';
  }

  const saveKoBtn = document.getElementById('save-knockout-bets');
  if (saveKoBtn) {
    const blocked = R.isSaveKnockoutBlocked();
    saveKoBtn.disabled = blocked;
    saveKoBtn.classList.toggle('btn-disabled', blocked);
    saveKoBtn.style.opacity = blocked ? '0.6' : '';
    saveKoBtn.style.cursor = blocked ? 'not-allowed' : '';
  }

  const requireCheckbox = document.getElementById('require-all-bets');
  if (requireCheckbox) {
    const enabled = R.isRequireAllBetsEnabled();
    if (enabled) {
      requireCheckbox.checked = true;
      requireCheckbox.disabled = true;
      requireCheckbox.title = 'Esta opção foi exigida pelo administrador.';
    } else {
      requireCheckbox.disabled = false;
      requireCheckbox.title = '';
    }
  }
}

function wireSaveLocksAdmin() {
  R.loadGlobalSaveLocks().then(() => R.refreshSaveLocksUI());
  const btnBets = document.getElementById('btn-toggle-save-bets');
  const btnKO   = document.getElementById('btn-toggle-save-knockout');
  const btnRequireAll = document.getElementById('btn-toggle-require-all-bets');
  const btnEditBets = document.getElementById('btn-toggle-edit-bets-before-lock');

  if (btnBets) {
    btnBets.addEventListener('click', () => {
      const newVal = !R.isSaveBetsBlocked();
      R.setSaveBetsBlocked(newVal).then(() => {
        R.GLOBAL_SAVE_LOCKS.blockSaveBets = newVal;
        R.refreshSaveLocksUI();
      });
      toast(newVal ? 'Salvar palpites bloqueado.' : 'Salvar palpites liberado.', 'info');
    });
  }

  if (btnKO) {
    btnKO.addEventListener('click', () => {
      const newVal = !R.isSaveKnockoutBlocked();
      R.setSaveKnockoutBlocked(newVal).then(() => {
        R.GLOBAL_SAVE_LOCKS.blockSaveKnockout = newVal;
        R.refreshSaveLocksUI();
      });
      toast(newVal ? 'Salvar mata-mata bloqueado.' : 'Salvar mata-mata liberado.', 'info');
    });
  }

  if (btnRequireAll) {
    btnRequireAll.addEventListener('click', () => {
      const newVal = !R.isRequireAllBetsEnabled();
      R.GLOBAL_SAVE_LOCKS.requireAllBets = newVal;
      R.refreshSaveLocksUI();
      R.setRequireAllBetsEnabled(newVal);
      toast(newVal ? 'Exigência de todos os palpites ativada.' : 'Exigência desativada.', 'info');
    });
  }

  if (btnEditBets) {
    btnEditBets.addEventListener('click', async () => {
      const newVal = !R.isBetEditingBeforeLockEnabled();
      const ok = await R.setBetEditingBeforeLockEnabled(newVal);
      if (!ok) {
        toast('Não foi possível atualizar a permissão de edição.', 'error');
        return;
      }
      R.refreshSaveLocksUI();
      if (window.STATE) {
        window.STATE.allowBetEditingBeforeLock = newVal;
        try { window.renderMatches?.(); } catch (_) {}
        try { window.renderKnockoutMatches?.(); } catch (_) {}
      }
      toast(
        newVal
          ? 'Edição de palpites antes do bloqueio liberada.'
          : 'Edição de palpites já salvos antes do bloqueio desativada.',
        'info'
      );
    });
  }
}

registerAdminFunctions({loadGlobalSaveLocks: loadGlobalSaveLocks, toggleLeagueTestMode: toggleLeagueTestMode, refreshTestModeUI: refreshTestModeUI, updateGlobalSaveLocks: updateGlobalSaveLocks, isSaveBetsBlocked: isSaveBetsBlocked, isSaveKnockoutBlocked: isSaveKnockoutBlocked, isRequireAllBetsEnabled: isRequireAllBetsEnabled, isBetEditingBeforeLockEnabled: isBetEditingBeforeLockEnabled, setBetEditingBeforeLockEnabled: setBetEditingBeforeLockEnabled, setSaveBetsBlocked: setSaveBetsBlocked, setSaveKnockoutBlocked: setSaveKnockoutBlocked, setRequireAllBetsEnabled: setRequireAllBetsEnabled, refreshSaveLocksUI: refreshSaveLocksUI, wireSaveLocksAdmin: wireSaveLocksAdmin});
