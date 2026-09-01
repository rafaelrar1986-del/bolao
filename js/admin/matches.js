import { api } from '../api.js';
import { flagEmoji } from '../flags.js';
import { toast, openModal, closeModal } from '../ui.js';
import { renderTeamMedia } from '../matches/matchesUtils.js';
import { DEFAULT_SCORING, DEFAULT_CHAMPIONSHIP_RULES, SAVE_LOCK_KEYS } from './adminConstants.js';
import { R, registerAdminFunctions } from './adminRuntime.js';
import { escapeHtml, knockoutDisplayLabel } from './adminUtils.js';

async function loadAdminMatches() {
  try {
    const leagueId = localStorage.getItem('selectedLeagueId') || '1';
    const res = await api.get(`/api/matches/admin/all?leagueId=${leagueId}`);
    if (!res || !res.success) throw new Error(res?.message || 'Erro ao listar partidas');
    R.AdminState.matches = res.data || [];
    R.renderAdminMatches(R.AdminState.matches);
  } catch (err) {
    console.error('Erro loadAdminMatches:', err);
    const container = $adminMatchesList();
    if (container) container.innerHTML = '<p>Erro ao carregar partidas.</p>';
    toast('Erro ao carregar partidas', 'error');
  }
}

function getAdminChampionshipMode(matchesList = []) {
  const rules = R.CurrentSettings?.championshipRules || {};
  const explicitGroup = rules.hasGroupPhase === true;
  const explicitKnockout = rules.hasKnockoutPhase === true;

  // A configuração salva é a autoridade. Quando não existe uma configuração
  // explícita (ex.: liga antiga), usamos as partidas como fallback seguro.
  const hasRuleFields =
    Object.prototype.hasOwnProperty.call(rules, 'hasGroupPhase') ||
    Object.prototype.hasOwnProperty.call(rules, 'hasKnockoutPhase');

  if (hasRuleFields) {
    if (!explicitGroup && !explicitKnockout) return 'points_run';
    if (explicitGroup && explicitKnockout) return 'group+knockout';
    if (explicitGroup) return 'group';
    return 'knockout';
  }

  const regular = (matchesList || []).filter(m => String(m?.phase || '').toLowerCase() !== 'knockout');
  const hasPointsRun = regular.some(m => {
    const phase = String(m?.phase || '').toLowerCase();
    return phase === 'pontos_corridos' || phase === 'points_run';
  });
  const hasKnockoutMatches = (matchesList || []).some(m => String(m?.phase || '').toLowerCase() === 'knockout');
  if (hasPointsRun && !hasKnockoutMatches) return 'points_run';
  if (!hasPointsRun && hasKnockoutMatches) return 'knockout';
  return 'group';
}

