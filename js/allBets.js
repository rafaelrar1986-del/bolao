// js/allBets.js
(function(API, UI){
  const STATE = { raw: [], page:1, pageSize:5, filters:{search:'', matchId:'', userId:'', sortBy:'user'} };

  function cardUser(b){
    const chips = (b.groupMatches||[]).map(m=>`<span class="bet-chip">${m.matchName||('Jogo '+m.matchId)} • ${m.bet}</span>`).join('');
    return `<div class="card">
      <div class="flex-between">
        <div><strong>${b.userName}</strong> <small style="color:var(--muted)">${b.userEmail}</small></div>
        <div class="badge">Total: <strong>${b.totalPoints||0}</strong></div>
      </div>
      <div class="mt">${chips||'<small>Sem palpites</small>'}</div>
    </div>`;
  }

  function render(){
    const list = document.getElementById('ab-list');
    // pagination
    const start = (STATE.page-1)*STATE.pageSize;
    const pageItems = STATE.raw.slice(start, start+STATE.pageSize);
    list.innerHTML = pageItems.map(cardUser).join('') || '<p>Nenhum resultado.</p>';

    const pag = document.getElementById('ab-pagination');
    const pages = Math.max(1, Math.ceil(STATE.raw.length/STATE.pageSize));
    let html = '';
    for(let i=1;i<=pages;i++){
      html += `<button class="page-btn ${i===STATE.page?'active':''}" data-page="${i}">${i}</button>`;
    }
    pag.innerHTML = html;
    UI.$$('#ab-pagination .page-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ STATE.page = parseInt(btn.dataset.page); render(); });
    });
  }

  async function loadFilters(){
    try{
      const [mf, uf] = await Promise.all([
        API.request('/api/bets/matches-for-filter',{auth:true}),
        API.request('/api/bets/users-for-filter',{auth:true})
      ]);
      const selMatch = document.getElementById('ab-match');
      const selUser = document.getElementById('ab-user');
      selMatch.innerHTML = '<option value="">Todas</option>' + (mf.data||[]).map(m=>`<option value="${m.matchId}">${m.matchId} - ${m.teamA} vs ${m.teamB}</option>`).join('');
      selUser.innerHTML = '<option value="">Todos</option>' + (uf.data||[]).map(u=>`<option value="${u._id}">${u.name}</option>`).join('');
    }catch(e){ /* silencioso */ }
  }

  async function fetchAllBets(){
    const params = new URLSearchParams();
    const f = STATE.filters;
    if(f.search) params.append('search', f.search);
    if(f.matchId) params.append('matchId', f.matchId);
    if(f.userId) params.append('userId', f.userId);
    if(f.sortBy) params.append('sortBy', f.sortBy);

    const res = await API.request(`/api/bets/all-bets?${params.toString()}`, {auth:true});
    STATE.raw = res.data || [];
    STATE.page = 1;
    render();
  }

  function setupUI(){
    UI.$('#ab-search').addEventListener('input', e=>{ STATE.filters.search = e.target.value.trim(); fetchAllBets(); });
    UI.$('#ab-match').addEventListener('change', e=>{ STATE.filters.matchId = e.target.value; fetchAllBets(); });
    UI.$('#ab-user').addEventListener('change', e=>{ STATE.filters.userId = e.target.value; fetchAllBets(); });
    UI.$('#ab-sort').addEventListener('change', e=>{ STATE.filters.sortBy = e.target.value; fetchAllBets(); });
  }

  async function init(){
    await loadFilters();
    await fetchAllBets();
  }

  window.AllBets = { init, render };
})(window.API, window.UI);
