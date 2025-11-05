// js/myBets.js
(function(API){
  async function loadMyBets(){
    const box = document.getElementById('user-bets-container');
    try{
      const res = await API.request('/api/bets/my-bets',{auth:true});
      const d = res.data;
      if(!d){
        box.innerHTML = '<p>Você ainda não enviou seus palpites.</p>';
        return;
      }
      let html = `<div class="bet-card">
        <p><strong>Status:</strong> ${d.hasSubmitted ? 'Enviados ✅':'Pendentes ⏳'}</p>
        <p><strong>Total:</strong> ${d.totalPoints||0} pontos — <strong>Jogos:</strong> ${d.groupPoints||0} | <strong>Pódio:</strong> ${d.podiumPoints||0}</p>
      </div>`;
      if(d.groupMatches?.length){
        html += '<h3>Palpites</h3>';
        d.groupMatches.forEach(b=>{
          html += `<div class="bet-card">
            <div class="flex-between"><strong>${b.teamA} vs ${b.teamB}</strong><span class="badge">${b.status||'scheduled'}</span></div>
            <div class="mt">Seu palpite: <strong>${b.bet}</strong> • Pontos: <strong>${b.points||0}</strong></div>
          </div>`;
        });
      }
      if(d.podium){
        html += '<h3>Pódio</h3>';
        html += `<div class="bet-card">🥇 ${d.podium.first||'-'} • 🥈 ${d.podium.second||'-'} • 🥉 ${d.podium.third||'-'}</div>`;
      }
      box.innerHTML = html;
    }catch(e){
      box.innerHTML = `<p>${e.message}</p>`;
    }
  }
  window.MyBets = { loadMyBets };
})(window.API);