function renderAdminMatches(matchesList) {
  const container = $adminMatchesList();
  if (!container) return;

  if (!matchesList || matchesList.length === 0) {
    container.innerHTML = '<p class="admin-empty-state">Nenhuma partida encontrada.</p>';
    R.updateAdminBulkBar();
    return;
  }

  const validIds = new Set(matchesList.map(m => String(m.matchId)));
  [...R.selectedAdminMatchIds].forEach(id => {
    if (!validIds.has(String(id))) R.selectedAdminMatchIds.delete(String(id));
  });

  const championshipMode = R.getAdminChampionshipMode(matchesList);
  const availableAdminTabs = championshipMode === 'points_run'
    ? ['points_run']
    : championshipMode === 'knockout'
      ? ['knockout']
      : championshipMode === 'group+knockout'
        ? ['group', 'knockout']
        : ['group'];

  if (!availableAdminTabs.includes(R.activeAdminTab)) {
    R.activeAdminTab = availableAdminTabs[0];
  }

  const adminTabConfig = {
    group: { icon: 'fas fa-users', label: 'Grupos' },
    points_run: { icon: 'fas fa-futbol', label: 'Pontos Corridos' },
    knockout: { icon: 'fas fa-sitemap', label: 'Mata-mata' }
  };

  let html = `
    <div class="admin-match-toolbar">
      <div class="admin-match-tabs" role="tablist">
        ${availableAdminTabs.map(tab => `
          <button class="admin-match-tab ${R.activeAdminTab === tab ? 'active' : ''}" onclick="window.switchAdminTab('${tab}')">
            <i class="${adminTabConfig[tab].icon}"></i><span>${adminTabConfig[tab].label}</span>
          </button>
        `).join('')}
      </div>
      <div class="admin-match-toolbar-actions">
        <button class="admin-select-mode-btn ${R.adminMatchSelectionMode ? 'active' : ''}" type="button"
          onclick="window.toggleAdminSelectionMode()" title="Selecionar partidas">
          <i class="fas fa-check-square"></i>
        </button>
        <button class="admin-close-matches" type="button" onclick="window.closeAdminMatchesPanel()" title="Fechar lista">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>
  `;

  const filteredMatches = matchesList.filter(m => {
    const phase = String(m?.phase || '').toLowerCase();
    if (R.activeAdminTab === 'points_run') {
      return phase === 'pontos_corridos' || phase === 'points_run';
    }
    if (R.activeAdminTab === 'group') {
      return phase === 'group' || (!phase && championshipMode !== 'points_run');
    }
    return phase === 'knockout';
  });

  if (filteredMatches.length === 0) {
    html += `<p class="admin-empty-state">Nenhuma partida encontrada nesta fase.</p>`;
    container.innerHTML = html;
    R.updateAdminBulkBar();
    return;
  }

  const leagues = {};
  filteredMatches.forEach(m => {
    const leagueName = m.leagueName || "Outras Ligas";
    if (!leagues[leagueName]) leagues[leagueName] = [];
    leagues[leagueName].push(m);
  });

  Object.keys(leagues).forEach((leagueName, lIdx) => {
    const leagueMatches = leagues[leagueName];
    const groups = {};
    leagueMatches.forEach(m => {
      const phase = String(m.phase || '').toLowerCase();
      let g = m.group || '';
      if (phase === 'group' || phase === 'pontos_corridos' || phase === 'points_run') {
        g = Number.isInteger(Number(m.roundNumber)) && Number(m.roundNumber) > 0
          ? `Rodada ${Number(m.roundNumber)}` : (g || 'Geral');
      }
      if (!g) g = 'Geral';
      if (!groups[g]) groups[g] = [];
      groups[g].push(m);
    });

    html += `
      <section class="admin-league-block">
        <button class="admin-league-header" type="button" onclick="window.toggleAdminSection('admin-league-${lIdx}')">
          <span class="admin-section-title">
            <i class="fas fa-trophy"></i>
            <strong>${String(leagueName).toUpperCase()}</strong>
            <small>${leagueMatches.length} jogos</small>
          </span>
          <i class="fas fa-chevron-down admin-chevron"></i>
        </button>
        <div id="admin-league-${lIdx}" class="admin-league-content">
          ${Object.keys(groups).map((groupName, gIdx) => {
            const groupMatches = groups[groupName];
            const uniqueId = `lg-${lIdx}-gr-${gIdx}`;
            const allGroupSelected = groupMatches.length > 0 &&
              groupMatches.every(m => R.selectedAdminMatchIds.has(String(m.matchId)));
            const lid = String(leagueMatches[0]?.leagueId || localStorage.getItem('selectedLeagueId') || '');
            const firstMatch = groupMatches[0] || {};
            const phase = String(firstMatch.phase || '').toLowerCase();
            const roundNumber = Number(firstMatch.roundNumber);
            const hasRound = (phase === 'group' || phase === 'pontos_corridos' || phase === 'points_run') &&
              Number.isInteger(roundNumber) && roundNumber > 0;
            const ln = String(leagueName).replace(/'/g, "\\'");
            const gn = String(groupName).replace(/'/g, "\\'");
            const bulkParams = hasRound
              ? `{leagueId:'${lid}',phase:'${phase}',roundNumber:${roundNumber}}`
              : `{leagueId:'${lid}',leagueName:'${ln}',groupName:'${gn}'}`;
            return `
              <section class="admin-round-block">
                <button class="admin-round-header" type="button" onclick="window.toggleAdminSection('admin-round-${uniqueId}')">
                  <span>
                    <i class="fas fa-folder-open"></i>
                    <strong>${String(groupName).toUpperCase()}</strong>
                    <small>${groupMatches.length} jogos</small>
                  </span>
                  <i class="fas fa-chevron-down admin-chevron"></i>
                </button>
                <div id="admin-round-${uniqueId}" class="admin-round-content">
                  <div class="admin-round-tools ${R.adminMatchSelectionMode ? 'selection-mode-on' : ''}">
                    ${R.adminMatchSelectionMode ? `<label class="admin-select-group" onclick="event.stopPropagation()">
                      <input type="checkbox" ${allGroupSelected ? 'checked' : ''}
                        onchange="window.toggleAdminGroupSelection(this, ${JSON.stringify(groupMatches.map(m => m.matchId))})">
                      <span>Selecionar rodada</span>
                    </label>` : '<span></span>'}
                    <div class="admin-round-bulk-actions">
                      <button type="button" class="admin-mini-action admin-mini-reopen"
                        onclick="event.stopPropagation(); window.bulkUnfinish(${bulkParams})"
                        title="Reabrir grupo/rodada"><i class="fas fa-undo"></i></button>
                      <button type="button" class="admin-mini-action admin-mini-delete"
                        onclick="event.stopPropagation(); window.bulkDelete(${bulkParams})"
                        title="Excluir grupo/rodada"><i class="fas fa-trash"></i></button>
                    </div>
                  </div>
                  <div class="admin-match-list">
                    ${groupMatches.map(match => R.renderSingleMatchRow(match)).join('')}
                  </div>
                </div>
              </section>
            `;
          }).join('')}
        </div>
      </section>
    `;
  });

  container.innerHTML = html;
  R.updateAdminBulkBar();
}

