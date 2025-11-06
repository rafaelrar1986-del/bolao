import { api } from './api.js';
import { notify } from './ui.js';

let matches = [];
let teams = [];

export async function loadMatches(){
  const res = await api.listMatches();
  matches = res.data || [];
  renderMatches();
  loadTeamsForPodium();
}

function renderMatches(){
  const container = document.getElementById('matches-container');
  if(matches.length===0){ container.innerHTML = '<p>Nenhum jogo encontrado.</p>'; return; }
  // Group by group
  const groups = {};
  matches.forEach(m => {
    (groups[m.group] = groups[m.group] || []).push(m);
  });
  let html = '';
  Object.keys(groups).sort().forEach(groupName => {
    html += `<h3 class="group-title">${groupName}</h3>`;
    groups[groupName].forEach(match=> html += matchCard(match));
  });
  container.innerHTML = html;
  bindBetClicks();
}

function matchCard(m){
  const statusBadge = m.status==='finished' ?
    `<span style="color: var(--success); font-weight: bold;">✓ Finalizado</span>` :
    m.status==='in_progress' ? `<span style="color: var(--warning); font-weight: bold;">⏳ Em andamento</span>` :
    `<span style="color: var(--info);">⏰ Agendado</span>`;
  const resultText = m.status==='finished' ? 
    `<div class="center" style="margin-top:6px"><strong>Resultado: ${m.scoreA} - ${m.scoreB}</strong></div>` : '';
  return `<div class="match-card" data-match-id="${m.matchId}">
    <div class="match-header"><span>${m.date} • ${m.time}</span>${statusBadge}</div>
    <div class="match-teams">
      <div class="team"><span class="team-name">${m.teamA}</span></div>
      <div class="vs">VS</div>
      <div class="team"><span class="team-name">${m.teamB}</span></div>
    </div>
    ${resultText}
    ${m.status!=='finished' ? `
    <div class="bet-options">
      <div class="bet-option team-a" data-bet="${m.teamA}">${m.teamA}</div>
      <div class="bet-option draw" data-bet="draw">Empate</div>
      <div class="bet-option team-b" data-bet="${m.teamB}">${m.teamB}</div>
    </div>`: ''}
  </div>`;
}

function bindBetClicks(){
  document.querySelectorAll('.bet-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      const card = opt.closest('.match-card');
      card.querySelectorAll('.bet-option').forEach(o=>o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}

async function loadTeamsForPodium(){
  const set = new Set();
  matches.forEach(m => { set.add(m.teamA); set.add(m.teamB); });
  teams = Array.from(set).sort();
  const ids = ['first-place','second-place','third-place'];
  ids.forEach(id=>{
    const select = document.getElementById(id);
    select.innerHTML = '<option value="">Selecione...</option>' + teams.map(t=>`<option>${t}</option>`).join('');
  });
}

export async function saveAllBets(token){
  // collect bets
  const groupMatches = {};
  let missing = false;
  document.querySelectorAll('.match-card').forEach(card => {
    const matchId = card.dataset.matchId;
    const selected = card.querySelector('.bet-option.selected');
    if(selected){
      const isDraw = selected.dataset.bet==='draw';
      const isTeamA = selected.classList.contains('team-a');
      const bet = isDraw ? '0-0' : (isTeamA ? '1-0' : '0-1');
      groupMatches[matchId] = bet;
    }else{
      missing = true;
    }
  });
  const podium = {
    first: document.getElementById('first-place').value,
    second: document.getElementById('second-place').value,
    third: document.getElementById('third-place').value
  };
  if(missing) return notify('error','Faça palpites em todos os jogos!');
  if(!podium.first||!podium.second||!podium.third) return notify('error','Selecione todas as posições do pódio!');
  const btn = document.getElementById('save-bets');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
  try{
    const res = await api.saveBets({ groupMatches, podium });
    notify('success','Palpites salvos!');
    btn.innerHTML = '<i class="fas fa-check"></i> Palpites Enviados';
  }catch(e){
    notify('error','Erro ao salvar: ' + e.message);
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Salvar Todos os Palpites';
  }
}
