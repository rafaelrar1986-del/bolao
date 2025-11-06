import { api } from './api.js';
import { $, toast } from './ui.js';

export async function loadMyBets(matchesCache){
  const container = document.getElementById('user-bets-container');
  container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
  try{
    const data = await api.myBets();
    const bets = data.data;
    if(!bets){ container.innerHTML = '<p>Você ainda não enviou seus palpites.</p>'; return; }

    let html = `<div class="bet-card">
      <h3><i class="fas fa-user"></i> Informações</h3>
      <p><strong>Status:</strong> ${bets.hasSubmitted?'✅ Enviados':'⏳ Pendentes'}</p>
      ${bets.firstSubmission? `<p><strong>Enviado em:</strong> ${new Date(bets.firstSubmission).toLocaleString('pt-BR')}</p>`:''}
      <p><strong>Pontuação Total:</strong> <span class="points">${bets.totalPoints||0}</span></p>
      <p><strong>Jogos:</strong> ${bets.groupPoints||0}</p>
      <p><strong>Pódio:</strong> ${bets.podiumPoints||0}</p>
    </div>`;

    if(bets.groupMatches?.length){
      html += `<div class="bet-card"><h3><i class="fas fa-futbol"></i> Palpites</h3>`;
      const byGroup = {};
      bets.groupMatches.forEach(b=>{
        const m = matchesCache.find(mm=>mm.matchId===b.matchId);
        if(m){
          byGroup[m.group] = byGroup[m.group]||[];
          byGroup[m.group].push({bet:b, match:m});
        }
      });
      Object.keys(byGroup).sort().forEach(g=>{
        html += `<h4 style="color:var(--primary);margin:12px 0;">${g}</h4>`;
        byGroup[g].forEach(({bet,match})=>{
          const correctOutcome = outcomeFromScore(match.scoreA, match.scoreB);
          const userChoice = betToLabel(bet.bet, match);
          const status = match.status==='finished'
            ? (bet.bet===correctOutcome ? 'win':'lose')
            : 'pending';
          const color = status==='win'?'var(--success)':status==='lose'?'var(--danger)':'#666';
          const statusText = status==='pending'?'⏰ Pendente':(status==='win'?'✓ Acertou':'✗ Errou');
          html += `<div class="bet-item" style="border-left-color:${color}">
            <div class="bet-header"><span><strong>${match.teamA} vs ${match.teamB}</strong></span><span style="color:${color}">${statusText}</span></div>
            <p><strong>Seu palpite:</strong> ${userChoice}</p>
          </div>`;
        });
      });
      html += `</div>`;
    }

    if(bets.podium){
      html += `<div class="bet-card">
        <h3><i class="fas fa-trophy"></i> Pódio</h3>
        <div class="podium-bet-item" style="background:linear-gradient(135deg,gold,#ffd700);color:#000;display:flex;justify-content:space-between;border-radius:6px;margin-bottom:8px;padding:8px 10px;">
          <span><strong>🥇 1º:</strong></span><span>${bets.podium.first||'-'}</span>
        </div>
        <div class="podium-bet-item" style="background:linear-gradient(135deg,silver,#c0c0c0);color:#000;display:flex;justify-content:space-between;border-radius:6px;margin-bottom:8px;padding:8px 10px;">
          <span><strong>🥈 2º:</strong></span><span>${bets.podium.second||'-'}</span>
        </div>
        <div class="podium-bet-item" style="background:linear-gradient(135deg,#cd7f32,#b08d57);color:#000;display:flex;justify-content:space-between;border-radius:6px;padding:8px 10px;">
          <span><strong>🥉 3º:</strong></span><span>${bets.podium.third||'-'}</span>
        </div>
      </div>`;
    }
    container.innerHTML = html;
  }catch(err){
    container.innerHTML = `<p>Erro: ${err.message}</p>`;
  }
}

function outcomeFromScore(a,b){
  if(a==null||b==null) return null;
  if(a>b) return 'A';
  if(b>a) return 'B';
  return 'D';
}
function betToLabel(code, match){
  if(code==='A') return match.teamA;
  if(code==='B') return match.teamB;
  return 'Empate';
}
