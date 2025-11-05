// js/app.js
(function(UI, API, Auth, Matches, Ranking, MyBets, AllBets, Admin){
  function bindTabs(){
    UI.$$('.tab').forEach(tab=>{
      tab.addEventListener('click', ()=>{
        UI.setActiveTab(tab.dataset.tab);
        switch(tab.dataset.tab){
          case 'ranking': Ranking.loadRanking(); break;
          case 'my-bets': MyBets.loadMyBets(); break;
          case 'all-bets': AllBets.init(); break;
          case 'admin': Admin.loadAdminMatches(); break;
          case 'stats': loadStats(); break;
        }
      });
    });
  }

  async function loadStats(){
    const box = document.getElementById('stats-container');
    try{
      const res = await API.request('/api/points/stats',{auth:true});
      const s = res.data || {};
      box.innerHTML = `
        <div class="grid-3">
          <div class="card"><div><strong>Participantes</strong></div><div class="mt">${s.participants||0}</div></div>
          <div class="card"><div><strong>Partidas Finalizadas</strong></div><div class="mt">${s.finishedMatches||0}</div></div>
          <div class="card"><div><strong>Maior Pontuação</strong></div><div class="mt">${s.maxPoints||0}</div></div>
        </div>`;
    }catch(e){
      box.innerHTML = `<p>${e.message}</p>`;
    }
  }

  async function afterLogin(){
    Matches.loadMatches();
    Matches.checkBetStatus();
    Ranking.loadRanking();
    MyBets.loadMyBets();
    Admin.bindAdminButtons();
  }

  async function boot(){
    bindTabs();
    Auth.setupAuthForms();
    const ok = await Auth.verifyToken();
    if(ok){ afterLogin(); }
    document.getElementById('save-bets').addEventListener('click', Matches.saveAllBets);
  }

  window.App = { boot, afterLogin };
  document.addEventListener('DOMContentLoaded', boot);
})(window.UI, window.API, window.Auth, window.Matches, window.Ranking, window.MyBets, window.AllBets, window.Admin);