function renderSingleMatchRow(match) {
  const statusLabels = {
    scheduled: 'Agendado', '1_tempo': '1º Tempo', intervalo: 'Intervalo',
    '2_tempo': '2º Tempo', prorrogacao: 'Prorrogação', penaltis: 'Pênaltis',
    finished: 'Finalizado', cancelled: 'Cancelado', postponed: 'Adiado'
  };

  const isLive = ['1_tempo','intervalo','2_tempo','prorrogacao','penaltis'].includes(match.status);
  const statusClass = match.status === 'finished' ? 'finished' : isLive ? 'in_progress' : 'scheduled';
  const score = (match.status === 'finished' || isLive)
    ? `<span class="score-box">${match.scoreA ?? 0} x ${match.scoreB ?? 0}</span>`
    : '<span class="score-box">VS</span>';
  const penaltyScore = (match.penaltiesA !== null && match.penaltiesB !== null)
    ? `<span class="penalty-score-box">Pênaltis ${match.penaltiesA} - ${match.penaltiesB}</span>` : '';
  const statusText = statusLabels[match.status] || match.status;
  const selected = R.selectedAdminMatchIds.has(String(match.matchId));

  const finishOrReopen = match.status !== 'finished'
    ? `<button class="admin-match-action admin-action-finish" onclick="event.stopPropagation(); prepareFinishMatch(${match.matchId})" title="Finalizar"><i class="fas fa-flag-checkered"></i></button>`
    : `<button class="admin-match-action admin-action-reopen" onclick="event.stopPropagation(); adminUnfinishMatch(${match.matchId})" title="Reabrir"><i class="fas fa-undo"></i></button>`;

  const teamA = String(match.teamA || '').replace(/'/g, "\\'");
  const teamB = String(match.teamB || '').replace(/'/g, "\\'");

  return `
    <article class="admin-match-card ${statusClass} ${selected ? 'is-selected' : ''}"
      data-match-id="${match.matchId}" onclick="window.toggleAdminCardActions(this, event)">
      ${R.adminMatchSelectionMode ? `<div class="admin-match-select" onclick="event.stopPropagation()">
        <input type="checkbox" aria-label="Selecionar partida ${match.matchId}"
          ${selected ? 'checked' : ''}
          onchange="window.toggleAdminMatchSelection(${match.matchId}, this.checked)">
      </div>` : ''}
      <div class="admin-match-main">
        <div class="admin-match-top">
          <span>ID ${match.matchId}</span>
          <span>API: ${match.apiId || '---'}</span>
          <span class="admin-match-phase">${
            String(match.phase || '').toLowerCase() === 'pontos_corridos' || String(match.phase || '').toLowerCase() === 'points_run'
              ? (match.phaseName || (Number(match.roundNumber) > 0 ? `Rodada ${Number(match.roundNumber)}` : 'Pontos Corridos'))
              : (match.group || '-')
          }</span>
          <span class="admin-match-menu"><i class="fas fa-ellipsis-v"></i></span>
        </div>
        <div class="admin-match-teams">
          <div class="admin-team admin-team-home"><span>${match.teamA}</span>${renderTeamMedia(match.teamA, match.logoA)}</div>
          ${score}
          <div class="admin-team admin-team-away">${renderTeamMedia(match.teamB, match.logoB)}<span>${match.teamB}</span></div>
        </div>
        <div class="admin-match-meta">
          <span class="admin-status ${statusClass}">${statusText}</span>
          ${penaltyScore}
          <span class="admin-bets-count"
            onclick="event.stopPropagation(); showMatchBetsModal(${match.matchId}, '${teamA} vs ${teamB}')">
            <i class="fas fa-ticket-alt"></i> ${match.betsCount || 0}
          </span>
        </div>
        <div class="admin-match-actions" aria-hidden="true">
          <button class="admin-match-action admin-action-edit" onclick="event.stopPropagation(); editMatch(${match.matchId})" title="Editar"><i class="fas fa-edit"></i></button>
          ${finishOrReopen}
          <button class="admin-match-action admin-action-delete" onclick="event.stopPropagation(); adminDeleteMatchForce(${match.matchId})" title="Excluir"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    </article>
  `;
}

function getConfiguredPodiumSize() {
  const size = Number(R.CurrentSettings?.championshipRules?.podiumSize ?? 4);
  return Math.min(4, Math.max(1, Number.isFinite(size) ? size : 4));
}

function getPodiumFieldConfig() {
  return [
    { key: 'first',  id: 'podium-first',  label: '🥇 1º Lugar' },
    { key: 'second', id: 'podium-second', label: '🥈 2º Lugar' },
    { key: 'third',  id: 'podium-third',  label: '🥉 3º Lugar' },
    { key: 'fourth', id: 'podium-fourth', label: '⭐ 4º Lugar' }
  ];
}

function renderOfficialPodiumFields() {
  const container = document.getElementById('official-podium-fields');
  if (!container) return;

  const size = R.getConfiguredPodiumSize();
  const fields = R.getPodiumFieldConfig().slice(0, size);

  container.innerHTML = `
    <div class="form-row">
      ${fields.map(field => `
        <div class="form-group" data-podium-position="${fields.indexOf(field) + 1}">
          <label>${field.label}</label>
          <select id="${field.id}"></select>
        </div>
      `).join('')}
    </div>
    <small style="display:block; margin-top:6px; color:#888;">
      O pódio oficial segue o tamanho definido em <strong>Regras do Campeonato</strong>: ${size} ${size === 1 ? 'posição' : 'posições'}.
    </small>
  `;
}

function populatePodiumSelects() {
  const size = R.getConfiguredPodiumSize();
  const ids = R.getPodiumFieldConfig().slice(0, size).map(f => f.id);
  const selects = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (!selects.length) return;

  const set = new Set();
  (R.AdminState.matches || []).forEach(m => {
    if (m?.teamA) set.add(m.teamA);
    if (m?.teamB) set.add(m.teamB);
  });
  const teams = Array.from(set).sort((a, b) => a.localeCompare(b));

  selects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>' +
      teams.map(t => `<option value="${t}">${R.withFlag(t)}</option>`).join('');
    if (current && teams.includes(current)) sel.value = current;
  });
}

