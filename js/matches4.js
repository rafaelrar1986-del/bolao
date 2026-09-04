// MATCHES4_VERSION: 1.14-refactor-rebuilt-full
import { api } from './api.js';
import { flagEmoji } from './flags.js';
import { $, toast } from './ui.js';
import { getReferenceQualifier as getBackendAlignedQualifier, getMatchPointStatus as getFrontendMatchPointStatus, getEffectiveBetWinner, calculateMatchPoints as calculateScoringMatchPoints } from './frontendScoring.js?v=1.19';
import { withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } from './matches/matchesUtils.js';
import { createKnockoutConfrontationHelpers, getEffectiveStageFormat } from './matches/matchesConfrontation.js';
import { createMatchesScoring } from './matches/matchesScoring.js';
import { createMatchesRules } from './matches/matchesRules.js';
import { createMatchesVisuals } from './matches/matchesVisuals.js';
import { createMatchesUtilsState } from './matches/matchesUtilsState.js';
import { createMatchesBetting } from './matches/matchesBetting.js';
import { createMatchesProgress } from './matches/matchesProgress.js';
import { createMatchesDraft } from './matches/matchesDraft.js';
import { createMatchesSettings } from './matches/matchesSettings.js';
import { createMatchesGroupPrediction } from './matches/matchesGroupPrediction.js';
import { createMatchesGroupsRenderer } from './matches/matchesGroupsRenderer.js';
import { createMatchesKnockoutRenderer } from './matches/matchesKnockoutRenderer.js';
import { createMatchesPodiumExtras } from './matches/matchesPodiumExtras.js';
import { createMatchesModal } from './matches/matchesModal.js';
import { createMatchesController } from './matches/matchesController.js';

const STATE = {
  matches: [],
  betsMap: new Map(),
  lockedMatches: new Set(),
  editingMatches: new Set(),
  savedKnockoutGroups: new Set(),
  // 🔒 Modo de bloqueio definido pelo admin: 'grade' ou 'match'.
  // O backend usa 'grade' como padrão quando a configuração não existe.
  betLockMode: 'grade',
  groupBetAvailabilityMode: 'all',
  unlockedGroupRounds: new Set(),
  lockedGroupRounds: new Set(),
  pointsRunBetAvailabilityMode: 'all',
  unlockedPointsRunRounds: new Set(),
  lockedPointsRunRounds: new Set(),
  knockoutBetAvailabilityMode: 'all',
  unlockedKnockoutRounds: new Set(),
  lockedKnockoutRounds: new Set(),
  testMode: false,
  lockedPhases: new Set(),
  unlockedPhases: new Set(),
  allowBetEditingBeforeLock: true,
  hasSubmitted: false,
  allBets: [],
  officialPodium: null,
  officialExtras: null,
  podium: { first:'', second:'', third:'', fourth:'' },

  // 🆕 Regras de pontuação dinâmicas do admin
  scoringRules: null,
  championshipRules: null,
  scoresMap: new Map(), // matchId -> { scoreA, scoreB }
  knockoutQualifiers: new Map(), // matchId -> 'A' | 'B'
  extras: { topScorer:'', bestAttack:'', worstDefense:'', upset:'' },
  groupPredictions: new Map(),
  groupPredictionPoints: new Map(),
  groupPredictionPointsStarted: new Set(),

  groupFilter: 'group',
  groupStatusFilter: 'all',

  knockoutFilter: 'group',
  knockoutStatusFilter: 'all'
};

window.STATE = STATE;
const CTX = { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, getEffectiveStageFormat, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal };
const rules = createMatchesRules(CTX); Object.assign(CTX, rules);
const confrontation = createKnockoutConfrontationHelpers({ STATE, getChampionshipRules: CTX.getChampionshipRules, isKnockoutMatch, parseMatchDate, calculateScoringMatchPoints, getFrontendMatchPointStatus }); Object.assign(CTX, confrontation);
const visuals = createMatchesVisuals(CTX); Object.assign(CTX, visuals);
const utilsState = createMatchesUtilsState(CTX); Object.assign(CTX, utilsState);
const scoring = createMatchesScoring(CTX); Object.assign(CTX, scoring);
const betting = createMatchesBetting(CTX); Object.assign(CTX, betting);
const progress = createMatchesProgress(CTX); Object.assign(CTX, progress);
const draft = createMatchesDraft(CTX); Object.assign(CTX, draft);
const settings = createMatchesSettings(CTX); Object.assign(CTX, settings);
const groupPrediction = createMatchesGroupPrediction(CTX); Object.assign(CTX, groupPrediction);
const groupsRenderer = createMatchesGroupsRenderer(CTX); Object.assign(CTX, groupsRenderer);
const knockoutRenderer = createMatchesKnockoutRenderer(CTX); Object.assign(CTX, knockoutRenderer);
const podiumExtras = createMatchesPodiumExtras(CTX); Object.assign(CTX, podiumExtras);
const modal = createMatchesModal(CTX); Object.assign(CTX, modal);
const controller = createMatchesController(CTX); Object.assign(CTX, controller);

