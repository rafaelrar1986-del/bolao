// js/matches.js
import { api } from './api.js';
import { toast } from './ui.js';

const $matchesContainer = () => document.getElementById('matches-container');
const $saveBtn = () => document.getElementById('save-bets');

// podium selects
const $first = () => document.getElementById('first-place');
const $second = () => document.getElementById('second-place');
const $third = () => document.getElementById('third-place');

const MatchesState = {
  matches: [],                 // lista de partidas do backend
  choices: {},                 // { [matchId]: 'A'|'B'|'draw' }
  hasSubmitted: false,         // se o usuário já enviou
  saving: false,               // trava botão salvar
  teamsSet: new Set(),         // para popular selects do pódio
};

// ==============================
// Utils
// ==============================
function computeWinnerFromScore(a, b) {
  const A = Number(a), B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B)) return null;
  if (A > B) return 'A';
  if (B > A) return 'B';
  return 'draw';
}

function renderMatchCard(m, savedChoice, disabled) {
  // savedChoice: 'A'|'B'|'draw'
  const aSel = savedChoice === 'A' ? 'selected team-a' : '';
  const dSel = savedChoice === 'draw' ? 'selected draw' : '';
  const bSel = savedChoice === 'B' ? 'selected team-b' : '';

  const disableAttr = disabled ? 'data-disabled="1"' : '';

  return `
    <div class="match-card" data-id="${m.matchId}" ${disableAttr}>
      <div class="match-header">
        <span>${m.group || '-'}</span>
        <span>${m.date || ''} ${m.time || ''}</span>
      </div>
      <div class="match-teams">
        <span class="team-name">${m.teamA}</span>
        <span>vs</span>
        <span class="team-name">${m.teamB}</span>
      </div>
      <div class="bet-options">
        <div class="bet-option ${aSel}" data-choice="A">${m.teamA}</div>
        <div class="bet-option ${dSel}" data-choice="draw">Empate</div>
        <div class="bet-option ${bSel}" data-choice="B">${m.teamB}</div>
      </div>
    </div>
  `;
}

function attachOptionHandlers(rootEl) {
  rootEl.querySelectorAll('.bet-option').forEach(el => {
    el.addEventListener('click', () => {
      const card = el.closest('.match-card');
      if (!card) return;

      // bloqueia se já enviado
      if (card.dataset.disabled === '1') return;

      // não permitir escolher partidas finalizadas (opcional)
      // aqui liberamos sempre, pois regra é "enviar uma vez" — ao enviar, tudo trava
      card.querySelectorAll('.bet-option').forEach(x => x.classList.remove('selected','team-a','team-b','draw'));
      const choice = el.dataset.choice; // 'A' | 'draw' | 'B'
      el.classList.add('selected');
      if (choice === 'A') el.classList.add('team-a');
      if (choice === 'B') el.classList.add('team-b');
      if (choice === 'draw') el.classList.add('draw');

      const matchId = Number(card.dataset.id);
      MatchesState.choices[matchId] = choice;
    });
  });
}

// ==============================
// Render
// ==============================
function renderMatchesList() {
  const container = $matchesContainer();
  if (!container) return;

  const disabled = MatchesState.hasSubmitted;

  const html = MatchesState.matches
    .sort((a, b) => a.matchId - b.matchId)
    .map(m => renderMatchCard(m, MatchesState.choices[m.matchId], disabled))
    .join('');

  container.innerHTML = html;
  attachOptionHandlers(container);

  // botões / estado de salvar
  if ($saveBtn()) {
    $saveBtn().disabled = MatchesState.hasSubmitted || MatchesState.saving;
    $saveBtn().textContent = MatchesState.hasSubmitted ? 'Palpites já enviados' : 'Salvar Palpites';
  }
}

