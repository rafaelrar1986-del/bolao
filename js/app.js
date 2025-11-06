
import { qs, qsa, setActiveTab, toast, closeModal } from './ui.js';
import { doLogin, doRegister, loadMe, currentUser } from './auth.js';
import { loadMatchesUI, saveAllBets } from './matches.js';
import { loadRankingUI } from './ranking.js';
import { loadMyBetsUI } from './myBets.js';
import { initAllBetsFilters } from './allBets.js';
import { loadAdminArea } from './admin.js';

export async function initApp(){
  // Tabs click
  qsa('.tab').forEach(t=> t.addEventListener('click', ()=> setActiveTab(t.dataset.tab)) );
  qs('#modal-close').addEventListener('click', closeModal);

  // Login/Register handlers
  qs('#login-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const email = qs('#login-email').value.trim();
    const password = qs('#login-password').value.trim();
    try{
      await doLogin(email, password);
      showApp();
    }catch(err){
      alert(err.message || 'Erro no login');
    }
  });
  qs('#register-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = qs('#register-name').value.trim();
    const email = qs('#register-email').value.trim();
    const password = qs('#register-password').value.trim();
    try{
      await doRegister(name, email, password);
      alert('Conta criada! Agora, faça login.');
    }catch(err){
      alert(err.message || 'Erro no registro');
    }
  });

  const me = await loadMe();
  if(me){ showApp(); }
}

function showApp(){
  // UI toggles
  qs('#login-section').style.display = 'none';
  qs('#app-section').style.display = 'block';

  // user info
  const adminBadge = currentUser?.isAdmin ? '<span class="admin-badge">ADMIN</span>' : '';
  qs('#user-info').innerHTML = `Olá, ${currentUser?.name||'-'}! ${adminBadge}`;

  // admin tab visibility
  qs('#admin-tab').style.display = currentUser?.isAdmin ? 'inline-flex' : 'none';

  // initial loads
  loadMatchesUI();
  loadRankingUI();
  loadMyBetsUI();
  initAllBetsFilters();
  if(currentUser?.isAdmin){ loadAdminArea(); }

  // save bets
  qs('#save-bets').onclick = ()=>{
    const podium = {
      first: qs('#first-place').value,
      second: qs('#second-place').value,
      third: qs('#third-place').value
    };
    const box = qs('#save-message');
    saveAllBets(podium, box);
  };
}
