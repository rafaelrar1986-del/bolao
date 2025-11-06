import { api } from './api.js';
import { $, $$, toast } from './ui.js';

const STATE = {
  data: [],
  page: 1,
  pageSize: 5,
  filter: { search:'', matchId:'', group:'', sortBy:'user' }
};

export async function initAllBets(){
  await Promise.all([loadMatchesForFilter(), loadAllBets(true)]);
  bindActions();
}

function bindActions(){
  $('#btn-search').addEventListener('click', ()=>{
    STATE.page = 1;
    STATE.filter = {
      search: $('#filter-search').value.trim(),
      matchId: $('#filter-match').value,
      group: $('#filter-group').value.trim(),
      sortBy: $('#filter-sort').value
    };
    loadAllBets(false);
  });
  $('#btn-clear').addEventListener('click', ()=>{
    $('#filter-search').value='';
    $('#filter-match').value='';
    $('#filter-group').value='';
    $('#filter-sort').value='user';
    STATE.page=1;
    STATE.filter = { search:'', matchId:'', group:'', sortBy:'user' };
    loadAllBets(false);
  });
}

async function loadMatchesForFilter(){
  try{
    const res = await api.matchesForFilter();
    const sel = $('#filter-match');
    sel.innerHTML = '<option value="">Todas</option>' + (res.data||[]).map(m=>`<option value="${m.matchId}">${m.matchId} - ${m.teamA} vs ${m.teamB}</option>`).join('');
  }catch(e){/* ignore */}
}

async function loadAllBets(firstLoad){
  const cont = $('#all-bets-container');
  cont.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
  try{
    const params = { ...STATE.filter };
    const res = await api.allBets(params);
    const enriched = (res.data||[]).map(userBet => {
      // Se um matchId foi filtrado, mostrar só os palpites daquela partida
      if(STATE.filter.matchId){
        const wanted = parseInt(STATE.filter.matchId,10);
        return { ...userBet, groupMatches: userBet.groupMatches.filter(m=>m.matchId===wanted) };
      }
      return userBet;
    }).filter(u => u.groupMatches && u.groupMatches.length>0); // filtra vazios quando matchId setado

    STATE.data = enriched;
    renderList();
  }catch(err){
    cont.innerHTML = `<p>Erro ao carregar: ${err.message}</p>`;
  }
}

function renderList(){
  const cont = $('#all-bets-container');
  if(!STATE.data.length){ cont.innerHTML = '<p>Nada encontrado.</p>'; $('#all-bets-pagination').innerHTML=''; return; }
  const start = (STATE.page-1)*STATE.pageSize;
  const pageItems = STATE.data.slice(start, start+STATE.pageSize);

  cont.innerHTML = pageItems.map(u => userBlock(u)).join('');
  renderPagination();
}

function userBlock(u){
  // Cabeçalho só com nome (sem email)
  const header = `<div class="user-bets-header">
    <div><strong>${u.userName}</strong></div>
    <div>Pontos: <strong>${u.totalPoints||0}</strong></div>
  </div>`;

  const chips = u.groupMatches.map(gm=>{
    const correct = resolveOutcome(gm);
    const userChoice = gm.bet === 'A' ? gm.teamA : gm.bet === 'B' ? gm.teamB : 'Empate';
    const status = (gm.status==='finished')
      ? (gm.bet === correct ? 'win':'lose') : 'pending';
    return `<span class="chip ${status}" title="${gm.matchName}">${gm.matchName}: ${userChoice}</span>`;
  }).join('');

  return `<div class="user-bets-compact">
    ${header}
    <div class="chips">${chips || '<em>Sem palpites</em>'}</div>
  </div>`;
}

function resolveOutcome(gm){
  if(gm.status!=='finished' || gm.scoreA==null || gm.scoreB==null) return null;
  if(gm.scoreA>gm.scoreB) return 'A';
  if(gm.scoreB>gm.scoreA) return 'B';
  return 'D';
}

function renderPagination(){
  const totalPages = Math.ceil(STATE.data.length / STATE.pageSize) || 1;
  const pag = $('#all-bets-pagination');
  pag.innerHTML = '';
  for(let p=1;p<=totalPages;p++){
    const b = document.createElement('button');
    b.className = 'page-btn'+(p===STATE.page?' active':'');
    b.textContent = p;
    b.addEventListener('click', ()=>{ STATE.page=p; renderList(); });
    pag.appendChild(b);
  }
}
