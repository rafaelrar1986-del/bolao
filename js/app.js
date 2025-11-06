import { $, setActiveTab, toast } from './ui.js';
import { api, getToken } from './api.js';
import { bindAuthForms, verifyToken, renderUserInfo, currentUser } from './auth.js';
import { loadMatches, getMatches, saveAllBets } from './matches.js';
import { loadRanking } from './ranking.js';
import { loadMyBets } from './myBets.js';
import { initAllBets } from './allBets.js';
import { loadAdminMatches, bindAdminButtons } from './admin.js';

function showApp(){
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('app-section').style.display = 'block';
}

async function onLoggedIn(){
  showApp();
  await postLoginBootstrap();
}

async function postLoginBootstrap(){
  try{
    await verifyToken();
    renderUserInfo();
    await loadMatches();
    await loadRanking();
    await loadMyBets(getMatches());
    await initAllBets();
    if(currentUser?.isAdmin){
      bindAdminButtons();
      await loadAdminMatches();
    }
    // Check bet status to disable save if needed
    try{
      const st = await api.betsStatus();
      if(st.data?.hasSubmitted){
        const btn = document.getElementById('save-bets');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-check"></i> Palpites Enviados';
      }
    }catch(e){/* ignore */}
  }catch(e){
    toast('error','Erro ao carregar app: '+e.message);
  }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', async ()=>{
      const tab = t.dataset.tab;
      setActiveTab(tab);
      if(tab==='ranking') await loadRanking();
      else if(tab==='my-bets') await loadMyBets(getMatches());
      else if(tab==='admin' && (window._isAdmin || (await verifyToken() && (window._isAdmin = (await verifyToken()).isAdmin)))){
        // when switching, refresh admin list
        await loadAdminMatches();
      }
    });
  });

  // Auth
  bindAuthForms(onLoggedIn);

  // Save bets
  document.getElementById('save-bets').addEventListener('click', async ()=>{
    try{
      const res = await saveAllBets();
      toast('success','Palpites salvos!');
      const btn = document.getElementById('save-bets');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-check"></i> Palpites Enviados';
    }catch(e){ if(e.message!=='missing bets') toast('error', e.message); }
  });

  // Auto login if token
  if(getToken()){
    try{
      await onLoggedIn();
    }catch(e){
      // token inválido: fica na tela de login
    }
  }
});
