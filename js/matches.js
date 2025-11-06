import { api } from './api.js';
import { $, $$, toast } from './ui.js';

let matches = [];
let teams = [];

export function getMatches(){ return matches; }
export async function loadMatches(){
  const container = $('#matches-container');
  container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando jogos...</div>';
  try{
    const data = await api.listMatches();
    matches = data.data || [];
    renderMatches();
    loadTeams();
  }catch(err){
    container.innerHTML = `<p>Erro ao carregar jogos: ${err.message}</p>`;
  }
}

function renderMatches(){
  const container = $('#matches-container');
  if(matches.length===0){ container.innerHTML='<p>Nenhum jogo.</p>'; return; }
  container.innerHTML = matches.map(m => matchCardHTML(m)).join('');
  bindBetClicks();
}

function matchCardHTML(m){
  const statusBadge = m.status==='finished' ? `<span style="color:var(--success);font-weight:700">✓ Finalizado</span>` :
    (m.status==='in_progress' ? `<span style="color:var(--warning);font-weight:700">⏳ Em andamento</span>` :
    `<span style="color:var(--info)">⏰ Agendado</span>`);
  const result = m.status==='finished' ? `<div style="text-align:center;margin-top:8px;background:#f8f9fa;border-radius:6px;padding:6px;"><strong>Resultado: ${m.scoreA} - ${m.scoreB}</strong></div>` : '';
  return `<div class="match-card" data-match-id="${m.matchId}">
    <div class="match-header"><span>${m.date} • ${m.time}</span>${statusBadge}</div>
    <div class="match-teams">
      <div class="team"><span class="team-name">${m.teamA}</span></div>
      <div class="vs">VS</div>
      <div class="team"><span class="team-name">${m.teamB}</span></div>
    </div>
    ${result}
    ${m.status!=='finished'?`
      <div class="bet-options">
        <div class="bet-option team-a" data-bet="A" data-team="${m.teamA}">${m.teamA}</div>
        <div class="bet-option draw" data-bet="D" data-team="Empate">Empate</div>
        <div class="bet-option team-b" data-bet="B" data-team="${m.teamB}">${m.teamB}</div>
      </div>`:''}
  </div>`;
}

function bindBetClicks(){
  $$('.bet-option').forEach(opt=>{
    opt.addEventListener('click',()=>{
      const card = opt.closest('.match-card');
      card.querySelectorAll('.bet-option').forEach(o=>o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}

async function loadTeams(){
  try{
    const data = await api.listMatches();
    const set = new Set();
    (data.data||[]).forEach(m=>{ set.add(m.teamA); set.add(m.teamB); });
    teams = [...set].sort();
    ['first-place','second-place','third-place'].forEach(id=>{
      const sel = document.getElementById(id);
      sel.innerHTML = '<option value="">Selecione...</option>' + teams.map(t=>`<option value="${t}">${t}</option>`).join('');
    });
  }catch(e){/* ignore */}
}

export async function saveAllBets(){
  const groupMatches = {};
  document.querySelectorAll('.match-card').forEach(card=>{
    const id = card.dataset.matchId;
    const sel = card.querySelector('.bet-option.selected');
    if(sel){
      // store as semantic winner: 'A','B','D' (draw)
      groupMatches[id] = sel.dataset.bet; 
    }
  });
  // ensure user selected for all matches
  const total = document.querySelectorAll('.match-card').length;
  const selected = Object.keys(groupMatches).length;
  if(selected < total){
    toast('error','Faça palpites em todos os jogos.');
    throw new Error('missing bets');
  }
  const podium = {
    first: document.getElementById('first-place').value,
    second: document.getElementById('second-place').value,
    third: document.getElementById('third-place').value
  };
  if(!podium.first||!podium.second||!podium.third){
    throw new Error('Selecione o pódio completo.');
  }
  const payload = { groupMatches, podium };
  const res = await api.saveBets(payload);
  return res;
}
