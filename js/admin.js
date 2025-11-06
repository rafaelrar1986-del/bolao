// js/admin.js
// Admin: listar, adicionar, editar, finalizar, reabrir e excluir partidas + utilitários

import { api } from './api.js';
import { toast, openModal, closeModal } from './ui.js';

// Elementos fixos esperados no HTML
const $adminMatchesList = () => document.getElementById('admin-matches-list');

// Estado local simples
const AdminState = {
  matches: [],
};

// =============== BOOTSTRAP ===============
export function initAdmin() {
  // Expor handlers globais usados pelos botões presentes no HTML
  window.openAddMatchModal = openAddMatchModal;
  window.openFinishMatchModal = openFinishMatchModal;
  window.openSetPodiumModal = openSetPodiumModal;

  window.handleAddMatch = handleAddMatch;
  window.prepareFinishMatch = prepareFinishMatch;
  window.finishMatch = finishMatch;

  window.editMatch = editMatch;
  window.adminUnfinishMatch = adminUnfinishMatch;
  window.adminDeleteMatchForce = adminDeleteMatchForce;

  window.recalculateAllPoints = recalculateAllPoints;
  window.checkDataIntegrity = checkDataIntegrity;
  window.setPodium = setPodium;

  // Carregar lista inicial
  loadAdminMatches();
}

// =============== LISTAR PARTIDAS ===============
export async function loadAdminMatches() {
  try {
    const res = await api.get('/api/matches/admin/all');
    if (!res.success) throw new Error(res.message || 'Erro ao listar partidas');

    AdminState.matches = res.data || [];
    renderAdminMatches(AdminState.matches);
  } catch (err) {
    console.error(err);
    if ($adminMatchesList()) {
      $adminMatchesList().innerHTML = '<p>Erro ao carregar partidas.</p>';
    }
    toast('Erro ao carregar partidas', 'error');
  }
}