// ==============================
// Pódio
// ==============================
function populateTeamsForPodium() {
  MatchesState.teamsSet.clear();
  MatchesState.matches.forEach(m => {
    if (m?.teamA) MatchesState.teamsSet.add(m.teamA);
    if (m?.teamB) MatchesState.teamsSet.add(m.teamB);
  });

  const teams = Array.from(MatchesState.teamsSet).sort((a, b) => a.localeCompare(b));

  function fillSelect(sel) {
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Selecione...</option>` + teams.map(t => `<option value="${t}">${t}</option>`).join('');
    // tenta manter valor caso já existisse
    if (current && teams.includes(current)) sel.value = current;
  }

  fillSelect($first());
  fillSelect($second());
  fillSelect($third());
}

function preloadPodium(podium) {
  if (!podium) return;
  if ($first())  $first().value  = podium.first  || '';
  if ($second()) $second().value = podium.second || '';
  if ($third())  $third().value  = podium.third  || '';
}

// ==============================
// API loads
// ==============================
async function fetchMatches() {
  const res = await api.get('/api/matches');
  if (!res.success) throw new Error(res.message || 'Erro ao carregar partidas');
  MatchesState.matches = res.data || [];
}

async function fetchMyBets() {
  const res = await api.get('/api/bets/my-bets');
  if (!res.success) throw new Error(res.message || 'Erro ao carregar meus palpites');

  MatchesState.hasSubmitted = !!res.hasSubmitted;

  // limpar escolhas, vamos reconstruir
  MatchesState.choices = {};

  if (res.data && Array.isArray(res.data.groupMatches)) {
    res.data.groupMatches.forEach(g => {
      // winner vem do backend no novo modelo
      if (g && g.matchId != null && g.winner) {
        MatchesState.choices[g.matchId] = g.winner; // 'A'|'B'|'draw'
      }
    });
  }

  // Pódio salvo?
  if (res.data && res.data.podium) {
    preloadPodium(res.data.podium);
  }
}

// ==============================
// Save
// ==============================
async function saveAllBets() {
  if (MatchesState.hasSubmitted) {
    return toast('Você já enviou seus palpites.', 'info');
  }
  if (MatchesState.saving) return;

  // valida pódio
  const podium = {
    first:  ($first()?.value || '').trim(),
    second: ($second()?.value || '').trim(),
    third:  ($third()?.value || '').trim(),
  };
  if (!podium.first || !podium.second || !podium.third) {
    return toast('Preencha o pódio completo (1º, 2º e 3º)', 'warning');
  }

  // monta objeto { matchId: 'A'|'B'|'draw' }
  const groupMatches = {};
  MatchesState.matches.forEach(m => {
    const c = MatchesState.choices[m.matchId];
    if (c) groupMatches[m.matchId] = c;
  });

  if (Object.keys(groupMatches).length === 0) {
    return toast('Faça pelo menos um palpite antes de salvar', 'warning');
  }

  try {
    MatchesState.saving = true;
    if ($saveBtn()) {
      $saveBtn().disabled = true;
      $saveBtn().textContent = 'Salvando...';
    }

    const res = await api.post('/api/bets/save', { groupMatches, podium });
    if (!res.success) throw new Error(res.message || 'Erro ao salvar');

    toast('Palpites enviados com sucesso!', 'success');
    MatchesState.hasSubmitted = true;
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar palpites', 'error');
  } finally {
    MatchesState.saving = false;
    renderMatchesList();
  }
}

// ==============================
// Init
// ==============================
export async function initMatches() {
  try {
    // 1) Carrega partidas
    await fetchMatches();

    // 2) Popula pódio com times únicos
    populateTeamsForPodium();

    // 3) Pré-carrega palpites do usuário (se tiver)
    await fetchMyBets();

    // 4) Renderiza lista
    renderMatchesList();

    // 5) Botão salvar
    if ($saveBtn()) {
      $saveBtn().addEventListener('click', saveAllBets);
    }
  } catch (err) {
    console.error(err);
    if ($matchesContainer()) {
      $matchesContainer().innerHTML = `<p>Erro ao carregar partidas.</p>`;
    }
    toast('Erro ao iniciar a aba de palpites', 'error');
  }
}

// opcionalmente expor para app.js chamar novamente se precisar recarregar
export async function reloadMatches() {
  await fetchMatches();
  populateTeamsForPodium();
  await fetchMyBets();
  renderMatchesList();
}
