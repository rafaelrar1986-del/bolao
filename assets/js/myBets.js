
// myBets.js (module)
import { getMyBets } from './api.js';
import { html, qs } from './utils.js';

export async function loadMyBets(matchesCache=[]) {
  const container = qs('#user-bets-container');
  try {
    const data = await getMyBets();
    const bets = data.data;
    if (!bets) {
      html(container, '<p>Você ainda não enviou seus palpites.</p>');
      return;
    }
    let h = `
      <div class="card">
        <h3>Informações</h3>
        <p><strong>Status:</strong> ${bets.hasSubmitted ? '✅ Enviados' : '⏳ Pendentes'}</p>
        ${bets.hasSubmitted ? `<p><strong>Enviado em:</strong> ${new Date(bets.firstSubmission).toLocaleString('pt-BR')}</p>`:''}
        <p><strong>Total:</strong> <span style="color:var(--primary);font-weight:700">${bets.totalPoints||0} pts</span></p>
        <p><strong>Grupos:</strong> ${bets.groupPoints||0} — <strong>Pódio:</strong> ${bets.podiumPoints||0}</p>
      </div>`;

    if (bets.groupMatches?.length) {
      const byGroup = {};
      bets.groupMatches.forEach(b => {
        const m = (matchesCache||[]).find(x=>x.matchId===b.matchId);
        const g = m?.group || 'Grupo';
        byGroup[g] = byGroup[g] || [];
        byGroup[g].push({ bet:b, match:m });
      });
      h += `<div class="card"><h3>Palpites de Jogos</h3>`;
      Object.keys(byGroup).sort().forEach(g=>{
        h += `<h4 style="color:var(--primary);margin:10px 0">${g}</h4>`;
        byGroup[g].forEach(({bet,match})=>{
          const status = match?.status==='finished' ? 'Finalizado' : 'Pendente';
          h += `<div class="bet-item">
            <div class="bet-header"><span>${match?`${match.teamA} vs ${match.teamB}`:`Jogo ${bet.matchId}`}</span><span>${status}</span></div>
            <p><strong>Seu palpite:</strong> ${bet.bet}</p>
            <p><strong>Pontos:</strong> ${bet.points>0?`<span style="color:var(--success);font-weight:700">+${bet.points}</span>`:`<span style="color:var(--danger)">0</span>`}</p>
          </div>`;
        });
      });
      h += `</div>`;
    }

    if (bets.podium) {
      h += `<div class="card">
        <h3>Pódio</h3>
        <p>🥇 ${bets.podium.first || '—'}</p>
        <p>🥈 ${bets.podium.second || '—'}</p>
        <p>🥉 ${bets.podium.third || '—'}</p>
      </div>`;
    }
    html(container, h);
  } catch (e) {
    html(container, '<p>Erro ao carregar palpites.</p>');
  }
}