async function openAddMatchModal() {
  const modal = document.getElementById('add-match-modal');
  if (!modal) return toast('Modal de adicionar partida não encontrado', 'error');
  openModal('add-match-modal');

  const form = document.getElementById('add-match-form');
  if (form) {
    form.removeEventListener('submit', R.handleAddMatch);
    form.addEventListener('submit', R.handleAddMatch);
  }
  R.setupPhaseToggle();
}

function setupPhaseToggle() {
  const phaseSelect = document.getElementById('match-phase');
  const groupInput = document.getElementById('match-group');
  const groupWrapper = groupInput?.closest('.form-group');
  const knockoutSelect = document.getElementById('match-group-knockout');
  const knockoutWrapper = knockoutSelect?.closest('.form-group');

  if (!phaseSelect || !groupWrapper || !knockoutWrapper) return;

  function updateFields() {
    if (phaseSelect.value === 'knockout') {
      groupWrapper.style.display = 'none';
      knockoutWrapper.style.display = 'block';
      groupInput.value = '';
      groupInput.required = false;
      knockoutSelect.required = true;
    } else {
      groupWrapper.style.display = 'block';
      knockoutWrapper.style.display = 'none';
      knockoutSelect.value = '';
      knockoutSelect.required = false;
      groupInput.required = true;
    }
  }

  phaseSelect.removeEventListener('change', updateFields);
  phaseSelect.addEventListener('change', updateFields);
  updateFields();
}

