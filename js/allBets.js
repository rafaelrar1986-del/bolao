import { api } from './api.js';
import { notify } from './ui.js';

const AB_STATE = {
  raw: [],
  filtered: [],
  page: 1,
  pageSize: 5,
  lastParams: {}
};

export async function initAllBets(){
  await Promise.all([fillMatchesSelect(), fillUsersSelect()]);
  // Bind buttons
  document.getElementById('ab-apply').addEventListener('click', () => applySearch());
  document.getElementById('ab-clear').addEventListener('click', () => clearFilters());
  document.getElementById('ab-prev').addEventListener('click', () => changePage(-1));
  document.getElementById('ab-next').addEventListener('click', () => changePage(1));
  // Initial fetch (no filters)
  await applySearch();
}

async function fillMatchesSelect(){
  const res = await api.matchesForFilter();
  const sel = document.getElementById('ab-matchId');
  sel.innerHTML = '<option value="">Todas</option>' + (res.data||[]).map(m => `<option value="${m.matchId}">${m.matchId} - ${m.teamA} vs ${m.teamB} (${m.group})</option>`).join('');
}

async function fillUsersSelect(){
  const res = await api.usersForFilter();
  const sel = document.getElementById('ab-userId');
  sel.innerHTML = '<option value="">Todos</option>' + (res.data||[]).map(u => `<option value="${u._id}">${u.name} (${u.email})</option>`).join('');
}

export async function applySearch(){
  const params = {
    search: document.getElementById('ab-search').value.trim(),
    matchId: document.getElementById('ab-matchId').value,
    userId: document.getElementById('ab-userId').value,
    group: document.getElementById('ab-group').value.trim(),
    sortBy: document.getElementById('ab-sortBy').value
  };
  AB_STATE.lastParams = params;
  try{
    const res = await api.allBets(params);
    AB_STATE.raw = res.data || [];
    // Front-end filter: if matchId provided, keep only that match inside each user's groupMatches
    if(params.matchId){
      const mid = parseInt(params.matchId);
      AB_STATE.filtered = AB_STATE.raw.map(u => ({
        ...u,
        groupMatches: (u.groupMatches||[]).filter(gm => gm.matchId === mid)
      })).filter(u => u.groupMatches && u.groupMatches.length>0);
    }else if(params.search){
      const s = params.search.toLowerCase();
      AB_STATE.filtered = AB_STATE.raw.map(u => {
        // detect matches that include search in matchName
        const gm = (u.groupMatches||[]).filter(g => (g.matchName||'').toLowerCase().includes(s));
        // also allow filter by user name
        const nameHit = (u.userName||'').toLowerCase().includes(s);
        return { ...u, groupMatches: nameHit ? (u.groupMatches||[]) : gm };
      }).filter(u => u.groupMatches && u.groupMatches.length>0);
    }else{
      AB_STATE.filtered = AB_STATE.raw.slice();
    }
    AB_STATE.page = 1;
    renderPage();
  }catch(e){
    notify('error','Erro ao buscar palpites: ' + e.message);
  }
}

export function clearFilters(){
  document.getElementById('ab-search').value = '';
  document.getElementById('ab-matchId').value = '';
  document.getElementById('ab-userId').value = '';
  document.getElementById('ab-group').value = '';
  document.getElementById('ab-sortBy').value = 'user';
  applySearch();
}

function changePage(delta){
  const totalPages = Math.max(1, Math.ceil(AB_STATE.filtered.length / AB_STATE.pageSize));
  AB_STATE.page = Math.min(totalPages, Math.max(1, AB_STATE.page + delta));
  renderPage();
}

function renderPage(){
  const wrap = document.getElementById('ab-results');
  const { page, pageSize, filtered } = AB_STATE;
  const total = filtered.length;
  const start = (page-1)*pageSize;
  const slice = filtered.slice(start, start+pageSize);
  if(total===0){
    wrap.innerHTML = '<div class="message info">Nenhum resultado encontrado.</div>';
  }else{
    wrap.innerHTML = slice.map(renderUserBlock).join('');
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  document.getElementById('ab-prev').disabled = page<=1;
  document.getElementById('ab-next').disabled = page>=totalPages;
  document.getElementById('ab-page-label').textContent = `Página ${page} de ${totalPages}`;
}

function renderUserBlock(userBet){
  const header = `<div class="bet-card">
    <h3 style="margin:0 0 8px 0">${userBet.userName} <small style="color:#666">(${userBet.userEmail})</small></h3>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div><strong>Total:</strong> ${userBet.totalPoints||0}</div>
      <div><strong>Grupos:</strong> ${userBet.groupPoints||0}</div>
      <div><strong>Pódio:</strong> ${userBet.podiumPoints||0}</div>
      <div><strong>Atualizado:</strong> ${userBet.lastUpdate ? new Date(userBet.lastUpdate).toLocaleString('pt-BR') : '-'}</div>
    </div>
  </div>`;
  if(!userBet.groupMatches || userBet.groupMatches.length===0){
    return header + '<div class="bet-item">Sem palpites para os filtros atuais.</div>';
  }
  const chips = userBet.groupMatches.map(g => {
    const status = g.status==='finished' ? '✓' : '⏰';
    return `<span class="bet-option" style="cursor:default">${status} ${g.matchName} • Palpite: <strong>${g.bet||'-'}</strong></span>`;
  }).join(' ');
  return header + `<div class="card">${chips}</div>`;
}
