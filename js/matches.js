// js/matches.js
(function(API, UI){
  let matches = [];
  let teams = [];

  function matchCard(m){
    const status = m.status === 'finished' ? '<span class="badge ok">Finalizado</span>' :
                   m.status === 'in_progress' ? '<span class="badge warn">Em andamento</span>' :
                   '<span class="badge wait">Agendado</span>';
    const result = m.status === 'finished' ? `<div class="bet-card"><strong>Resultado:</strong> ${m.scoreA} - ${m.scoreB}</div>` : '';
    return `
      <div class="match" data-match-id="${m.matchId}">
        <div class="hdr"><span>${m.date} • ${m.time}</span>${status}</div>
        <div class="teams"><span>${m.teamA}</span><span>VS</span><span>${m.teamB}</span></div>
        ${m.status !== 'finished' ? `
        <div class="bet-options">
          <div class="choice" data-bet="${m.teamA}">${m.teamA}</div>
          <div class="choice" data-bet="draw">Empate</div>
          <div class="choice" data-bet="${m.teamB}">${m.teamB}</div>
        </div>`: ''}
        ${result}
      </div>`;
  }

  function setupBetClicks(){
    UI.$$('.choice').forEach(el=>{
      el.addEventListener('click', ()=>{
        const wrap = el.closest('.match');
        UI.$$('.choice', wrap).forEach(x=>x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
  }

  async function loadMatches(){
    const data = await API.request('/api/matches');
    matches = data.data || [];
    const container = document.getElementById('matches-container');
    if(matches.length===0){ container.innerHTML = '<p>Nenhum jogo.</p>'; return; }
    // group by group
    const byGroup = {};
    matches.forEach(m=>{ byGroup[m.group] = byGroup[m.group]||[]; byGroup[m.group].push(m); });
    let html = '';
    Object.keys(byGroup).sort().forEach(g=>{
      html += `<h3>${g}</h3>` + byGroup[g].map(matchCard).join('');
    });
    container.innerHTML = html;
    setupBetClicks();
    buildTeamList(matches);
  }

  function buildTeamList(list){
    const set = new Set();
    list.forEach(m=>{ set.add(m.teamA); set.add(m.teamB); });
    teams = Array.from(set).sort();
    ['first-place','second-place','third-place'].forEach(id=>{
      const sel = document.getElementById(id);
      sel.innerHTML = '<option value="">Selecione...</option>' + teams.map(t=>`<option value="${t}">${t}</option>`).join('');
    });
  }

  async function saveAllBets(){
    const groupMatches = {};
    UI.$$('.match').forEach(card=>{
      const matchId = card.dataset.matchId;
      const selected = UI.$('.choice.selected', card);
      if(selected){
        const val = selected.dataset.bet;
        groupMatches[matchId] = (val==='draw') ? '0-0' : (val===UI.$('.choice', card).dataset.bet ? '1-0' : '0-1');
      }
    });
    // validate all chosen
    const totalCards = UI.$$('.match').length;
    if(Object.keys(groupMatches).length !== totalCards){
      UI.showMessage('save-message','error','Faça palpites em todos os jogos');
      return;
    }

    const podium = {
      first: document.getElementById('first-place').value,
      second: document.getElementById('second-place').value,
      third: document.getElementById('third-place').value
    };
    if(!podium.first || !podium.second || !podium.third){
      UI.showMessage('save-message','error','Selecione o pódio completo');
      return;
    }

    const btn = document.getElementById('save-bets');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
    try{
      await API.request('/api/bets/save',{method:'POST', body:{groupMatches, podium}, auth:true});
      UI.showMessage('save-message','success','Palpites salvos!');
      btn.innerHTML = '<i class="fas fa-check"></i> Palpites Enviados';
    }catch(e){
      UI.showMessage('save-message','error', e.message);
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Salvar Palpites';
    }
  }

  async function checkBetStatus(){
    try{
      const res = await API.request('/api/bets/status',{auth:true});
      if(res.data?.hasSubmitted){
        const btn = document.getElementById('save-bets');
        btn.disabled = true; btn.innerHTML = '<i class="fas fa-check"></i> Palpites Já Enviados';
      }
    }catch{}
  }

  window.Matches = { loadMatches, saveAllBets, checkBetStatus };
})(window.API, window.UI);