async function loadOfficialPodiumIntoModal() {
  try {
    const leagueId = localStorage.getItem('selectedLeagueId') || '1';
    const res = await api.get(`/api/points/podium?leagueId=${leagueId}`);
    const size = R.getConfiguredPodiumSize();
    const fields = R.getPodiumFieldConfig().slice(0, size);

    if (!res.success || !res.data) {
      fields.forEach(field => {
        const el = document.getElementById(field.id);
        if (el) el.value = '';
      });
      return;
    }

    fields.forEach(field => {
      const el = document.getElementById(field.id);
      if (el) el.value = res.data[field.key] || '';
    });
  } catch (err) {
    console.warn('Não foi possível carregar pódio atual da liga específica');
  }
}

async function handleAddMatch(e) {
  e.preventDefault();

  const phaseEl = document.getElementById('match-phase');
  const phaseVal = phaseEl ? phaseEl.value : 'group';
  const groupInput = document.getElementById('match-group');
  const knockoutSelect = document.getElementById('match-group-knockout');

  let groupVal = phaseVal === 'knockout'
    ? (knockoutSelect ? knockoutSelect.value : '')
    : (groupInput ? groupInput.value.trim() : '');

  if (phaseVal === 'knockout' && !groupVal) {
    toast('Selecione a fase do mata-mata', 'warning');
    return;
  }

  const payload = {
    matchId: parseInt(document.getElementById('match-id').value, 10),
    apiId: document.getElementById('match-apiId').value ? Number(document.getElementById('match-apiId').value) : null,
    teamA: document.getElementById('team-a').value.trim(),
    teamB: document.getElementById('team-b').value.trim(),
    date: document.getElementById('match-date').value.trim(),
    time: document.getElementById('match-time').value.trim(),
    group: groupVal,
    stadium: document.getElementById('match-stadium').value.trim(),
    phase: phaseVal,
    leagueId: localStorage.getItem('selectedLeagueId') || '1',
    leagueName: document.getElementById('match-league-name')?.value?.trim() || 'Liga Principal'
  };

  try {
    const res = await api.post('/api/matches/admin/add', payload);
    if (!res?.success) throw new Error(res?.message || 'Erro ao adicionar');
    toast('Partida adicionada!', 'success');
    closeModal('add-match-modal');
    const form = document.getElementById('add-match-form');
    if (form) form.reset();
    await R.loadAdminMatches();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao adicionar partida', 'error');
  }
}

async function openFinishMatchModal() {
  const select = document.getElementById('finish-match-select');
  if (!select) return toast('Modal de finalizar partida não encontrado', 'error');

  select.innerHTML = '<option value="">Selecione uma partida para finalizar...</option>';
  const pendingMatches = R.AdminState.matches.filter((m) => m.status !== 'finished');

  if (pendingMatches.length === 0) {
    return toast('Nenhuma partida pendente para finalizar', 'info');
  }

  pendingMatches.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.matchId;
    const emojiA = flagEmoji(m.teamA) || '🏳️';
    const emojiB = flagEmoji(m.teamB) || '🏳️';
    opt.textContent = `${emojiA} ${m.teamA} vs ${m.teamB} ${emojiB} (${m.group})`;
    if (m.logoA) opt.dataset.logoA = m.logoA;
    if (m.logoB) opt.dataset.logoB = m.logoB;
    select.appendChild(opt);
  });

  if (typeof openModal === 'function') {
    openModal('finish-match-modal');
  } else {
    const modal = document.getElementById('finish-match-modal');
    if (modal) modal.style.display = 'flex';
  }
}

async function prepareFinishMatch(matchId) {
  R.openFinishMatchModal();
  setTimeout(() => {
    const select = document.getElementById('finish-match-select');
    if (select) {
      select.value = String(matchId);
      loadMatchDetailsAdmin();
    }
  }, 100);
}

