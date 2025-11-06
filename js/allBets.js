
import { apiGet } from './api.js';
import { qs, paginate } from './ui.js';

const AB_STATE = { data:[], page:1, pageSize:5, matches:[], matchesMap:{} };

async function loadMatchesForFilter(){
  const res = await apiGet('/api/matches');
  AB_STATE.matches = res.data||[];
  AB_STATE.matchesMap = {};
  AB_STATE.matches.forEach(m=>AB_STATE.matchesMap[m.matchId]=m);
  const sel = qs('#ab-match');
  sel.innerHTML = '<option value="">Todas</option>' + AB_STATE.matches.map(m=>`<option value="${m.matchId}">${m.teamA} vs ${m.teamB}</option>`).join('');
}

async function loadUsersForFilter(){
  const res = await apiGet('/api/bets/users-for-filter', true);
  const sel = qs('#ab-user');
  sel.innerHTML = '<option value="">Todos</option>' + (res.data||[]).map(u=>`<option value="${u._id}">${u.name}</option>`).join('');
}

export async function initAllBetsFilters(){
  await Promise.all([loadMatchesForFilter(), loadUsersForFilter()]);
  qs('#ab-apply').addEventListener('click', ()=>{ AB_STATE.page=1; applyFilters(); });
  qs('#ab-clear').addEventListener('click', ()=>{
    qs('#ab-search').value=''; qs('#ab-match').value=''; qs('#ab-user').value=''; qs('#ab-group').value=''; qs('#ab-sort').value='user';
    AB_STATE.page=1; applyFilters();
  });
  applyFilters();
}

async function applyFilters(){
  const params = new URLSearchParams();
  const search = qs('#ab-search').value.trim();
  const matchId = qs('#ab-match').value;
  const userId = qs('#ab-user').value;
  const group = qs('#ab-group').value.trim();
  const sortBy = qs('#ab-sort').value;

  if(search) params.append('search', search);
  if(matchId) params.append('matchId', matchId);
  if(userId) params.append('userId', userId);
  if(group) params.append('group', group);
  if(sortBy) params.append('sortBy', sortBy);

  const res = await apiGet(`/api/bets/all-bets?${params.toString()}`, true);
  AB_STATE.data = res.data || [];
  renderAllBets(matchId);
}

function renderAllBets(matchIdFilter){
  const container = qs('#all-bets-container');
  if(!AB_STATE.data.length){
    container.innerHTML = '<div class="card">Nenhum palpite encontrado.</div>';
    qs('#ab-pagination').innerHTML='';
    return;
  }
  // paginate by user
  const start = (AB_STATE.page-1)*AB_STATE.pageSize;
  const pageUsers = AB_STATE.data.slice(start, start+AB_STATE.pageSize);

  const html = pageUsers.map(b=>{
    // filter user bets to selected match
    let gm = b.groupMatches || [];
    if(matchIdFilter){
      gm = gm.filter(x=> String(x.matchId) === String(matchIdFilter));
    }
    const chips = gm.map(x=>{
      const m = AB_STATE.matchesMap[x.matchId];
      let cls='';
      if(m && m.status==='finished' && typeof m.scoreA==='number' && typeof m.scoreB==='number'){
        cls = (x.bet === `${m.scoreA}-${m.scoreB}`) ? 'correct' : 'wrong';
      }
      const matchName = m ? `${m.teamA} vs ${m.teamB}` : (x.matchName||`Jogo ${x.matchId}`);
      const resText = (m && m.status==='finished') ? `<div class="small">Resultado: <strong>${m.scoreA}-${m.scoreB}</strong></div>` : '';
      return `<div class="bet-chip ${cls}">
        <div class="match-name">${matchName}</div>
        <div class="small">Palpite: <strong>${x.bet}</strong></div>
        ${resText}
      </div>`;
    }).join('');

    if(matchIdFilter && chips.trim()==='') return '';

    return `<div class="card user-bets-card">
      <div class="user-bets-header">
        <div><strong>${b.userName}</strong></div>
        <div class="small">Pontos: <strong>${b.totalPoints||0}</strong></div>
      </div>
      <div class="bets-grid">${chips || '<div class="small">Sem palpite para esta partida.</div>'}</div>
    </div>`;
  }).join('');

  container.innerHTML = html || '<div class="card">Nenhum palpite para os filtros escolhidos.</div>';
  renderPagination();
}

function renderPagination(){
  const pag = qs('#ab-pagination');
  const items = paginate(AB_STATE.data.length, AB_STATE.page, AB_STATE.pageSize);
  pag.innerHTML = items.map(it=>`<button class="page-btn ${it.active?'active':''}" data-p="${it.p}">${it.p}</button>`).join('');
  pag.querySelectorAll('button').forEach(b=> b.addEventListener('click', ()=>{ AB_STATE.page = parseInt(b.dataset.p); renderAllBets(qs('#ab-match').value); }));
}
