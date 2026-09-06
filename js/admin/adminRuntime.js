// Shared runtime/state for the modular Admin panel.
import { flagEmoji } from '../flags.js';
import { DEFAULT_SCORING, DEFAULT_CHAMPIONSHIP_RULES, SAVE_LOCK_KEYS } from './adminConstants.js';
import { withFlag as formatWithFlag } from './adminUtils.js';
function getAdminLeagueId() {
  return localStorage.getItem('adminSelectedLeagueId') || localStorage.getItem('selectedLeagueId') || '';
}

/**
 * When the Admin panel is entered, the league currently selected by the
 * participant is the default league to manage. This intentionally does not
 * change selectedLeagueId: adminSelectedLeagueId remains an independent
 * state while the Admin is open and can still be changed with its selector.
 */
function syncAdminLeagueWithSelectedLeague() {
  const selectedId = String(localStorage.getItem('selectedLeagueId') || '').trim();
  if (!selectedId) return '';

  const selectedName = localStorage.getItem('selectedLeagueName') || '';
  return setAdminLeagueId(selectedId, selectedName);
}

function setAdminLeagueId(id, name = '') {
  const value = String(id);
  localStorage.setItem('adminSelectedLeagueId', value);
  if (name) localStorage.setItem('adminSelectedLeagueName', String(name));
  return value;
}

export const R = {
 getAdminLeagueId, setAdminLeagueId, syncAdminLeagueWithSelectedLeague, activeAdminTab:'group', selectedAdminMatchIds:new Set(), adminMatchesPanelOpen:false, adminMatchSelectionMode:false,
 AdminState:{matches:[],leagues:[],adminInitialized:false}, paymentQrCode:'',
 CurrentSettings:{scoringRules:{...DEFAULT_SCORING,groupQualificationRules:[]},championshipRules:{...DEFAULT_CHAMPIONSHIP_RULES},championshipResults:{topScorer:null,bestAttack:null,worstDefense:null,upset:null},podium:[],prizeZone:{positions:0,totalAmount:0,distribution:[]},rankingRules:{tieBreakers:[]},payment:{pixKey:'',pixQrCode:''},betLockMode:'grade'},
 GLOBAL_SAVE_LOCKS:{blockSaveBets:false,blockSaveKnockout:false,requireAllBets:false,allowBetEditingBeforeLock:false,testMode:false,lockedPhases:new Set(),unlockedPhases:new Set(),betLockMode:'grade'},
 KNOCKOUT_GROUPS:['16-avos de final','Oitavas de final','Quartas de final','Semifinal','3º lugar','Final'],
 withFlag:(name)=>formatWithFlag(name,flagEmoji), SAVE_LOCK_KEYS
};
export function registerAdminFunctions(fns){Object.assign(R,fns);}


// ADMIN-CATEGORY-SELECTOR-V3
(function(){
  const labels = {
    participants:"👥 PARTICIPANTES",
    payments:"💳 PAGAMENTOS",
    rules:"🎯 REGRAS DA COMPETIÇÃO",
    control:"🔒 CONTROLE DO BOLÃO",
    communication:"📧 COMUNICAÇÃO",
    system:"⚙️ SISTEMA",
    advanced:"🛠️ FERRAMENTAS AVANÇADAS"
  };

  function initAdminCategorySelector(){
    const selector=document.getElementById("admin-category-selector");
    if(!selector) return;
    const main=selector.querySelector("#admin-category-selector-btn");
    const label=selector.querySelector(".admin-category-selector-label");
    const menu=selector.querySelector("#admin-category-selector-menu");
    const choices=selector.querySelectorAll("[data-admin-category-choice]");
    const drawers=document.querySelectorAll("#admin .admin-tools-drawer.admin-category-drawer");
    if(!main || !label || !menu || !drawers.length) return;

    function closeMenu(){
      menu.hidden=true;
      main.setAttribute("aria-expanded","false");
    }
    function selectCategory(key){
      drawers.forEach(d=>{
        const active=d.getAttribute("data-admin-category")===key;
        d.classList.toggle("admin-category-active",active);
        if(active) d.setAttribute("open","");
      });
      choices.forEach(c=>c.classList.toggle("active",c.getAttribute("data-admin-category-choice")===key));
      label.textContent=labels[key] || key;
      closeMenu();
    }

    if(!selector.dataset.initialized){
      selector.dataset.initialized="1";
      main.addEventListener("click",function(e){
        e.stopPropagation();
        menu.hidden=!menu.hidden;
        main.setAttribute("aria-expanded",String(!menu.hidden));
      });
      choices.forEach(c=>c.addEventListener("click",function(){
        selectCategory(c.getAttribute("data-admin-category-choice"));
      }));
      document.addEventListener("click",function(e){
        if(!selector.contains(e.target)) closeMenu();
      });
      document.addEventListener("keydown",function(e){
        if(e.key==="Escape") closeMenu();
      });
      selectCategory("participants");
    }
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",initAdminCategorySelector);
  }else{
    initAdminCategorySelector();
  }
  window.initAdminCategorySelector=initAdminCategorySelector;
})();
