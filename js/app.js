import { bindTabs, setUserInfo, notify } from './ui.js';
import { api, setToken } from './api.js';
import { initAuth, bindAuthForms, currentUser as CU } from './auth.js';
import { loadMatches, saveAllBets } from './matches.js';
import { loadRanking } from './ranking.js';
import { loadMyBets } from './myBets.js';
import { initAllBets } from './allBets.js';
import { initAdmin } from './admin.js';

export async function initApp(){
  bindTabs();
  bindAuthForms(onAuthenticated);

  // If token exists, try to auto login
  await initAuth();
  if(CU){
    onAuthenticated();
  }
}

function toggleApp(show){
  document.getElementById('login-section').style.display = show ? 'none' : 'block';
  document.getElementById('app-section').style.display = show ? 'block' : 'none';
}

async function onAuthenticated(){
  try{
    const me = await api.me(); // ensure we have isAdmin fresh
    const user = me.user;
    toggleApp(true);
    const adminBadge = user.isAdmin ? '<span class="admin-badge">ADMIN</span>' : '';
    setUserInfo(`Olá, ${user.name}! ${adminBadge}`);

    // Show/hide Admin tab
    const adminTab = document.getElementById('admin-tab');
    adminTab.style.display = user.isAdmin ? 'inline-block' : 'none';

    // Load initial data
    await loadMatches();
    await loadRanking(user);
    await loadMyBets();
    await initAllBets();
    // Save Bets button
    document.getElementById('save-bets').addEventListener('click', () => saveAllBets());
    // If admin, prep admin
    if(user.isAdmin){
      await initAdmin();
    }
  }catch(e){
    notify('error', e.message);
    toggleApp(false);
  }
}
