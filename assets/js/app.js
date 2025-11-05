
// app.js (module)
import { setupAuthUI, verifyToken } from './auth.js';
import { loadMatchesAndRender, matches } from './matches.js';
import { loadRanking } from './ranking.js';
import { loadMyBets } from './myBets.js';
import { setupAllBetsUI, loadAllBets } from './allBets.js';
import { loadStats } from './stats.js';
import { qs, qsa, show, hide } from './utils.js';
import { getBetStatus, saveBetsApi } from './api.js';

function setupTabs() {
  qsa('.tab').forEach(tab=>{
    tab.addEventListener('click', ()=> switchTab(tab.dataset.tab));
  });
}
function switchTab(name) {
  qsa('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  qsa('.tab-content').forEach(c=> c.classList.toggle('active', c.id===name));
  if (name==='ranking') loadRanking();
  if (name==='my-bets') loadMyBets(matches);
  if (name==='all-bets') loadAllBets(1);
  if (name==='stats') loadStats();
}

async function checkBetStatusAndToggle() {
  try {
    const data = await getBetStatus();
    if (data.data?.hasSubmitted) {
      const btn = qs('#save-bets');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-check"></i> Palpites Já Enviados';
    }
  } catch {}
}

function setupSaveBets() {
  qs('#save-bets').addEventListener('click', async ()=>{
    const groupMatches = {};
    document.querySelectorAll('.match-card').forEach(card=>{
      const id = card.dataset.matchId;
      const selected = card.querySelector('.bet-option.selected');
      if (selected) {
        const firstOpt = card.querySelector('.bet-option');
        const teamA = firstOpt?.dataset.bet || '';
        const betVal = selected.dataset.bet;
        if (betVal==='draw') groupMatches[id] = '0-0';
        else groupMatches[id] = (betVal===teamA) ? '1-0' : '0-1';
      }
    });
    const podium = {
      first: qs('#first-place').value,
      second: qs('#second-place').value,
      third: qs('#third-place').value
    };
    if (!podium.first||!podium.second||!podium.third) { alert('Selecione o pódio completo.'); return; }
    try {
      const btn = qs('#save-bets');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';
      await saveBetsApi({ groupMatches, podium });
      btn.innerHTML = '<i class="fas fa-check"></i> Palpites Enviados';
      alert('Palpites salvos!');
    } catch (e) {
      alert('Erro ao salvar: ' + e.message);
      const btn = qs('#save-bets');
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Salvar Todos os Palpites';
    }
  });
}

async function start() {
  setupTabs();
  const { showApp } = setupAuthUI({ onLoggedIn: async ()=>{
    await loadMatchesAndRender();
    await loadRanking();
    await loadMyBets(matches);
    await checkBetStatusAndToggle();
    setupAllBetsUI();
  }});

  const ok = await verifyToken();
  if (ok) {
    showApp();
  } else {
    show(qs('#login-section'));
    hide(qs('#app-section'));
  }

  setupSaveBets();
}

document.addEventListener('DOMContentLoaded', start);