export const getMissingGroupQualificationBets = CTX.getMissingGroupQualificationBets;
export const getMissingGroupBets = CTX.getMissingGroupBets;
export const isMatchEditable = CTX.isMatchEditable;
export const getMissingExtrasBets = CTX.getMissingExtrasBets;
export const getMissingKnockoutQualifiers = CTX.getMissingKnockoutQualifiers;
export const getKnockoutGroupByMatchId = CTX.getKnockoutGroupByMatchId;
export const getMissingKnockoutDecisionsCount = CTX.getMissingKnockoutDecisionsCount;
export const markKnockoutGroupAsSaved = CTX.markKnockoutGroupAsSaved;
export const saveLocalDraft = CTX.saveLocalDraft;
export const clearLocalDraft = CTX.clearLocalDraft;
export const loadLocalDraft = CTX.loadLocalDraft;
export const buildSavePayload = CTX.buildSavePayload;
export const initMatches = CTX.initMatches;
export const updateMatchDom = CTX.updateMatchDom;
export const alertGoal = CTX.alertGoal;
export const renderMatches = CTX.renderMatches;
export const renderKnockoutMatches = CTX.renderKnockoutMatches;

window.renderMatches = (...args) => CTX.renderMatches?.(...args);
window.renderKnockoutMatches = (...args) => CTX.renderKnockoutMatches?.(...args);
window.setMatchFilter = (f) => { STATE.groupFilter = f; CTX.renderMatches([]); };
window.setKnockoutFilter = (f) => { STATE.knockoutFilter = f; CTX.renderKnockoutMatches([]); };
window.togglePendingFilter = (isPendingOnly) => { STATE.groupStatusFilter = isPendingOnly ? 'pending' : 'all'; CTX.renderMatches([]); };
window.toggleKnockoutPendingFilter = (isPendingOnly) => { STATE.knockoutStatusFilter = isPendingOnly ? 'pending' : 'all'; CTX.renderKnockoutMatches([]); };
window.syncModalData = (...args) => CTX.syncModalData?.(...args);
window.renderLineups = (...args) => CTX.renderLineups?.(...args);
window.abrirDetalhesPartida = (...args) => CTX.abrirDetalhesPartida?.(...args);
window.switchTab = (...args) => CTX.switchTab?.(...args);
window.renderAbaEstatisticas = (...args) => CTX.renderAbaEstatisticas?.(...args);
window.unlockMatchForEdit = (...args) => CTX.unlockMatchForEdit?.(...args);
window.saveSingleBet = (...args) => CTX.saveSingleBet?.(...args);
document.addEventListener('click', function(e) { if (e.target.closest('.bet-option') || e.target.closest('.score-input') || e.target.closest('.score-inputs-row') || e.target.closest('select') || e.target.closest('.btn-edit-bet') || e.target.closest('.btn-save-bet')) return; const card=e.target.closest('.match-card'); if(card){const matchId=card.getAttribute('data-match-id'); if(matchId&&typeof window.abrirDetalhesPartida==='function') window.abrirDetalhesPartida(matchId);}});
(function(){ const syncEngravedFlags=()=>{const selects=document.querySelectorAll('select[data-q]'); if(!selects.length)return; requestAnimationFrame(()=>selects.forEach(sel=>{const wrapper=sel.parentElement;let visual=wrapper.querySelector('.engraved-real-flag');if(!visual){if(getComputedStyle(wrapper).position==='static')wrapper.style.position='relative';visual=document.createElement('div');visual.className='engraved-real-flag';visual.style.position='absolute';visual.style.left='8px';visual.style.top='0px';visual.style.height='100%';visual.style.pointerEvents='none';visual.style.display='flex';visual.style.alignItems='center';visual.style.justifyContent='center';wrapper.appendChild(visual);}const m=window.STATE?.matches?.find(match=>String(match.matchId)===String(sel.dataset.q));if(sel.value&&m){const teamName=sel.value==='A'?m.teamA:m.teamB;const logoUrl=sel.value==='A'?m.logoA:m.logoB;visual.innerHTML=renderTeamMedia(teamName,logoUrl);visual.style.display='flex';}else{visual.innerHTML='';visual.style.display='none';}}));}; window.syncEngravedFlags=syncEngravedFlags; document.addEventListener('change',e=>{if(e.target.matches('select[data-q]'))syncEngravedFlags();}); window.addEventListener('resize',syncEngravedFlags);})();