async function finishMatch() {
  const matchId = Number(document.getElementById('finish-match-select').value);
  const scoreAValue = document.getElementById('score-a')?.value ?? '';
  const scoreBValue = document.getElementById('score-b')?.value ?? '';
  const scoreA = scoreAValue !== '' ? Number(scoreAValue) : null;
  const scoreB = scoreBValue !== '' ? Number(scoreBValue) : null;

  const regAValue = document.getElementById('regular-time-score-a')?.value ?? '';
  const regBValue = document.getElementById('regular-time-score-b')?.value ?? '';
  const regularTimeScoreA = regAValue !== '' ? Number(regAValue) : null;
  const regularTimeScoreB = regBValue !== '' ? Number(regBValue) : null;

  const penAValue = document.getElementById('penalties-a')?.value ?? '';
  const penBValue = document.getElementById('penalties-b')?.value ?? '';
  const penA = penAValue !== '' ? Number(penAValue) : null;
  const penB = penBValue !== '' ? Number(penBValue) : null;

  const qualifiedEl = document.getElementById('qualified-side');
  const qualifiedSide = qualifiedEl ? qualifiedEl.value : '';

  if (!matchId || scoreA === null || scoreB === null) {
    return toast('Preencha o placar final', 'warning');
  }

  const match = R.AdminState.matches.find((m) => m.matchId === matchId);
  const isKnockout = match?.phase === 'knockout';

  if (isKnockout && (regularTimeScoreA === null || regularTimeScoreB === null)) {
    return toast('Em mata-mata, informe o placar aos 90 minutos.', 'warning');
  }

  if (!isKnockout && (penA !== null || penB !== null)) {
    return toast('Partidas da fase de grupos não possuem pênaltis.', 'warning');
  }

  if (isKnockout && ((penA === null) !== (penB === null))) {
    return toast('Informe os dois placares de pênaltis ou deixe ambos vazios.', 'warning');
  }

  const payload = {
    scoreA,
    scoreB,
    penaltiesA: penA,
    penaltiesB: penB
  };

  if (isKnockout) {
    payload.regularTimeScoreA = regularTimeScoreA;
    payload.regularTimeScoreB = regularTimeScoreB;
  }

  if (qualifiedSide && isKnockout) payload.qualifiedSide = qualifiedSide;

  try {
    const res = await api.post(`/api/matches/admin/finish/${matchId}`, payload);
    if (!res.success) throw new Error(res.message || 'Erro ao finalizar');
    toast('Partida finalizada com sucesso', 'success');
    closeModal('finish-match-modal');
    await R.loadAdminMatches();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao finalizar partida', 'error');
  }
}

