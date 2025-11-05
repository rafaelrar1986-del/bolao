
// matches.js (module)
import { getMatches } from './api.js';
import { html, qs, qsa } from './utils.js';

export let matches = [];
export let teams = [];

export async function loadMatchesAndRender() {
  const container = qs('#matches-container');
  try {
    const data = await getMatches();
    matches = data.data || [];
    renderMatches(container);
    collectTeams();
  } catch (e) {
    html(container, '<p>Erro ao carregar jogos.</p>');
  }
}

function renderMatches(container) {
  if (!matches.length) {
    html(container, '<p>Nenhum jogo encontrado.</p>');
    return;
  }
  const byGroup = {};
  matches.forEach(m => {
    byGroup[m.group] = byGroup[m.group] || [];
    byGroup[m.group].push(m);
  });
  let h = '';
  Object.keys(byGroup).sort().forEach(group => {
    h += `<div class="card"><h3>${group}</h3>`;
    byGroup[group].forEach(m => h += matchCard(m));
    h += `</div>`;
  });
  html(container, h);
  setupBetListeners();
}

function matchCard(m) {
  const status = m.status === 'finished' ? `<span class="badge" style="background:#e6ffed;color:#0a5727;">Finalizado</span>` :
                 m.status === 'in_progress' ? `<span class="badge" style="background:#fff7e6;color:#8a5a00;">Em andamento</span>` :
                 `<span class="badge" style="background:#eef6ff;color:#0b4d9b;">Agendado</span>`;
  const result = m.status === 'finished' ? `<div class="muted"><strong>Resultado:</strong> ${m.scoreA} - ${m.scoreB}</div>` : '';
  return `
    <div class="match-card" data-match-id="${m.matchId}">
      <div class="match-header"><span>${m.date} • ${m.time}</span>${status}</div>
      <div class="match-teams">
        <strong>${m.teamA}</strong><span>VS</span><strong>${m.teamB}</strong>
      </div>
      ${result}
      ${m.status!=='finished'?`
      <div class="bet-options">
        <div class="bet-option" data-bet="${m.teamA}">${m.teamA}</div>
        <div class="bet-option" data-bet="draw">Empate</div>
        <div class="bet-option" data-bet="${m.teamB}">${m.teamB}</div>
      </div>`:''}
    </div>`;
}

function setupBetListeners() {
  qsa('.bet-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      const card = opt.closest('.match-card');
      qsa('.bet-option', card).forEach(o=>o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}

function collectTeams() {
  const set = new Set();
  matches.forEach(m=>{ set.add(m.teamA); set.add(m.teamB); });
  teams = Array.from(set).sort();
  const selects = ['first-place', 'second-place', 'third-place'];
  selects.forEach(id=>{
    const el = qs('#'+id);
    if (!el) return;
    el.innerHTML = '<option value="">Selecione...</option>'+teams.map(t=>`<option>${t}</option>`).join('');
  });
}