function renderAdminMatches(matchesList) {
  const container = $adminMatchesList();
  if (!container) return;

  if (!matchesList || matchesList.length === 0) {
    container.innerHTML = '<p>Nenhuma partida encontrada.</p>';
    return;
  }

  let html = `
    <table class="table" style="font-size: 0.92rem;">
      <thead>
        <tr>
          <th>ID</th>
          <th>Partida</th>
          <th>Grupo</th>
          <th>Status</th>
          <th>Placar</th>
          <th>Palpites</th>
          <th style="min-width:260px">Ações</th>
        </tr>
      </thead>
      <tbody>
  `;

  matchesList.forEach((match) => {
    const statusClass =
      match.status === 'finished'
        ? 'badge finished'
        : match.status === 'in_progress'
        ? 'badge in_progress'
        : 'badge scheduled';

    const score =
      match.status === 'finished'
        ? `${match.scoreA ?? 0} - ${match.scoreB ?? 0}`
        : '-- : --';

    html += `
      <tr>
        <td>${match.matchId}</td>
        <td><strong>${match.teamA}</strong> vs <strong>${match.teamB}</strong></td>
        <td>${match.group}</td>
        <td><span class="${statusClass}">${match.status}</span></td>
        <td>${score}</td>
        <td>${match.betsCount || 0}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap">
          <button class="btn btn-small btn-info" onclick="editMatch(${match.matchId})">
            <i class="fas fa-edit"></i> Editar
          </button>
          ${
            match.status !== 'finished'
              ? `<button class="btn btn-small btn-success" onclick="prepareFinishMatch(${match.matchId})">
                  <i class="fas fa-whistle"></i> Finalizar
                </button>`
              : `<button class="btn btn-small btn-warning" onclick="adminUnfinishMatch(${match.matchId})">
                  <i class="fas fa-undo"></i> Reabrir
                </button>`
          }
          <button class="btn btn-small btn-danger" onclick="adminDeleteMatchForce(${match.matchId})">
            <i class="fas fa-trash"></i> Excluir
          </button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// =============== MODAL: ADICIONAR PARTIDA ===============
function openAddMatchModal() {
  const modal = document.getElementById('add-match-modal');
  if (!modal) return toast('Modal de adicionar partida não encontrado', 'error');
  openModal('add-match-modal');

  // Garante submit handler atualizado
  const form = document.getElementById('add-match-form');
  if (form) {
    form.removeEventListener('submit', handleAddMatch);
    form.addEventListener('submit', handleAddMatch);
  }
}

async function handleAddMatch(e) {
  e.preventDefault();
  const payload = {
    matchId: parseInt(document.getElementById('match-id').value),
    teamA: document.getElementById('team-a').value.trim(),
    teamB: document.getElementById('team-b').value.trim(),
    date: document.getElementById('match-date').value.trim(),
    time: document.getElementById('match-time').value.trim(),
    group: document.getElementById('match-group').value.trim(),
    stadium: document.getElementById('match-stadium').value.trim(),
  };

  try {
    const res = await api.post('/api/matches/admin/add', payload);
    if (!res.success) throw new Error(res.message || 'Erro ao adicionar');

    toast('Partida adicionada!', 'success');
    closeModal('add-match-modal');
    const form = document.getElementById('add-match-form');
    if (form) form.reset();
    await loadAdminMatches();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao adicionar partida', 'error');
  }
}

// =============== MODAL: FINALIZAR PARTIDA ===============
function openFinishMatchModal() {
  // Preenche o select
  const select = document.getElementById('finish-match-select');
  if (!select) return toast('Modal de finalizar partida não encontrado', 'error');

  select.innerHTML = '<option value="">Selecione uma partida</option>';
  AdminState.matches
    .filter((m) => m.status !== 'finished')
    .forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.matchId;
      opt.textContent = `${m.teamA} vs ${m.teamB} (${m.group})`;
      select.appendChild(opt);
    });

  openModal('finish-match-modal');
}

function prepareFinishMatch(matchId) {
  // Abre o modal e seleciona a partida
  openFinishMatchModal();
  const select = document.getElementById('finish-match-select');
  if (select) {
    select.value = String(matchId);
    loadMatchDetails();
  }
}

window.loadMatchDetails = function loadMatchDetails() {
  const select = document.getElementById('finish-match-select');
  const detailsDiv = document.getElementById('match-details');
  if (!select || !detailsDiv) return;

  const matchId = Number(select.value);
  if (!matchId) {
    detailsDiv.style.display = 'none';
    return;
  }
  const match = AdminState.matches.find((m) => m.matchId === matchId);
  if (!match) return;

  document.getElementById('selected-match-name').textContent = `${match.teamA} vs ${match.teamB}`;
  detailsDiv.style.display = 'block';
};

async function finishMatch() {
  const matchId = Number(document.getElementById('finish-match-select').value);
  const scoreA = Number(document.getElementById('score-a').value);
  const scoreB = Number(document.getElementById('score-b').value);

  if (!matchId || Number.isNaN(scoreA) || Number.isNaN(scoreB)) {
    return toast('Preencha match e placar', 'warning');
  }

  try {
    const res = await api.post(`/api/matches/admin/finish/${matchId}`, { scoreA, scoreB });
    if (!res.success) throw new Error(res.message || 'Erro ao finalizar');

    toast('Partida finalizada + pontos recalculados', 'success');
    closeModal('finish-match-modal');
    await loadAdminMatches();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao finalizar partida', 'error');
  }
}

// =============== MODAL: EDITAR PARTIDA ===============
function editMatch(matchId) {
  const match = AdminState.matches.find((m) => m.matchId === Number(matchId));
  if (!match) return toast('Partida não encontrada', 'error');

  // Remove modal anterior (se houver)
  const existing = document.getElementById('edit-match-modal');
  if (existing) existing.remove();

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
            <div class="form-group">
              <label for="edit-team-a">Time A</label>
              <input id="edit-team-a" value="${match.teamA}" required>
            </div>
            <div class="form-group">
              <label for="edit-team-b">Time B</label>
              <input id="edit-team-b" value="${match.teamB}" required>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="edit-match-date">Data (DD/MM/AAAA)</label>
              <input id="edit-match-date" value="${match.date || ''}" placeholder="DD/MM/AAAA" required>
            </div>
            <div class="form-group">
              <label for="edit-match-time">Horário (HH:MM)</label>
              <input id="edit-match-time" value="${match.time || ''}" placeholder="HH:MM" required>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="edit-match-group">Grupo</label>
              <input id="edit-match-group" value="${match.group || ''}" required>
            </div>
            <div class="form-group">
              <label for="edit-match-stadium">Estádio</label>
              <input id="edit-match-stadium" value="${match.stadium || ''}">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="edit-match-status">Status</label>
              <select id="edit-match-status">
                <option value="scheduled" ${match.status === 'scheduled' ? 'selected' : ''}>Agendado</option>
                <option value="in_progress" ${match.status === 'in_progress' ? 'selected' : ''}>Em andamento</option>
                <option value="finished" ${match.status === 'finished' ? 'selected' : ''}>Finalizado</option>
              </select>
            </div>
            <div class="form-group">
              <label for="edit-score-a">Placar A</label>
              <input id="edit-score-a" type="number" min="0" max="50" value="${match.scoreA ?? ''}">
            </div>
            <div class="form-group">
              <label for="edit-score-b">Placar B</label>
              <input id="edit-score-b" type="number" min="0" max="50" value="${match.scoreB ?? ''}">
            </div>
          </div>

          <div class="form-row" style="gap:8px; margin-top:8px;">
            <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Salvar</button>
            ${
              match.status !== 'finished'
                ? `<button type="button" class="btn btn-warning" onclick="prepareFinishMatch(${match.matchId})"><i class="fas fa-whistle"></i> Finalizar</button>`
                : `<button type="button" class="btn btn-warning" onclick="adminUnfinishMatch(${match.matchId})"><i class="fas fa-undo"></i> Reabrir</button>`
            }
            <button type="button" class="btn btn-danger" onclick="adminDeleteMatchForce(${match.matchId})"><i class="fas fa-trash"></i> Excluir</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);

  // Submit handler
  const form = document.getElementById('edit-match-form');
  form.addEventListener('submit', handleEditMatch);
}

async function handleEditMatch(e) {
  e.preventDefault();
  const matchId = Number(document.getElementById('edit-match-id').value);

  const updates = {
    teamA: document.getElementById('edit-team-a').value.trim(),
    teamB: document.getElementById('edit-team-b').value.trim(),
    date: document.getElementById('edit-match-date').value.trim(),
    time: document.getElementById('edit-match-time').value.trim(),
    group: document.getElementById('edit-match-group').value.trim(),
    stadium: document.getElementById('edit-match-stadium').value.trim(),
    status: document.getElementById('edit-match-status').value,
  };

  // Só envia placar se informado
  const scoreAInput = document.getElementById('edit-score-a').value;
  const scoreBInput = document.getElementById('edit-score-b').value;

  if (scoreAInput !== '') updates.scoreA = Number(scoreAInput);
  if (scoreBInput !== '') updates.scoreB = Number(scoreBInput);

  // Se status finished, exigir scoreA/scoreB
  if (updates.status === 'finished') {
    if (updates.scoreA === undefined || updates.scoreB === undefined) {
      return toast('Para finalizar, informe scoreA e scoreB', 'warning');
    }
  }

  try {
    const res = await api.put(`/api/matches/admin/edit/${matchId}`, updates);
    if (!res.success) throw new Error(res.message || 'Erro ao editar');

    toast('Partida atualizada', 'success');
    closeModal('edit-match-modal');
    await loadAdminMatches();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao editar partida', 'error');
  }
}

// =============== REABRIR (UNFINISH) com fallback ===============
async function adminUnfinishMatch(matchId) {
  if (!confirm('Reabrir esta partida? Isso limpará o placar e zerará os pontos deste jogo para todos os palpites.')) return;

  try {
    // 1) Tenta endpoint dedicado (se existir no backend)
    let res = await api.post(`/api/matches/admin/unfinish/${matchId}`);
    if (!res.success) throw new Error(res.message || 'Falha no unfinish dedicado');

    toast('Partida reaberta e pontos zerados do jogo', 'success');
  } catch (e1) {
    // 2) Fallback usando /admin/edit + recálculo global
    try {
      await api.put(`/api/matches/admin/edit/${matchId}`, {
        status: 'scheduled',
        scoreA: null,
        scoreB: null,
      });
      await api.post('/api/points/recalculate-all', {});
      toast('Partida reaberta (fallback) e pontos recalculados', 'success');
    } catch (e2) {
      console.error(e2);
      return toast(e2.message || 'Erro ao reabrir partida (fallback)', 'error');
    }
  }

  closeModal('edit-match-modal');
  await loadAdminMatches();
}

// =============== EXCLUIR (FORCE) com fallback ===============
async function adminDeleteMatchForce(matchId) {
  if (!confirm('Excluir DEFINITIVAMENTE a partida?\nOs pontos deste jogo serão zerados e a partida será removida.')) return;

  try {
    // 1) Tenta endpoint com "force" (se existir no backend)
    let res = await api.del(`/api/matches/admin/delete/${matchId}?force=1`);
    if (!res.success) throw new Error(res.message || 'Falha no delete force');
    toast('Partida excluída', 'success');
  } catch (e1) {
    // 2) Fallback: tenta deletar normal
    try {
      const res2 = await api.del(`/api/matches/admin/delete/${matchId}`);
      if (!res2.success) {
        throw new Error(res2.message || 'Backend recusou exclusão (provável: há palpites associados).');
      }
      toast('Partida excluída (sem force)', 'success');
    } catch (e2) {
      console.error(e2);
      return toast(e2.message || 'Erro ao excluir partida (fallback)', 'error');
    }
  }

  closeModal('edit-match-modal');
  await loadAdminMatches();
}

// =============== PODIUM / REBUILD / INTEGRITY ===============
async function setPodium() {
  const first = document.getElementById('podium-first')?.value;
  const second = document.getElementById('podium-second')?.value;
  const third = document.getElementById('podium-third')?.value;

  if (!first || !second || !third) {
    return toast('Selecione todas as posições do pódio', 'warning');
  }

  try {
    const res = await api.post('/api/points/process-podium', { first, second, third });
    if (!res.success) throw new Error(res.message || 'Erro ao processar pódio');

    toast('Pódio definido + pontos recalculados', 'success');
    closeModal('set-podium-modal');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao definir pódio', 'error');
  }
}

async function recalculateAllPoints() {
  try {
    const res = await api.post('/api/points/recalculate-all', {});
    if (!res.success) throw new Error(res.message || 'Erro ao recalcular');

    toast('Todos os pontos recalculados', 'success');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao recalcular pontos', 'error');
  }
}

async function checkDataIntegrity() {
  try {
    const res = await api.get('/api/points/integrity-check');
    if (!res.success) throw new Error(res.message || 'Erro ao verificar integridade');

    const errors = res.data?.errors?.length || 0;
    const warnings = res.data?.warnings?.length || 0;
    toast(`Integridade OK • Erros: ${errors} • Avisos: ${warnings}`, errors ? 'warning' : 'success');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro na verificação de integridade', 'error');
  }
}

// =============== MODAIS AUXILIARES PÚBLICOS ===============
function openSetPodiumModal() {
  const modal = document.getElementById('set-podium-modal');
  if (!modal) return toast('Modal de pódio não encontrado', 'error');
  openModal('set-podium-modal');
}

function openFinishMatchModalIfNotOpen() {
  const modal = document.getElementById('finish-match-modal');
  if (!modal) return toast('Modal de finalizar partida não encontrado', 'error');
  openModal('finish-match-modal');
}

export { openAddMatchModal, openFinishMatchModal, openSetPodiumModal };