async function editMatch(matchId) {
  const match = R.AdminState.matches.find((m) => m.matchId === Number(matchId));
  if (!match) return toast('Partida não encontrada', 'error');

  const existing = document.getElementById('edit-match-modal');
  if (existing) existing.remove();

  const isKnockout = match.phase === 'knockout';

  const html = `
    <div id="edit-match-modal" class="modal active">
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">Editar Partida</h3>
          <button class="close-modal" onclick="closeModal('edit-match-modal')">&times;</button>
        </div>
        <form id="edit-match-form">
          <input type="hidden" id="edit-match-id" value="${match.matchId}">
          <div class="form-row">
            <div class="form-group"><label>ID da API</label><input id="edit-apiId" type="number" value="${match.apiId ?? ''}" placeholder="ID Externo" required></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Time A</label><input id="edit-team-a" value="${match.teamA}" required></div>
            <div class="form-group"><label>Time B</label><input id="edit-team-b" value="${match.teamB}" required></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Placar A</label><input id="edit-score-a" type="number" value="${match.scoreA ?? ''}"></div>
            <div class="form-group"><label>Placar B</label><input id="edit-score-b" type="number" value="${match.scoreB ?? ''}"></div>
          </div>
          <div id="edit-penalties-box" style="display: ${isKnockout ? 'block' : 'none'}; background: #222; padding: 10px; border-radius: 8px; margin-bottom: 10px;">
             <p style="font-size:11px; color:#aaa; margin-bottom:5px;">Pênaltis (Mata-mata):</p>
             <div class="form-row">
                <div class="form-group"><input id="edit-penalties-a" type="number" value="${match.penaltiesA ?? ''}" placeholder="Pên. A"></div>
                <div class="form-group"><input id="edit-penalties-b" type="number" value="${match.penaltiesB ?? ''}" placeholder="Pên. B"></div>
             </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Data</label><input id="edit-match-date" value="${match.date || ''}" placeholder="DD/MM/AAAA" required></div>
            <div class="form-group"><label>Horário</label><input id="edit-match-time" value="${match.time || ''}" placeholder="HH:MM" required></div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Status</label>
              <select id="edit-match-status">
                <option value="scheduled" ${match.status === 'scheduled' ? 'selected' : ''}>Agendado</option>
                <option value="1_tempo" ${match.status === '1_tempo' ? 'selected' : ''}>1º Tempo</option>
                <option value="intervalo" ${match.status === 'intervalo' ? 'selected' : ''}>Intervalo</option>
                <option value="2_tempo" ${match.status === '2_tempo' ? 'selected' : ''}>2º Tempo</option>
                <option value="prorrogacao" ${match.status === 'prorrogacao' ? 'selected' : ''}>Prorrogação</option>
                <option value="1_tet" ${match.status === '1_tet' ? 'selected' : ''}>1º Tempo Extra</option>
                <option value="2_tet" ${match.status === '2_tet' ? 'selected' : ''}>2º Tempo Extra</option>
                <option value="penaltis" ${match.status === 'penaltis' ? 'selected' : ''}>Pênaltis</option>
                <option value="finished" ${match.status === 'finished' ? 'selected' : ''}>Finalizado</option>
                <option value="cancelled" ${match.status === 'cancelled' ? 'selected' : ''}>Cancelado</option>
                <option value="postponed" ${match.status === 'postponed' ? 'selected' : ''}>Adiado</option>
              </select>
            </div>
            <div class="form-group"><label>Grupo</label><input id="edit-match-group" value="${match.group || ''}" required></div>
          </div>
          <div class="form-row" style="gap:8px; margin-top:12px;">
            <button type="submit" class="btn btn-success" style="flex:1"><i class="fas fa-save"></i> Salvar</button>
            <button type="button" class="btn btn-danger" onclick="adminDeleteMatchForce(${match.matchId})"><i class="fas fa-trash"></i></button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('edit-match-form').addEventListener('submit', R.handleEditMatch);
}

async function handleEditMatch(e) {
  e.preventDefault();
  const matchId = Number(document.getElementById('edit-match-id').value);

  const updates = {
    apiId: document.getElementById('edit-apiId').value ? Number(document.getElementById('edit-apiId').value) : null,
    teamA: document.getElementById('edit-team-a').value.trim(),
    teamB: document.getElementById('edit-team-b').value.trim(),
    date: document.getElementById('edit-match-date').value.trim(),
    time: document.getElementById('edit-match-time').value.trim(),
    group: document.getElementById('edit-match-group').value.trim(),
    status: document.getElementById('edit-match-status').value,
  };

  const scoreAInput = document.getElementById('edit-score-a').value;
  const scoreBInput = document.getElementById('edit-score-b').value;
  updates.scoreA = (scoreAInput !== '') ? Number(scoreAInput) : null;
  updates.scoreB = (scoreBInput !== '') ? Number(scoreBInput) : null;

  const penAInput = document.getElementById('edit-penalties-a')?.value;
  const penBInput = document.getElementById('edit-penalties-b')?.value;
  if (penAInput !== undefined) {
    updates.penaltiesA = (penAInput !== '') ? Number(penAInput) : null;
    updates.penaltiesB = (penBInput !== '') ? Number(penBInput) : null;
  }

  const currentMatch = R.AdminState.matches.find((m) => m.matchId === matchId);
  const leagueId =
    currentMatch?.leagueId ||
    localStorage.getItem('selectedLeagueId') ||
    '1';

  updates.leagueId = String(leagueId).trim();

  try {
    const res = await api.put(`/api/matches/admin/edit/${matchId}`, updates);
    if (!res.success) throw new Error(res.message || 'Erro ao editar');
    toast('Partida atualizada!', 'success');
    closeModal('edit-match-modal');
    await R.loadAdminMatches(); 
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao editar partida', 'error');
  }
}

async function adminUnfinishMatch(matchId) {
    if (!confirm('Reabrir esta partida (zerar placares e pontos)?')) return;

    const currentMatch = R.AdminState.matches.find((m) => m.matchId === Number(matchId));
    const leagueId =
        currentMatch?.leagueId ||
        localStorage.getItem('selectedLeagueId') ||
        '1';

    try {
        const res = await api.post('/api/matches/admin/unfinish-bulk', {
            matchId: Number(matchId),
            leagueId: String(leagueId).trim()
        });
        if (res.success) {
            toast('Partida reaberta com sucesso', 'success');
            closeModal('edit-match-modal');
            await R.loadAdminMatches();
        } else {
            throw new Error(res.message);
        }
    } catch (err) {
        console.error('Erro ao reabrir partida:', err);
        toast('Erro ao reabrir partida', 'error');
    }
}

async function adminDeleteMatchForce(matchId) {
    if (!confirm('Excluir DEFINITIVAMENTE esta partida?')) return;

    const currentMatch = R.AdminState.matches.find((m) => m.matchId === Number(matchId));
    const leagueId =
        currentMatch?.leagueId ||
        localStorage.getItem('selectedLeagueId') ||
        '1';

    try {
        const res = await api.del('/api/matches/admin/delete-bulk', {
            matchId: Number(matchId),
            leagueId: String(leagueId).trim()
        });
        if (res.success) {
            toast('Partida excluída com sucesso', 'success');
            if (typeof closeModal === 'function') closeModal('edit-match-modal');
            await R.loadAdminMatches();
        }
    } catch (err) {
        console.error('Erro ao excluir:', err);
        toast(err.message || 'Erro ao excluir', 'error');
    }
}

async function setPodium() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  const size = R.getConfiguredPodiumSize();
  const fields = R.getPodiumFieldConfig().slice(0, size);
  const payload = { leagueId, first: null, second: null, third: null, fourth: null };

  fields.forEach(field => {
    payload[field.key] = document.getElementById(field.id)?.value || null;
  });

  if (!fields.some(field => payload[field.key])) {
    return toast('Selecione ao menos uma posição do pódio', 'warning');
  }

  try {
    const res = await api.post('/api/points/process-podium', payload);
    if (!res.success) throw new Error(res.message);
    toast(`Pódio da liga ${leagueId} atualizado com sucesso`, 'success');
    closeModal('set-podium-modal');
  } catch (err) {
    toast(err.message || 'Erro ao atualizar pódio', 'error');
  }
}

async function resetOfficialPodium() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  if (!confirm(`Zerar pódio oficial da liga ${leagueId}?`)) return;

  try {
    const res = await api.post('/api/points/podium/reset', { leagueId });
    if (!res.success) throw new Error(res.message);

    R.getPodiumFieldConfig().forEach(field => {
      const el = document.getElementById(field.id);
      if (el) el.value = '';
    });
    toast(`Pódio da liga ${leagueId} zerado`, 'success');
  } catch (err) {
    toast('Erro ao zerar pódio', 'error');
  }
}

async function recalculateAllPoints() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  try {
    const res = await api.post('/api/points/recalculate-all', { leagueId });
    if (!res.success) throw new Error(res.message || 'Erro ao recalcular');
    toast(`Pontos da liga ${leagueId} recalculados`, 'success');
  } catch (err) {
    toast(err.message || 'Erro ao recalcular', 'error');
  }
}

async function checkDataIntegrity() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  try {
    const res = await api.get(`/api/points/integrity-check?leagueId=${leagueId}`);
    if (!res.success) throw new Error(res.message || 'Erro na verificação');
    toast(`Integridade da liga ${leagueId} OK`, 'success');
  } catch (err) {
    toast(err.message || 'Erro na verificação', 'error');
  }
}

registerAdminFunctions({loadAdminMatches: loadAdminMatches, getAdminChampionshipMode: getAdminChampionshipMode, renderAdminMatches: renderAdminMatches, renderSingleMatchRow: renderSingleMatchRow, getConfiguredPodiumSize: getConfiguredPodiumSize, getPodiumFieldConfig: getPodiumFieldConfig, renderOfficialPodiumFields: renderOfficialPodiumFields, populatePodiumSelects: populatePodiumSelects, openAddMatchModal: openAddMatchModal, setupPhaseToggle: setupPhaseToggle, loadOfficialPodiumIntoModal: loadOfficialPodiumIntoModal, handleAddMatch: handleAddMatch, openFinishMatchModal: openFinishMatchModal, prepareFinishMatch: prepareFinishMatch, finishMatch: finishMatch, editMatch: editMatch, handleEditMatch: handleEditMatch, adminUnfinishMatch: adminUnfinishMatch, adminDeleteMatchForce: adminDeleteMatchForce, setPodium: setPodium, resetOfficialPodium: resetOfficialPodium, recalculateAllPoints: recalculateAllPoints, checkDataIntegrity: checkDataIntegrity});
