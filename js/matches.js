// js/matches.js
import { api } from './api.js';
import { toast } from './ui.js';

const MState = {
  matches: [], // vindo do backend /api/matches
  teams: [],   // nomes únicos pra selects do pódio
};

const $matchesContainer = () => document.getElementById('matches-container');
const $saveBtn = () => document.getElementById('save-bets');

export async function initMatches() {
  await loadMatches();
  setupSaveHandler();
}

async function loadMatches() {
  try {
    const res = await api.get('/api/matches');
    if (!res.success) throw new Error(res.message || 'Erro ao carregar jogos');
    MState.matches = res.data || [];
    renderMatches(MState.matches);
    collectTeamsForPodium(MState.matches);
  } catch (err) {
    console.error(err);
    if ($matchesContainer()) {
      $matchesContainer().innerHTML = '<p>Erro ao carregar jogos</p>';
    }
  }
}

function collectTeamsForPodium(matches) {
  const set = new Set();
  matches.forEach(m => { set.add(m.teamA); set.add(m.teamB); });
  MState.teams = Array.from(set).sort();

  ['first-place','second-place','third-place'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione...</option>';
    MState.teams.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    });
  });
}

function renderMatches(matches) {
  const el = $matchesContainer();
  if (!el) return;

  if (!matches.length) {
    el.innerHTML = '<p>Nenhum jogo encontrado.</p>';
    return;
  }

  // cards
  el.innerHTML = matches.map(m => matchCardHTML(m)).join('');
  // clique dos palpites
  el.querySelectorAll('.bet-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const card = opt.closest('.match-card');
      card.querySelectorAll('.bet-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      // importante: gravamos A/B/draw
      card.dataset.choice = opt.dataset.choice; 
    });
  });
}

function matchCardHTML(m) {
  const statusBadge = m.status === 'finished'
    ? `<span class="badge finished">Finalizado</span>`
    : m.status === 'in_progress'
      ? `<span class="badge in_progress">Em andamento</span>`
      : `<span class="badge scheduled">Agendado</span>`;

  const resultText = m.status === 'finished'
    ? `<div style="margin-top:6px;font-weight:700;">Resultado: ${m.scoreA} - ${m.scoreB}</div>`
    : '';

  // As opções abaixo usam data-choice = 'A' | 'draw' | 'B'
  return `
    <div class="match-card" data-match-id="${m.matchId}" data-choice="">
      <div class="match-header">
        <span>${m.date} • ${m.time}</span>
        ${statusBadge}
      </div>
      <div class="match-teams">
        <div class="team"><span class="team-name">${m.teamA}</span></div>
        <div class="vs">VS</div>
        <div class="team"><span class="team-name">${m.teamB}</span></div>
      </div>
      ${resultText}
      ${m.status !== 'finished' ? `
      <div class="bet-options">
        <div class="bet-option team-a" data-choice="A">${m.teamA}</div>
        <div class="bet-option draw"   data-choice="draw">Empate</div>
        <div class="bet-option team-b" data-choice="B">${m.teamB}</div>
      </div>` : ``}
    </div>
  `;
}

function setupSaveHandler() {
  const btn = $saveBtn();
  if (!btn) return;
  btn.addEventListener('click', saveAllBets);
}

async function saveAllBets() {
  // coletar escolhas A/B/draw
  const groupMatches = {};
  const cards = document.querySelectorAll('.match-card');
  let missing = false;

  cards.forEach(card => {
    const matchId = Number(card.dataset.matchId);
    // se o jogo já finalizou, ele não terá opções e não deve ser incluído
    const options = card.querySelector('.bet-options');
    if (!options) return;

    const choice = card.dataset.choice || '';
    if (!choice) missing = true;
    else groupMatches[matchId] = choice; // *** A | B | draw ***
  });

  if (missing) {
    toast('Faça palpite em todos os jogos pendentes', 'warning');
    return;
  }

  // pódio
  const podium = {
    first:  document.getElementById('first-place').value,
    second: document.getElementById('second-place').value,
    third:  document.getElementById('third-place').value
  };
  if (!podium.first || !podium.second || !podium.third) {
    toast('Selecione todas as posições do pódio', 'warning');
    return;
  }

  try {
    $saveBtn().disabled = true;
    $saveBtn().innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';

    const res = await api.post('/api/bets/save', { groupMatches, podium });
    if (!res.success) throw new Error(res.message || 'Erro ao salvar');

    toast('Palpites enviados!', 'success');
    $saveBtn().innerHTML = '<i class="fas fa-check"></i> Palpites Enviados';
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar', 'error');
    $saveBtn().disabled = false;
    $saveBtn().innerHTML = '<i class="fas fa-save"></i> Salvar Palpites';
  }
}
