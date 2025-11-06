
import { apiGet, apiPost } from './api.js';
import { qs, toast } from './ui.js';

let matches = [];
let teams = [];

export async function loadMatchesUI(){
  const container = qs('#matches-container');
  try{
    const res = await apiGet('/api/matches');
    matches = res.data || [];
    renderMatches(container);
    collectTeams();
  }catch(e){
    container.innerHTML = '<div class="card">Erro ao carregar jogos.</div>';
  }
}

function renderMatches(container){
  if(!matches.length){
    container.innerHTML = '<div class="card">Nenhum jogo.</div>';
    return;
  }
  const groups = {};
  matches.forEach(m=>{ (groups[m.group] ||= []).push(m); });
  container.innerHTML = Object.keys(groups).sort().map(g=>{
    return `
      <div class="card">
        <h3 class="group-title">${g}</h3>
        ${groups[g].map(m=>matchCard(m)).join('')}
      </div>
    `;
  }).join('');
  attachBetClicks();
}

function matchCard(m){
  const statusBadge = m.status==='finished' ? '<span style="color:#28a745;font-weight:700;">Finalizado</span>' :
                      m.status==='in_progress' ? '<span style="color:#ffc107;font-weight:700;">Em andamento</span>' :
                      '<span style="color:#17a2b8;">Agendado</span>';
  const resultText = m.status==='finished' ? `<div><strong>Resultado:</strong> ${m.scoreA} - ${m.scoreB}</div>` : '';
  return `
    <div class="match-card" data-match-id="${m.matchId}">
      <div class="match-header"><span>${m.date} • ${m.time}</span>${statusBadge}</div>
      <div class="match-teams">
        <span class="team-name">${m.teamA}</span>
        <span>vs</span>
        <span class="team-name">${m.teamB}</span>
      </div>
      ${resultText}
      ${m.status!=='finished' ? `
      <div class="bet-options" style="display:flex;gap:8px;margin-top:6px;">
        <button class="btn btn-light bet-option" data-bet="${m.teamA}">${m.teamA}</button>
        <button class="btn btn-light bet-option" data-bet="draw">Empate</button>
        <button class="btn btn-light bet-option" data-bet="${m.teamB}">${m.teamB}</button>
      </div>`:''}
    </div>
  `;
}

function attachBetClicks(){
  document.querySelectorAll('.bet-option').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const mc = btn.closest('.match-card');
      mc.querySelectorAll('.bet-option').forEach(b=>b.classList.remove('btn-primary'));
      btn.classList.add('btn-primary');
      mc.dataset.choice = btn.dataset.bet;
    });
  });
}

function collectTeams(){
  const set = new Set();
  matches.forEach(m=>{ set.add(m.teamA); set.add(m.teamB); });
  teams = Array.from(set).sort();
  ['first-place','second-place','third-place'].forEach(id=>{
    const sel = qs(`#${id}`);
    if(!sel) return;
    sel.innerHTML = '<option value="">Selecione...</option>' + 
      teams.map(t=>`<option value="${t}">${t}</option>`).join('');
  });
}

export function readUserChoices(){
  const cards = Array.from(document.querySelectorAll('.match-card'));
  const groupMatches = {};
  for(const c of cards){
    const id = c.dataset.matchId;
    const choice = c.dataset.choice;
    if(!choice) continue;
    if(choice==='draw') groupMatches[id] = '0-0';
    else {
      // simples 1-0 para escolhido, 0-1 para o outro
      const teamA = c.querySelectorAll('.bet-option')[0].dataset.bet;
      groupMatches[id] = (choice===teamA) ? '1-0' : '0-1';
    }
  }
  return { groupMatches };
}

export async function saveAllBets(podium, messageBox){
  const { groupMatches } = readUserChoices();
  if(Object.keys(groupMatches).length === 0){
    toast(messageBox,'error','Faça palpites em pelo menos um jogo.');
    return;
  }
  if(!podium.first || !podium.second || !podium.third){
    toast(messageBox,'error','Selecione todas as posições do pódio.');
    return;
  }
  try{
    const res = await apiPost('/api/bets/save',{ groupMatches, podium }, true);
    toast(messageBox,'success','Palpites salvos com sucesso!');
  }catch(e){
    toast(messageBox,'error', e.message || 'Erro ao salvar palpites');
  }
}
