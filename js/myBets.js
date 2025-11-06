
import { apiGet } from './api.js';
import { qs } from './ui.js';

let matchesById = {};

async function loadMatchesMap(){
  const res = await apiGet('/api/matches');
  (res.data||[]).forEach(m=>{ matchesById[m.matchId]=m; });
}

export async function loadMyBetsUI(){
  const container = qs('#user-bets-container');
  container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
  try{
    await loadMatchesMap();
    const res = await apiGet('/api/bets/my-bets', true);
    const b = res.data;
    if(!b){ container.innerHTML = '<div class="card">Você ainda não enviou seus palpites.</div>'; return; }

    // header
    let html = `<div class="card">
      <h3>Informações</h3>
      <p><strong>Status:</strong> ${b.hasSubmitted?'✅ Enviados':'⏳ Pendentes'}</p>
      <p><strong>Total:</strong> ${b.totalPoints||0} pontos | Jogos: ${b.groupPoints||0} | Pódio: ${b.podiumPoints||0}</p>
    </div>`;

    // group matches in a grid chips
    const byGroup = {};
    (b.groupMatches||[]).forEach(gm=>{
      const m = matchesById[gm.matchId];
      if(!m) return;
      (byGroup[m.group] ||= []).push({gm, m});
    });

    html += Object.keys(byGroup).sort().map(g=>{
      const chips = byGroup[g].map(({gm,m})=>{
        const finished = m.status==='finished';
        let correctness = '';
        if(finished && typeof m.scoreA==='number' && typeof m.scoreB==='number'){
          const ok = gm.bet === `${m.scoreA}-${m.scoreB}`;
          correctness = ok ? 'correct' : 'wrong';
        }
        return `<div class="bet-chip ${correctness}">
          <div class="match-name">${m.teamA} vs ${m.teamB}</div>
          <div class="small">Seu palpite: <strong>${gm.bet}</strong></div>
          ${finished? `<div class="small">Resultado: <strong>${m.scoreA}-${m.scoreB}</strong></div>`:''}
        </div>`;
      }).join('');
      return `<div class="card user-bets-card">
        <div class="user-bets-header"><h4>${g}</h4></div>
        <div class="bets-grid">${chips}</div>
      </div>`;
    }).join('');

    // podium
    if(b.podium){
      html += `<div class="card">
        <h3><i class="fas fa-trophy"></i> Pódio</h3>
        <div class="bets-grid">
          <div class="bet-chip"><div>🥇 1º</div><strong>${b.podium.first||'-'}</strong></div>
          <div class="bet-chip"><div>🥈 2º</div><strong>${b.podium.second||'-'}</strong></div>
          <div class="bet-chip"><div>🥉 3º</div><strong>${b.podium.third||'-'}</strong></div>
        </div>
      </div>`;
    }

    container.innerHTML = html;
  }catch(e){
    container.innerHTML = '<div class="card">Erro ao carregar seus palpites.</div>';
  }
}
