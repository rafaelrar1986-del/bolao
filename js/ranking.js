// js/ranking.js
(function(API){
  async function loadRanking(){
    const body = document.getElementById('ranking-body');
    try{
      const res = await API.request('/api/bets/leaderboard',{auth:true});
      const rows = (res.data||[]).map(e=>`
        <tr>
          <td>${e.position}</td>
          <td>${e.user?.name||'-'}</td>
          <td><strong>${e.totalPoints||0}</strong></td>
          <td>${e.groupPoints||0}</td>
          <td>${e.podiumPoints||0}</td>
          <td>${e.bonusPoints||0}</td>
        </tr>`).join('');
      body.innerHTML = rows || '<tr><td colspan="6" class="center">Nenhum participante</td></tr>';
    }catch(e){
      body.innerHTML = `<tr><td colspan="6" class="center">${e.message}</td></tr>`;
    }
  }
  window.Ranking = { loadRanking };
})(window.API);
