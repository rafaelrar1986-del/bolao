import { api } from './api.js';

let matchesCache = [];

export async function loadMyBets(){
  // ensure matches to enrich display
  if(matchesCache.length===0){
    const m = await api.listMatches();
    matchesCache = m.data || [];
  }
  const res = await api.myBets();
  const container = document.getElementById('user-bets-container');
  const bets = res.data;
  if(!bets){ container.innerHTML = '<p>Nenhum palpite enviado.</p>'; return; }
  const header = `<div class="bet-card">
    <h3><i class="fas fa-user"></i> Informações dos Palpites</h3>
    <p><strong>Status:</strong> ${bets.hasSubmitted ? '✅ Enviados' : '⏳ Pendentes'}</p>
    ${bets.hasSubmitted ? `<p><strong>Enviado em:</strong> ${new Date(bets.firstSubmission).toLocaleString('pt-BR')}</p>` : ''}
    <p><strong>Pontuação Total:</strong> <span style="color: var(--primary); font-weight: bold;">${bets.totalPoints||0} pontos</span></p>
    <p><strong>Pontos dos Jogos:</strong> ${bets.groupPoints||0} pontos</p>
    <p><strong>Pontos do Pódio:</strong> ${bets.podiumPoints||0} pontos</p>
  </div>`;

  let groups = {};
  (bets.groupMatches||[]).forEach(b => {
    const match = matchesCache.find(m => m.matchId === b.matchId);
    if(!match) return;
    (groups[match.group] = groups[match.group] || []).push({ bet:b, match });
  });

  let html = header + '<div class="bet-card"><h3><i class="fas fa-futbol"></i> Palpites - Fase de Grupos</h3>';
  Object.keys(groups).sort().forEach(g => {
    html += `<h4 style="color:var(--primary);margin:10px 0">${g}</h4>`;
    groups[g].forEach(({bet, match}) => {
      const pointsText = bet.points>0 ? `<span style="color:var(--success);font-weight:700">+${bet.points} ponto(s)</span>` : `<span style="color:var(--danger)">0 pontos</span>`;
      const status = match.status==='finished' ? `<span style="color:${bet.points>0?'var(--success)':'var(--danger)'}">✓ Finalizado</span>` : `<span style="color:var(--info)">⏰ Pendente</span>`;
      html += `<div class="bet-item">
        <div class="bet-header" style="display:flex;justify-content:space-between;font-weight:600">
          <span>${match.teamA} vs ${match.teamB}</span>${status}
        </div>
        <p><strong>Seu palpite:</strong> ${bet.bet}</p>
        <p><strong>Pontuação:</strong> ${pointsText}</p>
      </div>`;
    });
  });
  html += '</div>';
  if(bets.podium){
    html += `<div class="bet-card">
      <h3><i class="fas fa-trophy"></i> Palpite do Pódio Final</h3>
      <div class="podium-bet-item" style="background: linear-gradient(135deg, gold, #ffd700);"><span><strong>🥇 1º Lugar:</strong></span><span>${bets.podium.first||'-'}</span></div>
      <div class="podium-bet-item" style="background: linear-gradient(135deg, silver, #c0c0c0);"><span><strong>🥈 2º Lugar:</strong></span><span>${bets.podium.second||'-'}</span></div>
      <div class="podium-bet-item" style="background: linear-gradient(135deg, #cd7f32, #b08d57);"><span><strong>🥉 3º Lugar:</strong></span><span>${bets.podium.third||'-'}</span></div>
    </div>`;
  }
  container.innerHTML = html;
}
