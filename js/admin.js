// js/admin.js
// Admin: listar, adicionar, editar, finalizar, reabrir e excluir partidas + utilitários
// 🆕 VERSÃO ALINHADA: scoringRules, championshipRules, championshipResults

import { api } from './api.js';
import { flagEmoji } from './flags.js';
import { toast, openModal, closeModal } from './ui.js';
import { renderTeamMedia } from './matches/matchesUtils.js';

const STATUS_LABELS = {
  'scheduled': 'Agendado',
  '1_tempo': '1º Tempo',
  'intervalo': 'Intervalo',
  '2_tempo': '2º Tempo',
  'prorrogacao': 'Prorrogação',
  'penaltis': 'Pênaltis',
  'finished': 'Finalizado',
  'cancelled': 'Cancelado',
  'postponed': 'Adiado'
};

// Elementos fixos esperados no HTML
const $adminMatchesList = () => document.getElementById('admin-matches-list');

// --- NOVO ESTADO PARA AS PILLS ---
let activeAdminTab = 'group';
const selectedAdminMatchIds = new Set();
let adminMatchesPanelOpen = false;
let adminMatchSelectionMode = false; 

// FUNÇÃO PARA ALTERNAR ABAS (CORREÇÃO DE ESCOPO)
window.switchAdminTab = function(tab) {
  activeAdminTab = tab;
  renderAdminMatches(AdminState.matches);
};

function withFlag(name) {
  const f = flagEmoji(name);
  return f ? `${f} ${name}` : name;
}

const AdminState = {
  matches: [],
};

/* ============================================================
   🆕 CONFIGURAÇÕES DE PONTUAÇÃO (SCORING RULES)
   ============================================================ */

// 🆕 Fallbacks alinhados com backend (bets.js DEFAULT_SCORING)
const DEFAULT_SCORING = {
  exactScore: 5,
  scoreTeamA: 1,
  scoreTeamB: 1,
  winner: 2,
  topScorer: 10,
  bestAttack: 10,
  worstDefense: 10,
  upset: 15,
  podiumPoints: [20, 15, 10, 5],
  matchRules: []
};

const DEFAULT_CHAMPIONSHIP_RULES = {
  drawIncludesExtraTime: false,
  winnerFromScore: true,
  podiumSize: 4,
  hasGroupPhase: true,
  hasKnockoutPhase: false,
  knockoutFormat: 'single',
  knockoutAwayGoals: false,
  groupQualification: {
    totalTeams: 0,
    groupCount: 0,
    totalQualified: 0,
    legs: 1
  }
};

// Estado em memória das configurações da liga atual
let paymentQrCode = '';
let CurrentSettings = {
  scoringRules: { ...DEFAULT_SCORING, groupQualificationRules: [] },
  championshipRules: { ...DEFAULT_CHAMPIONSHIP_RULES },
  championshipResults: { topScorer: null, bestAttack: null, worstDefense: null, upset: null },
  podium: [],
  prizeZone: { positions: 0, totalAmount: 0, distribution: [] },
  rankingRules: { tieBreakers: [] },
  payment: { pixKey: '', pixQrCode: '' },
  betLockMode: 'grade'
};

/**
 * 🆕 Carrega todas as configurações da liga (scoring, championship, results)
 */
async function loadLeagueSettings() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  try {
    const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
    if (res?.success && res.data) {
      CurrentSettings.scoringRules = {
        ...DEFAULT_SCORING,
        groupQualificationRules: [],
        ...(res.data.scoringRules || {})
      };
      CurrentSettings.championshipRules = {
        ...DEFAULT_CHAMPIONSHIP_RULES,
        ...(res.data.championshipRules || {}),
        hasGroupPhase: res.data.championshipRules?.hasGroupPhase !== false
      };
      CurrentSettings.championshipResults = {
        topScorer: null, bestAttack: null, worstDefense: null, upset: null,
        ...(res.data.championshipResults || {})
      };
      CurrentSettings.podium = res.data.podium || [];
      CurrentSettings.prizeZone = {
        positions: 0,
        totalAmount: 0,
        distribution: [],
        ...(res.data.prizeZone || {})
      };
      CurrentSettings.rankingRules = {
        tieBreakers: [],
        ...(res.data.rankingRules || {})
      };
      CurrentSettings.payment = {
        pixKey: String(res.data.pixKey || ''),
        pixQrCode: String(res.data.pixQrCode || '')
      };
      CurrentSettings.betLockMode =
        res.data.betLockMode || CurrentSettings.betLockMode;
    }
  } catch (err) {
    console.warn('Erro ao carregar configurações da liga:', err);
  }
}

/* ============================================================
   CONTROLE DE VISIBILIDADE POR FASE (ATUALIZADO PARA MULTI-LIGAS)
   ============================================================ */

async function renderPhaseControls() {
    const container = document.getElementById('admin-phase-controls');
    if (!container) return;

    const leagueId = localStorage.getItem('selectedLeagueId') || '1';

    try {
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        const unlocked = res.data.unlockedPhases || [];
        const groupMode = res.data.groupBetAvailabilityMode === 'round' ? 'round' : 'all';
        const pointsRunMode =
            res.data.pointsRunBetAvailabilityMode === 'round' ? 'round' : 'all';
        const unlockedPointsRunRounds =
            (res.data.unlockedPointsRunRounds || []).map(Number);
        const knockoutMode =
            res.data.knockoutBetAvailabilityMode === 'round' ? 'round' : 'all';
        const unlockedKnockoutRounds =
            (res.data.unlockedKnockoutRounds || []).map(Number);
        const unlockedRounds = (res.data.unlockedGroupRounds || []).map(Number);
        const knockoutSelect = document.getElementById('match-group-knockout');

        let groupRounds = [];
        let pointsRunRounds = [];
        let knockoutRounds = [];
        let knockoutRoundLabels = {};
        let allLeagueMatches = [];
        let knockoutMatches = [];
        try {
            const matchesRes = await api.get(`/api/matches?leagueId=${leagueId}`);
            allLeagueMatches = matchesRes.data?.data || matchesRes.data || [];
            groupRounds = [...new Set(
                allLeagueMatches
                    .filter(m => m.phase === 'group' && Number.isInteger(Number(m.roundNumber)) && Number(m.roundNumber) > 0)
                    .map(m => Number(m.roundNumber))
            )].sort((a,b) => a-b);
            pointsRunRounds = [...new Set(
                allLeagueMatches
                    .filter(m => {
                        const phase = String(m.phase || '').toLowerCase();
                        return (
                            (phase === 'pontos_corridos' || phase === 'points_run') &&
                            Number.isInteger(Number(m.roundNumber)) &&
                            Number(m.roundNumber) > 0
                        );
                    })
                    .map(m => Number(m.roundNumber))
            )].sort((a,b) => a-b);
            knockoutMatches = allLeagueMatches
                .filter(m => String(m.phase || '').toLowerCase() === 'knockout');

            knockoutRounds = [...new Set(
                knockoutMatches
                    .map(m => Number(m.roundNumber))
                    .filter(n => Number.isInteger(n) && n > 0)
            )].sort((a,b) => a-b);

            knockoutMatches.forEach(m => {
                const r = Number(m.roundNumber);
                if (Number.isInteger(r) && r > 0 && !knockoutRoundLabels[r]) {
                    knockoutRoundLabels[r] = m.group || m.phaseName || `Rodada ${r}`;
                }
            });
        } catch (e) {
            console.warn('Não foi possível carregar rodadas da fase de grupos:', e);
        }

        // Somente exibir um bloco de disponibilidade quando a liga realmente
        // possuir partidas daquela fase.
        const hasGroupMatches = allLeagueMatches.some(
            m => String(m.phase || '').toLowerCase() === 'group'
        );
        const hasPointsRunMatches = allLeagueMatches.some(m => {
            const phase = String(m.phase || '').toLowerCase();
            return phase === 'pontos_corridos' || phase === 'points_run';
        });
        const hasKnockoutMatches = knockoutMatches.length > 0;

        // Quantidade de partidas realmente cadastradas em cada modo.
        // O contador representa o universo disponível para aquela fase,
        // independentemente de quantas rodadas estejam atualmente liberadas.
        const groupMatchCount = allLeagueMatches.filter(
            m => String(m.phase || '').toLowerCase() === 'group'
        ).length;
        const pointsRunMatchCount = allLeagueMatches.filter(m => {
            const phase = String(m.phase || '').toLowerCase();
            return phase === 'pontos_corridos' || phase === 'points_run';
        }).length;
        const knockoutMatchCount = knockoutMatches.length;

        let phases = [
            { id: 'group', label: 'Grupos' },
            { id: 'podium', label: 'Pódio' }
        ];

        if (knockoutSelect) {
            const knockoutOptions = Array.from(knockoutSelect.options)
                .filter(opt => opt.value && opt.value !== "")
                .map(opt => ({
                    id: opt.value,
                    label: opt.text
                }));

            phases = [...phases, ...knockoutOptions];
        }

        // A ordem visual do mata-mata nunca depende de roundNumber.
        // O roundNumber vindo da API pode representar outra convenção.
        const knockoutOrder = [
            '16-avos de final',
            'Oitavas de final',
            'Quartas de final',
            'Semifinal',
            '3º lugar',
            'Final'
        ];
        const knockoutOrderIndex = label => {
            const normalized = String(label || '').trim().toLowerCase();
            const index = knockoutOrder.findIndex(x => x.toLowerCase() === normalized);
            return index >= 0 ? index : 999;
        };

        // Nome curto somente para a interface. O nome original da etapa
        // continua sendo preservado no dado da partida.
        const knockoutDisplayLabel = label => {
            const normalized = String(label || '').trim().toLowerCase();
            const shortLabels = {
                '16-avos de final': '16-avos',
                'oitavas de final': 'Oitavas',
                'quartas de final': 'Quartas',
                'semifinal': 'Semifinal',
                '3º lugar': '3º lugar',
                'final': 'Final'
            };
            return shortLabels[normalized] || String(label || '');
        };

        knockoutRounds.sort((a, b) => {
            const labelA = knockoutRoundLabels[a] || `Rodada ${a}`;
            const labelB = knockoutRoundLabels[b] || `Rodada ${b}`;
            const ia = knockoutOrderIndex(labelA);
            const ib = knockoutOrderIndex(labelB);
            if (ia !== ib) return ia - ib;
            return a - b;
        });

        const roundControls = hasGroupMatches ? `
          <div style="grid-column:1/-1; margin-top:10px; padding:10px; border:1px solid rgba(255,255,255,.08); border-radius:8px;">
            <div class="admin-availability-heading">
              <span>📅 Disponibilidade da fase de grupos</span>
              <span class="admin-availability-count">${groupMatchCount} ${groupMatchCount === 1 ? 'partida' : 'partidas'}</span>
            </div>
            <select id="admin-group-bet-mode" onchange="setGroupBetAvailabilityMode(this.value)"
                    style="width:100%; padding:7px; border-radius:6px;">
              <option value="all" ${groupMode === 'all' ? 'selected' : ''}>Liberar a fase de grupos completa</option>
              <option value="round" ${groupMode === 'round' ? 'selected' : ''}>Liberar rodada por rodada</option>
            </select>
            ${groupMode === 'round' ? `
              <div style="margin-top:8px; display:grid; grid-template-columns:repeat(4,1fr); gap:5px;">
                ${groupRounds.map(round => {
                    const on = unlockedRounds.includes(round);
                    return `<button class="btn ${on ? 'btn-success' : 'btn-outline-secondary'}"
                      onclick="toggleGroupRound(${round}, ${on})"
                      style="font-size:10px; min-height:30px;">Rodada ${round}</button>`;
                }).join('')}
              </div>
              ${groupRounds.length === 0 ? '<small style="color:#999;">Nenhuma rodada encontrada nas partidas importadas.</small>' : ''}
            ` : '<small style="display:block; margin-top:6px; color:#888;">Todas as rodadas da fase de grupos ficam disponíveis.</small>'}
          </div>
        ` : '';

        const pointsRunControls = hasPointsRunMatches ? `
          <div id="points-run-controls" style="grid-column:1/-1; margin-top:10px; padding:10px; border:1px solid rgba(255,255,255,.08); border-radius:8px;">
            <div class="admin-availability-heading">
              <span>🏁 Disponibilidade dos pontos corridos</span>
              <span class="admin-availability-count">${pointsRunMatchCount} ${pointsRunMatchCount === 1 ? 'partida' : 'partidas'}</span>
            </div>
            <select id="admin-points-run-bet-mode" onchange="setPointsRunBetAvailabilityMode(this.value)"
                    style="width:100%; padding:7px; border-radius:6px;">
              <option value="all" ${pointsRunMode === 'all' ? 'selected' : ''}>Liberar o campeonato completo</option>
              <option value="round" ${pointsRunMode === 'round' ? 'selected' : ''}>Liberar rodada por rodada</option>
            </select>
            ${pointsRunMode === 'round' ? `
              <div style="margin-top:8px; display:grid; grid-template-columns:repeat(4,1fr); gap:5px;">
                ${pointsRunRounds.map(round => {
                    const on = unlockedPointsRunRounds.includes(round);
                    return `<button class="btn ${on ? 'btn-success' : 'btn-outline-secondary'}"
                      onclick="togglePointsRunRound(${round}, ${on})"
                      style="font-size:10px; min-height:30px;">Rodada ${round}</button>`;
                }).join('')}
              </div>
              ${pointsRunRounds.length === 0 ? '<small style="color:#999;">Nenhuma rodada de pontos corridos encontrada.</small>' : ''}
            ` : '<small style="display:block; margin-top:6px; color:#888;">Todas as rodadas ficam disponíveis.</small>'}
          </div>
        ` : '';

        const knockoutRoundControls = hasKnockoutMatches ? `
          <div id="knockout-round-controls" style="grid-column:1/-1; margin-top:10px; padding:10px; border:1px solid rgba(255,255,255,.08); border-radius:8px;">
            <div class="admin-availability-heading">
              <span>🥊 Disponibilidade do mata-mata</span>
              <span class="admin-availability-count">${knockoutMatchCount} ${knockoutMatchCount === 1 ? 'partida' : 'partidas'}</span>
            </div>
            <select onchange="setKnockoutBetAvailabilityMode(this.value)"
                    style="width:100%; padding:7px; border-radius:6px;">
              <option value="all" ${knockoutMode === 'all' ? 'selected' : ''}>Liberar o mata-mata completo</option>
              <option value="round" ${knockoutMode === 'round' ? 'selected' : ''}>Liberar por etapa/rodada</option>
            </select>
            ${knockoutMode === 'round' ? `
              <div class="admin-knockout-availability-grid" style="margin-top:8px; display:grid; grid-template-columns:repeat(3,1fr); gap:5px;">
                ${knockoutRounds.map(round => {
                  const on = unlockedKnockoutRounds.includes(round);
                  const label = knockoutRoundLabels[round] || `Rodada ${round}`;
                  const displayLabel = knockoutDisplayLabel(label);
                  return `<button class="btn ${on ? 'btn-success' : 'btn-outline-secondary'}"
                    onclick="toggleKnockoutRound(${round}, ${on})"
                    style="font-size:10px; min-height:32px;">${displayLabel}</button>`;
                }).join('')}
              </div>
              ${knockoutRounds.length === 0 ? '<small style="color:#999;">Nenhuma rodada de mata-mata encontrada nas partidas importadas.</small>' : ''}
            ` : '<small style="display:block; margin-top:6px; color:#888;">Todas as etapas do mata-mata ficam disponíveis.</small>'}
          </div>
        ` : '';


        container.innerHTML = `
            <div class="d-flex flex-wrap gap-2" style="display: grid !important; grid-template-columns: repeat(4, 1fr) !important; gap: 5px !important;">
                ${phases.map(p => {
                    const isChecked = unlocked.includes(p.id);
                    return `
                        <button class="btn ${isChecked ? 'btn-success' : 'btn-outline-secondary'}" 
                                onclick="togglePhaseVisibility('${p.id}', ${isChecked})"
                                style="font-size: 10px; height: 32px; padding: 2px; border-radius: 4px; border: none; font-weight: bold;">
                            ${p.label}
                        </button>
                    `;
                }).join('')}
                ${roundControls}
                ${pointsRunControls}
                ${knockoutRoundControls}
            </div>
        `;
    } catch (err) {
        console.error("Erro ao carregar travas:", err);
    }
}

window.togglePhaseVisibility = async function(phaseId, isCurrentlyUnlocked) {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId') || '1';
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        let list = res.data.unlockedPhases || [];

        if (isCurrentlyUnlocked) {
            list = list.filter(id => id !== phaseId);
        } else {
            if (!list.includes(phaseId)) list.push(phaseId);
        }

        await api.post('/api/settings/global', { 
            leagueId: leagueId,
            unlockedPhases: list 
        });

        toast(`Fase "${phaseId}" ${isCurrentlyUnlocked ? 'Bloqueada' : 'Liberada'} na liga ${leagueId}!`, 'success');
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast("Erro ao salvar visibilidade", "error");
    }
};

window.setGroupBetAvailabilityMode = async function(mode) {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId') || '1';
        await api.post('/api/settings/global', {
            leagueId,
            groupBetAvailabilityMode: mode
        });
        toast(
            mode === 'round'
                ? 'Modo rodada por rodada ativado.'
                : 'Fase de grupos completa liberada.',
            'success'
        );
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar modo de disponibilidade das rodadas.', 'error');
    }
};

window.toggleGroupRound = async function(round, isCurrentlyUnlocked) {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId') || '1';
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        let unlockedRounds = (res.data.unlockedGroupRounds || []).map(Number);
        let lockedRounds = (res.data.lockedGroupRounds || []).map(Number);

        if (isCurrentlyUnlocked) {
            unlockedRounds = unlockedRounds.filter(r => r !== Number(round));
        } else {
            if (!unlockedRounds.includes(Number(round))) unlockedRounds.push(Number(round));
            lockedRounds = lockedRounds.filter(r => r !== Number(round));
        }

        await api.post('/api/settings/global', {
            leagueId,
            groupBetAvailabilityMode: 'round',
            unlockedGroupRounds: unlockedRounds,
            lockedGroupRounds: lockedRounds
        });

        toast(`Rodada ${round} ${isCurrentlyUnlocked ? 'bloqueada' : 'liberada'}.`, 'success');
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar a rodada.', 'error');
    }
};

window.setPointsRunBetAvailabilityMode = async function(mode) {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId') || '1';
        await api.post('/api/settings/global', {
            leagueId,
            pointsRunBetAvailabilityMode: mode
        });
        toast(
            mode === 'round'
                ? 'Pontos corridos: rodada por rodada ativado.'
                : 'Pontos corridos: campeonato completo liberado.',
            'success'
        );
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar disponibilidade dos pontos corridos.', 'error');
    }
};

window.togglePointsRunRound = async function(round, isCurrentlyUnlocked) {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId') || '1';
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        let unlockedRounds = (res.data.unlockedPointsRunRounds || []).map(Number);
        let lockedRounds = (res.data.lockedPointsRunRounds || []).map(Number);

        if (isCurrentlyUnlocked) {
            unlockedRounds = unlockedRounds.filter(r => r !== Number(round));
        } else {
            if (!unlockedRounds.includes(Number(round))) unlockedRounds.push(Number(round));
            lockedRounds = lockedRounds.filter(r => r !== Number(round));
        }

        await api.post('/api/settings/global', {
            leagueId,
            pointsRunBetAvailabilityMode: 'round',
            unlockedPointsRunRounds: unlockedRounds,
            lockedPointsRunRounds: lockedRounds
        });

        toast(`Rodada ${round} ${isCurrentlyUnlocked ? 'bloqueada' : 'liberada'}.`, 'success');
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar a rodada dos pontos corridos.', 'error');
    }
};

window.setKnockoutBetAvailabilityMode = async function(mode) {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId') || '1';
        await api.post('/api/settings/global', {
            leagueId,
            knockoutBetAvailabilityMode: mode
        });
        toast(
          mode === 'round'
            ? 'Mata-mata: liberação por etapa/rodada ativada.'
            : 'Mata-mata: todas as etapas liberadas.',
          'success'
        );
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar disponibilidade do mata-mata.', 'error');
    }
};

window.toggleKnockoutRound = async function(round, isCurrentlyUnlocked) {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId') || '1';
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        let unlocked = (res.data.unlockedKnockoutRounds || []).map(Number);
        let locked = (res.data.lockedKnockoutRounds || []).map(Number);

        if (isCurrentlyUnlocked) {
            unlocked = unlocked.filter(r => r !== Number(round));
        } else {
            if (!unlocked.includes(Number(round))) unlocked.push(Number(round));
            locked = locked.filter(r => r !== Number(round));
        }

        await api.post('/api/settings/global', {
            leagueId,
            knockoutBetAvailabilityMode: 'round',
            unlockedKnockoutRounds: unlocked,
            lockedKnockoutRounds: locked
        });

        toast(`Rodada/etapa ${round} ${isCurrentlyUnlocked ? 'bloqueada' : 'liberada'}.`, 'success');
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar etapa do mata-mata.', 'error');
    }
};

// =============== BOOTSTRAP ===============
export function initAdmin() {
  console.log('✅ initAdmin executado');
  window.closeModal = closeModal;
  window.openModal = openModal;
  window.openAddMatchModal = openAddMatchModal;
  window.openFinishMatchModal = openFinishMatchModal;
  window.openSetPodiumModal = openSetPodiumModal;

  // 🆕 NOVOS HANDLERS GLOBAIS
  window.openScoringRulesModal = openScoringRulesModal;
  window.saveScoringRules = saveScoringRules;
  window.openChampionshipRulesModal = openChampionshipRulesModal;
  window.saveChampionshipRules = saveChampionshipRules;
  window.openChampionshipResultsModal = openChampionshipResultsModal;
  window.saveChampionshipResults = saveChampionshipResults;
  window.openBetLockModeModal = openBetLockModeModal;
  window.saveBetLockMode = saveBetLockMode;

  window.handleAddMatch = handleAddMatch;
  window.prepareFinishMatch = prepareFinishMatch;
  window.finishMatch = finishMatch;

  window.editMatch = editMatch;
  window.adminUnfinishMatch = adminUnfinishMatch;
  window.adminDeleteMatchForce = adminDeleteMatchForce;

  window.recalculateAllPoints = recalculateAllPoints;
  window.checkDataIntegrity = checkDataIntegrity;
  window.resetAllBets = resetAllBets;
  window.setPodium = setPodium;

  const btnWhitelist = document.getElementById('btn-open-whitelist-modal');
  if (btnWhitelist) btnWhitelist.addEventListener('click', openWhitelistModal);

  loadAdminMatches();

  loadStatsLockStatus();
  const btnStats = document.getElementById('btn-toggle-stats-lock');
  if (btnStats) btnStats.addEventListener('click', toggleStatsLock);

  const btnEmail = document.getElementById('btn-open-email-modal');
  if (btnEmail) btnEmail.addEventListener('click', openEmailModal);

  const btnAdd = document.getElementById('btn-open-add-modal');
  if (btnAdd) btnAdd.addEventListener('click', openAddMatchModal);

  const btnFinish = document.getElementById('btn-open-finish-modal');
  if (btnFinish) btnFinish.addEventListener('click', openFinishMatchModal);

  const btnPodium = document.getElementById('btn-open-podium-modal');
  if (btnPodium) btnPodium.addEventListener('click', openSetPodiumModal);

  // 🆕 BOTÕES NOVOS DE REGRAS
  const btnScoring = document.getElementById('btn-open-scoring-modal');
  if (btnScoring) btnScoring.addEventListener('click', openScoringRulesModal);

  const btnChampRules = document.getElementById('btn-open-championship-rules-modal');
  if (btnChampRules) btnChampRules.addEventListener('click', openChampionshipRulesModal);

  const btnChampResults = document.getElementById('btn-open-championship-results-modal');
  if (btnChampResults) btnChampResults.addEventListener('click', openChampionshipResultsModal);

  const btnBetLockMode = document.getElementById('btn-open-bet-lock-mode-modal');
  if (btnBetLockMode) btnBetLockMode.addEventListener('click', openBetLockModeModal);

  const btnRecalc = document.getElementById('btn-recalc');
  if (btnRecalc) btnRecalc.addEventListener('click', recalculateAllPoints);
  const btnIntegrity = document.getElementById('btn-integrity');
  if (btnIntegrity) btnIntegrity.addEventListener('click', checkDataIntegrity);

  wireSaveLocksAdmin();

  const btnTestMode = document.getElementById('btn-toggle-test-mode');
  if (btnTestMode) {
    btnTestMode.addEventListener('click', toggleLeagueTestMode);
  }
  refreshTestModeUI();

  renderPhaseControls();

  // 🆕 Carrega configurações da liga
  loadLeagueSettings();
}

/* ============================================================
   🔒 MODAL — MODO DE BLOQUEIO DAS APOSTAS
   ============================================================ */

async function openBetLockModeModal() {
  const old = document.getElementById('bet-lock-mode-modal');
  if (old) old.remove();

  const current = CurrentSettings.betLockMode === 'match' ? 'match' : 'grade';

  const html = `
    <div id="bet-lock-mode-modal" class="modal active">
      <div class="modal-content" style="max-width: 430px;">
        <div class="modal-header">
          <h3>🔒 Bloqueio das Apostas</h3>
          <button class="close-modal"
                  onclick="closeModal('bet-lock-mode-modal')">&times;</button>
        </div>
        <div style="padding: 8px 0;">
          <p style="margin-top:0;">
            Escolha como as partidas serão bloqueadas automaticamente.
          </p>
          <label style="display:block; margin:14px 0; cursor:pointer;">
            <input type="radio" name="bet-lock-mode" value="grade"
                   ${current === 'grade' ? 'checked' : ''}>
            <strong>Por grade</strong>
            <span style="display:block; margin-left:24px; font-size:12px; opacity:.8;">
              Quando uma partida da grade começar, a grade inteira será bloqueada.
            </span>
          </label>
          <label style="display:block; margin:14px 0; cursor:pointer;">
            <input type="radio" name="bet-lock-mode" value="match"
                   ${current === 'match' ? 'checked' : ''}>
            <strong>Por partida</strong>
            <span style="display:block; margin-left:24px; font-size:12px; opacity:.8;">
              Cada partida será bloqueada somente no seu próprio horário.
            </span>
          </label>
        </div>
        <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn btn-secondary" onclick="closeModal('bet-lock-mode-modal')">Cancelar</button>
          <button class="btn btn-primary" onclick="saveBetLockMode()">Salvar</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
}

async function saveBetLockMode() {
  const selected =
    document.querySelector('input[name="bet-lock-mode"]:checked')?.value;

  if (!['grade', 'match'].includes(selected)) {
    toast('Selecione um modo de bloqueio válido.', 'error');
    return;
  }

  const leagueId =
    localStorage.getItem('selectedLeagueId') || '1';

  try {
    const res = await api.post('/api/settings/global', {
      leagueId,
      betLockMode: selected
    });

    if (!res?.success) {
      throw new Error(res?.message || 'Erro ao salvar modo de bloqueio.');
    }

    CurrentSettings.betLockMode = selected;
    toast(
      selected === 'match'
        ? 'Bloqueio definido por partida.'
        : 'Bloqueio definido por grade.',
      'success'
    );
    closeModal('bet-lock-mode-modal');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar modo de bloqueio.', 'error');
  }
}

/* ============================================================
   🆕 MODAL — REGRAS DE PONTUAÇÃO (SCORING RULES)
   ============================================================ */

async function openScoringRulesModal() {
  const old = document.getElementById('scoring-rules-modal');
  if (old) old.remove();

  const r = CurrentSettings.scoringRules || { ...DEFAULT_SCORING };
  const pp = Array.isArray(r.podiumPoints) ? r.podiumPoints : [20,15,10,5];
  const podiumSize = getConfiguredPodiumSize();
  const hasGroup = CurrentSettings.championshipRules?.hasGroupPhase !== false;
  const hasKnockout = CurrentSettings.championshipRules?.hasKnockoutPhase === true;

  const conditionOptions = [
    ['exactScore', 'Placar exato'],
    ['result', 'Resultado'],
    ['scoreTeamA', 'Gols do Time A'],
    ['scoreTeamB', 'Gols do Time B'],
    ['scoreWinner', 'Gols do vencedor'],
    ['scoreLoser', 'Gols do perdedor'],
    ['totalGoals', 'Total de gols'],
    ['goalDifference', 'Diferença de gols']
  ];

  const existingRules = Array.isArray(r.matchRules)
    ? r.matchRules
        .filter(rule => Array.isArray(rule?.conditions) && rule.conditions.length)
        .map(rule => ({
          points: Number(rule.points) || 0,
          conditions: [...new Set(rule.conditions)].filter(c =>
            conditionOptions.some(([key]) => key === c)
          )
        }))
    : [];

  window.__editingMatchRules = existingRules;

  const optionHtml = (selected) => conditionOptions
    .map(([value, label]) =>
      `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`
    ).join('');

  const renderRule = (rule, index) => {
    const conditions = Array.isArray(rule.conditions) && rule.conditions.length
      ? rule.conditions.filter(condition => condition !== 'qualifier')
      : [conditionOptions[0][0]];

    return `
      <div class="scoring-builder-rule" data-rule-index="${index}"
           style="background:rgba(0,0,0,.20); border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:10px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
          <strong style="font-size:.82rem; color:#ffda44;">Regra ${index + 1}</strong>
          <button type="button" class="btn btn-danger btn-remove-match-rule"
                  data-rule-index="${index}" style="padding:4px 8px; font-size:.72rem;">
            Remover
          </button>
        </div>

        <div class="form-row" style="align-items:flex-end;">
          <div class="form-group" style="flex:0 0 110px;">
            <label>Pontos</label>
            <input type="number" min="0" step="1" class="sr-rule-points"
                   value="${rule.points}" style="width:90px;">
          </div>

          <div class="form-group" style="flex:1;">
            <label>Condições <small style="color:#888;">(todas devem ser verdadeiras)</small></label>
            <div class="sr-rule-conditions">
              ${conditions.map((condition, conditionIndex) => `
                <div class="sr-condition-row" style="display:flex; gap:6px; margin-bottom:6px;">
                  <select class="sr-rule-condition" style="flex:1; min-width:0;">
                    ${optionHtml(condition)}
                  </select>
                  <button type="button" class="btn btn-secondary btn-remove-condition"
                          style="padding:4px 8px;" ${conditions.length === 1 ? 'disabled' : ''}>
                    ×
                  </button>
                </div>
              `).join('')}
            </div>
            <button type="button" class="btn btn-secondary btn-add-condition"
                    style="font-size:.72rem; padding:5px 8px;">
              + Condição
            </button>
          </div>
        </div>
      </div>
    `;
  };

  const initialRulesHtml = existingRules.length
    ? existingRules.map(renderRule).join('')
    : `<div id="match-rules-empty"
        style="padding:12px; text-align:center; color:#888; border:1px dashed rgba(255,255,255,.12); border-radius:8px;">
        Nenhuma regra criada. Adicione a primeira regra abaixo.
       </div>`;

  const html = `
    <div id="scoring-rules-modal" class="modal active">
      <div class="modal-content" style="max-width:620px;">
        <div class="modal-header">
          <h3>⚙️ Regras de Pontuação</h3>
          <button class="close-modal" onclick="closeModal('scoring-rules-modal')">&times;</button>
        </div>

        <form id="scoring-rules-form" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">

          <div style="background:linear-gradient(135deg,rgba(0,190,255,.08),rgba(120,70,255,.06)); padding:12px; border-radius:10px; border:1px solid rgba(0,210,255,.16);">
            <h4 style="margin:0 0 5px; color:#2ee8ff;">🎯 Regras das partidas</h4>
            <p style="margin:0 0 10px; color:#aaa; font-size:.72rem; line-height:1.45;">
               Primeiro defina em <b>Regras do Campeonato</b> quais fases e características existem.
               Depois configure aqui <b>o que pontua</b> dentro dessa estrutura.
               Dentro de uma regra, as condições são ligadas por <b>E</b>; regras diferentes funcionam como <b>OU</b>.
             </p>

            <div id="match-rules-builder">${initialRulesHtml}</div>

            <button type="button" id="btn-add-match-rule" class="btn btn-primary"
                    style="width:100%; margin-top:2px;">
              + Adicionar regra
            </button>

            <small style="display:block; color:#777; margin-top:7px;">
              Condições disponíveis:
              ${conditionOptions.map(([,label]) => label).join(' • ')}
            </small>
          </div>

          ${hasKnockout ? `
          <div id="match-extras-panel" style="background:linear-gradient(135deg,rgba(255,180,0,.08),rgba(0,190,255,.05)); padding:12px; border-radius:10px; border:1px solid rgba(255,190,0,.16);">
            <h4 style="margin:0 0 5px; color:#ffd34d;">🎯 Extras por partida do mata-mata</h4>
            <p style="margin:0 0 10px; color:#aaa; font-size:.72rem; line-height:1.45;">
              Estes extras são avaliados <b>em cada confronto</b> do mata-mata. A pontuação entra no total de <b>Mata-mata</b>.
            </p>
            <div class="form-group" style="max-width:180px; margin:0;">
              <label>Classificado</label>
              <input type="number" id="sr-match-extra-qualifier"
                     value="${r.matchExtras?.qualifier ?? 3}"
                     min="0" step="1"
                     style="width:100%; box-sizing:border-box;">
              <small style="display:block; color:#777; margin-top:5px;">Pontos por classificado acertado</small>
            </div>
          </div>
          ` : ''}

          ${hasGroup ? `
          <div id="group-qualification-extra-panel" style="background:linear-gradient(135deg,rgba(255,180,0,.08),rgba(0,190,255,.05)); padding:12px; border-radius:10px; border:1px solid rgba(255,190,0,.16);">
            <h4 style="margin:0 0 5px; color:#ffd34d;">🏆 Classificação da fase de grupos</h4>
            <p style="margin:0 0 10px; color:#aaa; font-size:.72rem; line-height:1.45;">
              Dentro de uma regra, as condições são ligadas por <b>E</b>.
              Regras diferentes funcionam como <b>OU</b>. A primeira regra satisfeita concede os pontos.
            </p>
            <div id="group-qualification-rules-builder"></div>
            <button type="button" id="btn-add-group-qualification-rule" class="btn btn-primary" style="width:100%; margin-top:2px;">
              + Adicionar regra
            </button>
            <small style="display:block; color:#777; margin-top:7px;">
              Condições: Posição correta • Posição incorreta${hasKnockout ? ' • Time classificado • Time não classificado' : ''}
            </small>
          </div>
          ` : ''}

          <div style="background:rgba(0,0,0,.20); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 8px; font-size:.85rem; color:#ffda44;">Pódio — ${podiumSize} ${podiumSize === 1 ? 'posição' : 'posições'}</h4>
            <div style="display:grid; grid-template-columns:repeat(${podiumSize},minmax(0,1fr)); gap:14px; align-items:start;">
              ${getPodiumFieldConfig().slice(0, podiumSize).map((field, index) => `
                <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                  <label style="min-height:2.2em; display:flex; align-items:flex-start;">${index + 1}º</label>
                  <input type="number" id="sr-podium-${index}" value="${pp[index] ?? [20,15,10,5][index]}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
                </div>
              `).join('')}
            </div>
          </div>

          <div style="background:rgba(0,0,0,.20); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 8px; font-size:.85rem; color:#ffda44;">Extras</h4>
            <div style="display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; align-items:start;">
              <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                <label style="min-height:2.8em; display:flex; align-items:flex-start;">Artilheiro</label>
                <input type="number" id="sr-topScorer" value="${r.topScorer ?? 10}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
              </div>
              <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                <label style="min-height:2.8em; display:flex; align-items:flex-start;">Melhor Ataque</label>
                <input type="number" id="sr-bestAttack" value="${r.bestAttack ?? 10}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
              </div>
              <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                <label style="min-height:2.8em; display:flex; align-items:flex-start;">Pior Defesa</label>
                <input type="number" id="sr-worstDefense" value="${r.worstDefense ?? 10}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
              </div>
              <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                <label style="min-height:2.8em; display:flex; align-items:flex-start;">Zebra</label>
                <input type="number" id="sr-upset" value="${r.upset ?? 15}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
              </div>
            </div>
          </div>

          <button type="submit" class="btn btn-success" style="width:100%; margin-top:8px;">
            <i class="fas fa-save"></i> Salvar Regras
          </button>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);

  const builder = document.getElementById('match-rules-builder');
  const addRuleButton = document.getElementById('btn-add-match-rule');

  // ============================================================
  // CONSTRUTOR — EXTRA: CLASSIFICAÇÃO PARA O MATA-MATA
  // ============================================================
  const groupQualificationBuilder = document.getElementById('group-qualification-rules-builder');
  const addGroupQualificationRuleButton = document.getElementById('btn-add-group-qualification-rule');

  const groupQualificationConditionOptions = [
    ['positionCorrect', 'Posição correta'],
    ['positionIncorrect', 'Posição incorreta'],
    ...(hasKnockout
      ? [
          ['teamQualified', 'Time classificado'],
          ['teamNotQualified', 'Time não classificado']
        ]
      : [])
  ];

  const existingGroupQualificationRules =
    Array.isArray(r.groupQualificationRules)
      ? r.groupQualificationRules
          .filter(rule => Array.isArray(rule?.conditions) && rule.conditions.length)
          .map(rule => ({
            points: Number(rule.points) || 0,
            conditions: [...new Set(rule.conditions)].filter(c =>
              groupQualificationConditionOptions.some(([key]) => key === c)
            )
          }))
          .filter(rule => rule.conditions.length)
      : [];

  const groupConditionOptionHtml = (selected) =>
    groupQualificationConditionOptions.map(([value,label]) =>
      `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`
    ).join('');

  const renderGroupQualificationRule = (rule,index) => {
    const conditions = Array.isArray(rule?.conditions) && rule.conditions.length
      ? rule.conditions : ['positionCorrect'];

    return `
      <div class="group-qualification-rule" data-rule-index="${index}"
           style="background:rgba(0,0,0,.20); border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:10px; margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
          <strong style="font-size:.82rem;color:#ffda44;">Regra ${index+1}</strong>
          <button type="button" class="btn btn-danger btn-remove-group-qualification-rule" style="padding:4px 8px;font-size:.72rem;">Remover</button>
        </div>
        <div class="form-row" style="align-items:flex-end;">
          <div class="form-group" style="flex:0 0 110px;">
            <label>Pontos</label>
            <input type="number" min="0" step="1" class="gqr-rule-points" value="${rule?.points ?? 0}" style="width:90px;">
          </div>
          <div class="form-group" style="flex:1;">
            <label>Condições <small style="color:#888;">(todas devem ser verdadeiras)</small></label>
            <div class="gqr-rule-conditions">
              ${conditions.map(condition => `
                <div class="gqr-condition-row" style="display:flex;gap:6px;margin-bottom:6px;">
                  <select class="gqr-rule-condition" style="flex:1;min-width:0;">${groupConditionOptionHtml(condition)}</select>
                  <button type="button" class="btn btn-secondary btn-remove-gqr-condition" style="padding:4px 8px;" ${conditions.length===1?'disabled':''}>×</button>
                </div>`).join('')}
            </div>
            <button type="button" class="btn btn-secondary btn-add-gqr-condition" style="font-size:.72rem;padding:5px 8px;">+ Condição</button>
          </div>
        </div>
      </div>`;
  };

  const refreshGroupQualificationRuleNumbers = () => {
    groupQualificationBuilder?.querySelectorAll('.group-qualification-rule').forEach((el,i) => {
      el.dataset.ruleIndex=i;
      const title=el.querySelector('strong');
      if(title) title.textContent=`Regra ${i+1}`;
    });
  };

  const bindGroupQualificationRule = (ruleEl) => {
    const updateRemoveButtons=()=>{
      const buttons=ruleEl.querySelectorAll('.btn-remove-gqr-condition');
      buttons.forEach(btn=>btn.disabled=buttons.length<=1);
    };

    ruleEl.querySelector('.btn-add-gqr-condition')?.addEventListener('click',()=>{
      const wrapper=ruleEl.querySelector('.gqr-rule-conditions');
      const row=document.createElement('div');
      row.className='gqr-condition-row';
      row.style.cssText='display:flex;gap:6px;margin-bottom:6px;';
      row.innerHTML=`
        <select class="gqr-rule-condition" style="flex:1;min-width:0;">${groupConditionOptionHtml('positionCorrect')}</select>
        <button type="button" class="btn btn-secondary btn-remove-gqr-condition" style="padding:4px 8px;">×</button>`;
      wrapper.appendChild(row);
      row.querySelector('.btn-remove-gqr-condition').addEventListener('click',()=>{
        row.remove(); updateRemoveButtons();
      });
      updateRemoveButtons();
    });

    ruleEl.querySelectorAll('.btn-remove-gqr-condition').forEach(btn=>{
      btn.addEventListener('click',()=>{
        btn.closest('.gqr-condition-row')?.remove(); updateRemoveButtons();
      });
    });

    ruleEl.querySelector('.btn-remove-group-qualification-rule')?.addEventListener('click',()=>{
      ruleEl.remove(); refreshGroupQualificationRuleNumbers();
    });
    updateRemoveButtons();
  };

  if(groupQualificationBuilder){
    groupQualificationBuilder.innerHTML=existingGroupQualificationRules.length
      ? existingGroupQualificationRules.map(renderGroupQualificationRule).join('')
      : `<div class="gqr-empty" style="padding:12px;text-align:center;color:#888;border:1px dashed rgba(255,255,255,.12);border-radius:8px;">Nenhuma regra criada. Adicione a primeira regra abaixo.</div>`;

    groupQualificationBuilder.querySelectorAll('.group-qualification-rule').forEach(bindGroupQualificationRule);

    addGroupQualificationRuleButton?.addEventListener('click',()=>{
      groupQualificationBuilder.querySelector('.gqr-empty')?.remove();
      const index=groupQualificationBuilder.querySelectorAll('.group-qualification-rule').length;
      const temp=document.createElement('div');
      temp.innerHTML=renderGroupQualificationRule({points:0,conditions:['positionCorrect']},index);
      const created=temp.firstElementChild;
      groupQualificationBuilder.appendChild(created);
      bindGroupQualificationRule(created);
      refreshGroupQualificationRuleNumbers();
    });
  }

  const refreshRuleNumbers = () => {
    builder.querySelectorAll('.scoring-builder-rule').forEach((ruleEl, index) => {
      ruleEl.dataset.ruleIndex = index;
      const title = ruleEl.querySelector('strong');
      if (title) title.textContent = `Regra ${index + 1}`;
      ruleEl.querySelector('.btn-remove-match-rule')?.setAttribute('data-rule-index', index);
      ruleEl.querySelectorAll('.sr-rule-condition').forEach(select => {
        select.name = `rule-${index}-condition`;
      });
    });
  };

  const bindConditionButtons = (ruleEl) => {
    const add = ruleEl.querySelector('.btn-add-condition');
    add?.addEventListener('click', () => {
      const wrapper = ruleEl.querySelector('.sr-rule-conditions');
      const row = document.createElement('div');
      row.className = 'sr-condition-row';
      row.style.cssText = 'display:flex; gap:6px; margin-bottom:6px;';
      row.innerHTML = `
        <select class="sr-rule-condition" style="flex:1; min-width:0;">
          ${optionHtml(conditionOptions[0][0])}
        </select>
        <button type="button" class="btn btn-secondary btn-remove-condition" style="padding:4px 8px;">×</button>
      `;
      wrapper.appendChild(row);
      refreshRuleNumbers();
      updateRemoveConditionState(ruleEl);
      row.querySelector('.btn-remove-condition')?.addEventListener('click', () => {
        row.remove();
        updateRemoveConditionState(ruleEl);
      });
    });

    ruleEl.querySelectorAll('.btn-remove-condition').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.sr-condition-row')?.remove();
        updateRemoveConditionState(ruleEl);
      });
    });
  };

  const updateRemoveConditionState = (ruleEl) => {
    const buttons = ruleEl.querySelectorAll('.btn-remove-condition');
    buttons.forEach(btn => { btn.disabled = buttons.length <= 1; });
  };

  const bindRule = (ruleEl) => {
    bindConditionButtons(ruleEl);
    updateRemoveConditionState(ruleEl);
    ruleEl.querySelector('.btn-remove-match-rule')?.addEventListener('click', () => {
      ruleEl.remove();
      const empty = document.getElementById('match-rules-empty');
      if (!builder.querySelector('.scoring-builder-rule') && !empty) {
        builder.innerHTML = `<div id="match-rules-empty" style="padding:12px; text-align:center; color:#888; border:1px dashed rgba(255,255,255,.12); border-radius:8px;">Nenhuma regra criada. Adicione a primeira regra abaixo.</div>`;
      }
      refreshRuleNumbers();
    });
  };

  builder.querySelectorAll('.scoring-builder-rule').forEach(bindRule);

  addRuleButton?.addEventListener('click', () => {
    const empty = document.getElementById('match-rules-empty');
    if (empty) empty.remove();

    const index = builder.querySelectorAll('.scoring-builder-rule').length;

    // Cria exatamente um elemento da regra. A versão anterior criava um
    // wrapper vazio, renderizava a regra duas vezes e depois fazia replaceWith,
    // o que podia deixar o listener do botão inconsistente em alguns browsers.
    const temp = document.createElement('div');
    temp.innerHTML = renderRule(
      { points: 0, conditions: [conditionOptions[0][0]] },
      index
    ).trim();

    const created = temp.firstElementChild;
    if (!created) {
      console.error('Não foi possível criar a nova regra de pontuação.');
      return;
    }

    builder.appendChild(created);
    bindRule(created);
    refreshRuleNumbers();
  });

  document.getElementById('scoring-rules-form')?.addEventListener('submit', saveScoringRules);
}

async function saveScoringRules(e) {
  e.preventDefault();
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  const builder = document.getElementById('match-rules-builder');

  const matchRules = [...builder.querySelectorAll('.scoring-builder-rule')].map(ruleEl => {
    const conditions = [...ruleEl.querySelectorAll('.sr-rule-condition')]

      .map(select => select.value)
      .filter(Boolean);

    return {
      points: Math.max(0, Number(ruleEl.querySelector('.sr-rule-points')?.value || 0)),
      conditions: [...new Set(conditions)].filter(condition => condition !== 'qualifier')
    };
  }).filter(rule => rule.points > 0 && rule.conditions.length > 0);

  const groupQualificationRules = [...(document.getElementById('group-qualification-rules-builder')?.querySelectorAll('.group-qualification-rule') || [])]
    .map(ruleEl => ({
      points: Math.max(0, Number(ruleEl.querySelector('.gqr-rule-points')?.value || 0)),
      conditions: [...new Set(
        [...ruleEl.querySelectorAll('.gqr-rule-condition')].map(select => select.value).filter(Boolean)
      )]
    }))
    .filter(rule => rule.points > 0 && rule.conditions.length > 0);

  const groupQualification = CurrentSettings.championshipRules?.groupQualification || {};
  const validGroupQualificationConfig =
    Number(groupQualification.totalTeams) > 0 &&
    Number(groupQualification.groupCount) > 0 &&
    Number(groupQualification.totalQualified) > 0 &&
    Number(groupQualification.totalTeams) % Number(groupQualification.groupCount) === 0 &&
    Number(groupQualification.totalQualified) <= Number(groupQualification.totalTeams);

  const qualificationStatusRules = groupQualificationRules.some(rule =>
    rule.conditions.includes('teamQualified') ||
    rule.conditions.includes('teamNotQualified')
  );

  if (qualificationStatusRules && (
    CurrentSettings.championshipRules?.hasGroupPhase === false ||
    CurrentSettings.championshipRules?.hasKnockoutPhase !== true ||
    !validGroupQualificationConfig
  )) {
    toast(
      '“Time classificado” e “Time não classificado” exigem fase de grupos + mata-mata e uma estrutura de grupos válida.',
      'error'
    );
    return;
  }

  const scoringRules = {
    // Mantém as configurações atuais, mas Classificado pertence exclusivamente a matchExtras.
    ...(CurrentSettings.scoringRules || {}),
    matchRules: matchRules.filter(rule =>
      !rule.conditions.includes('qualifier')
    ),
    matchExtras: {
      qualifier: Math.max(
        0,
        Number(document.getElementById('sr-match-extra-qualifier')?.value || 0)
      )
    },
    groupQualificationRules,
    podiumPoints: Array.from({ length: getConfiguredPodiumSize() }, (_, index) =>
      Number(document.getElementById(`sr-podium-${index}`)?.value || 0)
    ),
    topScorer: Number(document.getElementById('sr-topScorer').value) || 0,
    bestAttack: Number(document.getElementById('sr-bestAttack').value) || 0,
    worstDefense: Number(document.getElementById('sr-worstDefense').value) || 0,
    upset: Number(document.getElementById('sr-upset').value) || 0
  };

  try {
    const res = await api.post('/api/settings/global', {
      leagueId,
      scoringRules,
      // A pontuação é consequência da estrutura definida no campeonato.
      championshipRules: CurrentSettings.championshipRules || {}
    });

    if (!res?.success) throw new Error(res?.message || 'Erro ao salvar');

    CurrentSettings.scoringRules = res.data?.scoringRules || scoringRules;
    toast('Regras de pontuação salvas!', 'success');
    closeModal('scoring-rules-modal');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar regras', 'error');
  }
}

/* ============================================================
   🆕 MODAL — REGRAS DO CAMPEONATO (CHAMPIONSHIP RULES)
   ============================================================ */

async function openChampionshipRulesModal() {
  const old = document.getElementById('championship-rules-modal');
  if (old) old.remove();

  const cr = {
    ...DEFAULT_CHAMPIONSHIP_RULES,
    ...(CurrentSettings.championshipRules || {})
  };

  const prize = {
    positions: 0,
    totalAmount: 0,
    distribution: [],
    ...(CurrentSettings.prizeZone || {})
  };

  const ranking = CurrentSettings.rankingRules || { tieBreakers: [] };
  const sr = CurrentSettings.scoringRules || DEFAULT_SCORING;

  const getAvailableTieBreakers = () => {
    const knockoutEnabled =
      document.getElementById('cr-hasKnockoutPhase')?.checked ??
      (cr.hasKnockoutPhase === true);

    return [
      {
        value: 'exactScorePoints',
        label: 'Maior pontuação em placar exato',
        available: Number(sr.exactScore || 0) > 0
      },
      {
        value: 'podiumPoints',
        label: 'Maior pontuação em pódio',
        available: Array.isArray(sr.podiumPoints) &&
          sr.podiumPoints.some(value => Number(value) > 0)
      },
      {
        value: 'extraPoints',
        label: 'Maior pontuação em Extras',
        available: [
          'topScorer',
          'bestAttack',
          'worstDefense',
          'upset'
        ].some(key => Number(sr[key] || 0) > 0)
      },
      {
        value: 'knockoutPoints',
        label: 'Maior pontuação em mata-mata',
        available: knockoutEnabled
      }
    ].filter(item => item.available);
  };

  const selectedTieBreakers = Array.isArray(ranking.tieBreakers)
    ? ranking.tieBreakers.filter(value =>
        getAvailableTieBreakers().some(item => item.value === value)
      ).slice(0, 3)
    : [];

  const distributionMap = new Map(
    (Array.isArray(prize.distribution) ? prize.distribution : [])
      .map(item => [
        Number(item.position),
        Number(item.percentage || 0)
      ])
  );

  const html = `
    <div id="championship-rules-modal" class="modal active">
      <div class="modal-content" style="max-width: 560px;">
        <div class="modal-header">
          <h3>🏆 Regras do Campeonato</h3>
          <button class="close-modal" onclick="closeModal('championship-rules-modal')">&times;</button>
        </div>

        <form id="championship-rules-form"
              style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">⚽ Estrutura do Campeonato</h4>

            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="cr-hasGroupPhase" ${cr.hasGroupPhase !== false ? 'checked' : ''}>
              <strong>Este campeonato possui fase de grupos</strong>
            </label>

            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px;">
              <input type="checkbox" id="cr-hasKnockoutPhase" ${cr.hasKnockoutPhase ? 'checked' : ''}>
              <strong>Este campeonato possui fase de mata-mata</strong>
            </label>
            <small style="display:block; margin-top:5px; color:#888;">
              Se nenhuma das duas fases existir, o campeonato será tratado automaticamente como <strong>pontos corridos</strong>.
            </small>

            <div id="cr-group-structure-panel" style="margin-top:14px; padding:10px; border-radius:9px; border:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.12);">
              <strong style="display:block; color:#ffda44; margin-bottom:8px;">📊 Estrutura da fase de grupos</strong>
              <small style="display:block; color:#888; margin-bottom:10px;">
                Informe os valores reais deste campeonato.
              </small>
              <div class="form-row">
                <div class="form-group">
                  <label>Total de times</label>
                  <input type="number" id="cr-totalTeams"
                         value="${Number(cr.groupQualification?.totalTeams) || 0}"
                         min="0" step="1" placeholder="Ex.: 48">
                </div>
                <div class="form-group">
                  <label>Número de grupos</label>
                  <input type="number" id="cr-groupCount"
                         value="${Number(cr.groupQualification?.groupCount) || 0}"
                         min="0" step="1" placeholder="Ex.: 12">
                </div>
                <div class="form-group" id="cr-totalQualified-group" style="${cr.hasKnockoutPhase ? '' : 'display:none;'}">
                  <label>Classificados para o mata-mata</label>
                  <input type="number" id="cr-totalQualified"
                         value="${Number(cr.groupQualification?.totalQualified) || 0}"
                         min="0" step="1" placeholder="Ex.: 32">
                </div>
              </div>

              <div class="form-group" style="margin-top:10px;">
                <label>Confrontos entre os times</label>
                <select id="cr-group-legs">
                  <option value="1" ${Number(cr.groupQualification?.legs || 1) === 1 ? 'selected' : ''}>
                    Turno único — cada time enfrenta os outros 1 vez
                  </option>
                  <option value="2" ${Number(cr.groupQualification?.legs || 1) === 2 ? 'selected' : ''}>
                    Turno e returno — cada time enfrenta os outros 2 vezes
                  </option>
                </select>
                <small style="display:block; margin-top:5px; color:#888;">
                  Usado para determinar dinamicamente quando cada grupo termina.
                </small>
              </div>

              <div id="cr-group-qualification-summary" style="font-size:.78rem; color:#aaa; margin-top:6px;"></div>
            </div>

            <div id="cr-knockout-structure-panel" style="margin-top:14px; padding:10px; border-radius:9px; border:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.12);">
              <strong style="display:block; color:#ffda44; margin-bottom:8px;">🏆 Estrutura do mata-mata</strong>
              <div class="form-group">
                <label>Formato dos confrontos</label>
                <select id="cr-knockout-format">
                  <option value="single" ${cr.knockoutFormat !== 'home_away' ? 'selected' : ''}>Jogo único</option>
                  <option value="home_away" ${cr.knockoutFormat === 'home_away' ? 'selected' : ''}>Ida e volta</option>
                </select>
              </div>
              <div id="cr-knockout-away-goals-wrap" style="margin-top:10px; ${cr.knockoutFormat === 'home_away' ? '' : 'display:none;'}">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                  <input type="checkbox" id="cr-knockout-away-goals" ${cr.knockoutAwayGoals ? 'checked' : ''}>
                  <span>Utilizar critério de gol fora de casa</span>
                </label>
                <small style="display:block; margin-top:5px; color:#888;">Usado somente se o agregado terminar empatado.</small>
              </div>
              <small style="display:block; margin-top:8px; color:#888;">Em ida e volta, o palpite de classificado pertence ao confronto e vale uma única vez.</small>
            </div>

            <div id="cr-championship-type" style="margin-top:12px; padding:9px 10px; border-radius:8px; background:rgba(0,102,179,.12); border:1px solid rgba(0,102,179,.25); font-size:.86rem;"></div>
          </div>

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">⚙️ Configurações do Campeonato</h4>

            <div class="form-group">
              <label>Tamanho do Pódio</label>
              <select id="cr-podiumSize">
                <option value="4" ${Number(cr.podiumSize) === 4 ? 'selected' : ''}>4 posições (1º ao 4º)</option>
                <option value="3" ${Number(cr.podiumSize) === 3 ? 'selected' : ''}>3 posições (1º ao 3º)</option>
                <option value="2" ${Number(cr.podiumSize) === 2 ? 'selected' : ''}>2 posições (1º e 2º)</option>
                <option value="1" ${Number(cr.podiumSize) === 1 ? 'selected' : ''}>1 posição (somente 1º)</option>
              </select>
            </div>

            <div style="margin-top:12px;">
              <label style="display:block; margin-bottom:7px; font-weight:600;">Período considerado na validação dos palpites</label>
              <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer; margin-bottom:6px;">
                <input type="radio" name="cr-bet-validation-period" value="90" ${!cr.drawIncludesExtraTime ? 'checked' : ''}>
                <span>90 minutos (tempo regulamentar)</span>
              </label>
              <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
                <input type="radio" name="cr-bet-validation-period" value="extra" ${cr.drawIncludesExtraTime ? 'checked' : ''}>
                <span>Após a prorrogação</span>
              </label>
              <small style="display:block; margin-top:6px; color:#888;">Define qual período será usado para validar o resultado e o placar do palpite.</small>
            </div>

            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:12px;">
              <input type="checkbox" id="cr-winnerFromScore" ${cr.winnerFromScore !== false ? 'checked' : ''}>
              <span>Vencedor deriva do placar</span>
            </label>
          </div>

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">💰 Pagamento / PIX</h4>
            <small style="display:block; color:#888; margin-bottom:10px;">
              Configure o pagamento deste campeonato. O QR Code e a chave PIX são exclusivos desta liga.
            </small>

            <div class="form-group">
              <label>Chave PIX</label>
              <input type="text" id="cr-pixKey"
                     value="${String(CurrentSettings.payment?.pixKey || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}"
                     maxlength="200" placeholder="Digite a chave PIX">
            </div>

            <div style="margin-top:12px;">
              <label style="display:block; margin-bottom:7px; font-weight:600;">QR Code PIX</label>
              <div id="cr-pix-preview"
                   style="min-height:150px; display:flex; align-items:center; justify-content:center; border:1px dashed rgba(255,255,255,.18); border-radius:8px; padding:10px; background:rgba(0,0,0,.12);">
                ${CurrentSettings.payment?.pixQrCode
                  ? `<img src="${CurrentSettings.payment.pixQrCode}" alt="QR Code PIX" style="max-width:180px; max-height:180px; object-fit:contain;">`
                  : '<span style="color:#888;">Nenhum QR Code configurado</span>'}
              </div>

              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:9px;">
                <label class="btn btn-outline-secondary" style="margin:0; cursor:pointer;">
                  📷 Tirar foto
                  <input type="file" id="cr-pix-camera" accept="image/*" capture="environment" style="display:none;">
                </label>
                <label class="btn btn-outline-secondary" style="margin:0; cursor:pointer;">
                  🖼️ Enviar imagem
                  <input type="file" id="cr-pix-upload" accept="image/png,image/jpeg,image/webp" style="display:none;">
                </label>
                <button type="button" id="cr-pix-clear" class="btn btn-outline-danger" style="display:${CurrentSettings.payment?.pixQrCode ? '' : 'none'};">
                  Remover QR
                </button>
              </div>
              <small style="display:block; margin-top:7px; color:#888;">
                A imagem será redimensionada antes de ser armazenada no campeonato.
              </small>
            </div>
          </div>

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">🏆 Zona de Premiação</h4>

            <div class="form-row">
              <div class="form-group">
                <label>Número de posições premiadas</label>
                <input type="number" id="pz-positions"
                       value="${Number(prize.positions) || 0}"
                       min="0" max="50" step="1">
              </div>

              <div class="form-group">
                <label>Valor total da premiação</label>
                <input type="number" id="pz-totalAmount"
                       value="${Number(prize.totalAmount) || 0}"
                       min="0" step="0.01" placeholder="0,00">
              </div>
            </div>

            <div id="pz-distribution" style="display:flex; flex-direction:column; gap:7px; margin-top:8px;"></div>
            <div id="pz-distribution-total" style="font-size:.78rem; margin-top:7px; color:#aaa;"></div>
          </div>

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">⚖️ Critérios de Desempate</h4>

            <div class="form-group">
              <label>Número de critérios de desempate</label>
              <select id="tr-count">
                <option value="0" ${selectedTieBreakers.length === 0 ? 'selected' : ''}>0 — nenhum</option>
                <option value="1" ${selectedTieBreakers.length === 1 ? 'selected' : ''}>1 critério</option>
                <option value="2" ${selectedTieBreakers.length === 2 ? 'selected' : ''}>2 critérios</option>
                <option value="3" ${selectedTieBreakers.length === 3 ? 'selected' : ''}>3 critérios</option>
              </select>
            </div>

            <div id="tr-selects" style="display:flex; flex-direction:column; gap:8px;"></div>
            <small style="display:block; margin-top:7px; color:#888;">
              A ordem define a prioridade: o 1º critério é mais importante que o 2º, e assim por diante.
              Se todos os critérios empatarem, o empate permanece.
            </small>
          </div>

          <button type="submit" class="btn btn-success" style="width:100%;">
            <i class="fas fa-save"></i> Salvar Regras do Campeonato
          </button>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);

  const updateChampionshipType = () => {
    const hasGroupPhase = document.getElementById('cr-hasGroupPhase')?.checked === true;
    const hasKnockoutPhase = document.getElementById('cr-hasKnockoutPhase')?.checked === true;
    const target = document.getElementById('cr-championship-type');
    if (!target) return;

    let label = '🏁 Tipo do campeonato: <strong>Pontos corridos</strong>';
    if (hasGroupPhase && hasKnockoutPhase) {
      label = '🏆 Tipo do campeonato: <strong>Grupos + Mata-mata</strong>';
    } else if (hasGroupPhase) {
      label = '⚽ Tipo do campeonato: <strong>Fase de grupos</strong>';
    } else if (hasKnockoutPhase) {
      label = '🥊 Tipo do campeonato: <strong>Mata-mata</strong>';
    }
    target.innerHTML = label;
  };

  const updateGroupQualificationSummary = () => {
    const hasGroupPhase = document.getElementById('cr-hasGroupPhase')?.checked === true;
    const hasKnockoutPhase = document.getElementById('cr-hasKnockoutPhase')?.checked === true;
    const panel = document.getElementById('cr-group-structure-panel');
    const qualifiedGroup = document.getElementById('cr-totalQualified-group');
    const target = document.getElementById('cr-group-qualification-summary');

    if (panel) panel.style.display = hasGroupPhase ? '' : 'none';
    if (qualifiedGroup) qualifiedGroup.style.display = hasGroupPhase && hasKnockoutPhase ? '' : 'none';

    if (!hasGroupPhase) {
      if (target) target.textContent = hasKnockoutPhase
        ? 'Este campeonato possui somente fase de mata-mata.'
        : 'Nenhuma fase de grupos ou mata-mata: o campeonato será tratado como pontos corridos.';
      return;
    }

    const total = Number(document.getElementById('cr-totalTeams')?.value || 0);
    const groups = Number(document.getElementById('cr-groupCount')?.value || 0);
    const qualified = Number(document.getElementById('cr-totalQualified')?.value || 0);
    const legs = Number(document.getElementById('cr-group-legs')?.value || 1) === 2 ? 2 : 1;

    if (!total || !groups || (hasKnockoutPhase && !qualified)) {
      if (target) target.textContent = hasKnockoutPhase
        ? 'Preencha total de times, número de grupos e classificados para o mata-mata.'
        : 'Preencha total de times e número de grupos.';
      return;
    }
    if (total % groups !== 0) {
      target.textContent = '⚠️ O total de times deve ser divisível pelo número de grupos.';
      return;
    }
    if (hasKnockoutPhase && qualified > total) {
      target.textContent = '⚠️ O número de classificados não pode ser maior que o total de times.';
      return;
    }

    if (!hasKnockoutPhase) {
      const teamsPerGroup = total / groups;
      const expected = teamsPerGroup >= 2
        ? (teamsPerGroup * (teamsPerGroup - 1) / 2) * legs
        : 0;
      target.textContent =
        `${teamsPerGroup} times por grupo • ${legs === 2 ? 'turno e returno' : 'turno único'} • ` +
        `${expected} partidas por grupo • fase de grupos sem mata-mata.`;
      return;
    }

    const teamsPerGroup = total / groups;
    const direct = Math.floor(qualified / groups);
    const additional = qualified % groups;
    if (direct > teamsPerGroup || (additional > 0 && direct >= teamsPerGroup)) {
      target.textContent = '⚠️ Essa configuração não permite distribuir os classificados entre os grupos.';
      return;
    }
    const extraPosition = additional > 0 ? direct + 1 : null;
    const expected = teamsPerGroup >= 2
      ? (teamsPerGroup * (teamsPerGroup - 1) / 2) * legs
      : 0;
    target.textContent =
      `${teamsPerGroup} times por grupo • ${legs === 2 ? 'turno e returno' : 'turno único'} • ` +
      `${expected} partidas por grupo • ${direct} classificados por grupo` +
      (additional > 0
        ? ` • ${additional} classificados adicionais entre os ${extraPosition}º colocados`
        : ' • sem classificados adicionais');
  };
  ['cr-totalTeams','cr-groupCount','cr-totalQualified','cr-group-legs'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateGroupQualificationSummary);
  });
  updateGroupQualificationSummary();
  updateChampionshipType();

  const distribution = document.getElementById('pz-distribution');
  const distributionTotal = document.getElementById('pz-distribution-total');

  function renderDistribution() {
    const count = Math.max(
      0,
      Math.min(50, Number(document.getElementById('pz-positions')?.value || 0))
    );

    const oldValues = Array.from(
      distribution.querySelectorAll('input[data-prize-position]')
    ).map(input => [
      Number(input.dataset.prizePosition),
      input.value
    ]);

    const oldMap = new Map(oldValues);
    distribution.innerHTML = '';

    for (let i = 1; i <= count; i++) {
      const value =
        oldMap.get(i) ??
        distributionMap.get(i) ??
        '';

      distribution.insertAdjacentHTML('beforeend', `
        <div style="display:flex; align-items:center; gap:8px;">
          <strong style="width:38px;">${i}º</strong>
          <input type="number"
                 data-prize-position="${i}"
                 min="0" max="100" step="0.01"
                 value="${value}"
                 placeholder="%"
                 style="flex:1;">
          <span style="font-size:.78rem; color:#888;">%</span>
        </div>
      `);
    }

    updateDistributionTotal();
  }

  function updateDistributionTotal() {
    const values = Array.from(
      distribution.querySelectorAll('input[data-prize-position]')
    ).map(input => Number(input.value || 0));

    const total = values.reduce((sum, value) => sum + value, 0);
    distributionTotal.textContent =
      `Total dos percentuais: ${total.toFixed(2)}%` +
      (values.length && Math.abs(total - 100) < 0.001 ? ' ✅' : '');
    distributionTotal.style.color =
      !values.length || Math.abs(total - 100) < 0.001
        ? '#70e090'
        : '#ff8a8a';
  }

  function renderTieBreakers() {
    const container = document.getElementById('tr-selects');
    const count = Number(document.getElementById('tr-count').value || 0);
    const current = Array.from(
      container.querySelectorAll('select[data-tie-index]')
    ).map(select => select.value);

    const selected = current.length ? current : selectedTieBreakers;
    container.innerHTML = '';

    for (let i = 0; i < count; i++) {
      const previous = selected[i] || '';
      const criteria = getAvailableTieBreakers();
      const options = criteria.map(item => `
        <option value="${item.value}" ${item.value === previous ? 'selected' : ''}>
          ${item.label}
        </option>
      `).join('');

      container.insertAdjacentHTML('beforeend', `
        <div>
          <label style="font-size:.8rem;">${i + 1}º critério</label>
          <select data-tie-index="${i}" style="width:100%;">
            <option value="">Selecione...</option>
            ${options}
          </select>
        </div>
      `);
    }

    container.querySelectorAll('select[data-tie-index]').forEach(select => {
      select.addEventListener('change', () => {
        const all = Array.from(
          container.querySelectorAll('select[data-tie-index]')
        ).map(s => s.value).filter(Boolean);

        container.querySelectorAll('select[data-tie-index]').forEach((currentSelect, index) => {
          const usedByOthers = new Set(
            all.filter((value, otherIndex) => otherIndex !== index)
          );

          Array.from(currentSelect.options).forEach(option => {
            if (!option.value) return;
            option.disabled = usedByOthers.has(option.value);
          });
        });
      });
    });
  }

  document.getElementById('pz-positions').addEventListener('input', renderDistribution);
  distribution.addEventListener('input', updateDistributionTotal);
  document.getElementById('tr-count').addEventListener('change', renderTieBreakers);

  const groupCheckbox = document.getElementById('cr-hasGroupPhase');
  const knockoutCheckbox = document.getElementById('cr-hasKnockoutPhase');
  const knockoutFormatSelect = document.getElementById('cr-knockout-format');
  const knockoutStructurePanel = document.getElementById('cr-knockout-structure-panel');
  const knockoutAwayGoalsWrap = document.getElementById('cr-knockout-away-goals-wrap');
  const syncKnockoutFormatUI = () => {
    const enabled = knockoutCheckbox?.checked === true;
    const homeAway = enabled && knockoutFormatSelect?.value === 'home_away';

    // A estrutura do mata-mata só existe quando o campeonato possui mata-mata.
    // Não basta esconder apenas o critério de gol fora: todo o painel deve desaparecer.
    if (knockoutStructurePanel) {
      knockoutStructurePanel.style.display = enabled ? '' : 'none';
    }
    if (knockoutAwayGoalsWrap) {
      knockoutAwayGoalsWrap.style.display = homeAway ? '' : 'none';
    }
  };
  knockoutFormatSelect?.addEventListener('change', syncKnockoutFormatUI);
  const groupLegsSelect = document.getElementById('cr-group-legs');

  groupLegsSelect?.addEventListener('change', () => {
    updateGroupQualificationSummary();
  });

  groupCheckbox?.addEventListener('change', () => {
    updateGroupQualificationSummary();
    updateChampionshipType();
    renderTieBreakers();
  });

  knockoutCheckbox?.addEventListener('change', () => {
    syncKnockoutFormatUI();
    updateChampionshipType();
    const container = document.getElementById('tr-selects');
    const current = Array.from(
      container?.querySelectorAll('select[data-tie-index]') || []
    ).map(select => select.value);

    // Se o mata-mata foi desativado, remove o critério que deixou de existir.
    if (!knockoutCheckbox.checked && current.includes('knockoutPoints')) {
      container.querySelectorAll('select[data-tie-index]').forEach(select => {
        if (select.value === 'knockoutPoints') select.value = '';
      });
    }

    updateGroupQualificationSummary();
    renderTieBreakers();
  });

  renderDistribution();
  updateGroupQualificationSummary();
  renderTieBreakers();
  syncKnockoutFormatUI();

  // 📷 QR Code: permite câmera/upload e redimensiona a imagem antes do armazenamento.
  paymentQrCode = String(CurrentSettings.payment?.pixQrCode || '');
  const pixPreview = document.getElementById('cr-pix-preview');
  const pixClear = document.getElementById('cr-pix-clear');

  const renderPixPreview = () => {
    if (!pixPreview) return;
    pixPreview.innerHTML = paymentQrCode
      ? `<img src="${paymentQrCode}" alt="QR Code PIX" style="max-width:180px; max-height:180px; object-fit:contain;">`
      : '<span style="color:#888;">Nenhum QR Code configurado</span>';
    if (pixClear) pixClear.style.display = paymentQrCode ? '' : 'none';
  };

  const processPixImage = file => new Promise((resolve, reject) => {
    if (!file) return resolve('');
    if (!file.type || !file.type.startsWith('image/')) {
      return reject(new Error('Selecione uma imagem válida para o QR Code.'));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Não foi possível processar a imagem.'));
      img.onload = () => {
        const maxSize = 800;
        const sourceW = img.naturalWidth || img.width;
        const sourceH = img.naturalHeight || img.height;
        const scale = Math.min(1, maxSize / Math.max(sourceW, sourceH));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceW * scale));
        canvas.height = Math.max(1, Math.round(sourceH * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return reject(new Error('Seu navegador não suporta processamento de imagens.'));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > 1500000) {
          return reject(new Error('A imagem do QR Code continua muito grande. Use uma imagem menor.'));
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const handlePixFile = async file => {
    try {
      paymentQrCode = await processPixImage(file);
      renderPixPreview();
      toast('QR Code carregado. Clique em salvar para gravar.', 'success');
    } catch (err) {
      toast(err.message || 'Erro ao carregar QR Code.', 'error');
    }
  };

  document.getElementById('cr-pix-camera')?.addEventListener('change', e => {
    handlePixFile(e.target.files?.[0]);
    e.target.value = '';
  });
  document.getElementById('cr-pix-upload')?.addEventListener('change', e => {
    handlePixFile(e.target.files?.[0]);
    e.target.value = '';
  });
  pixClear?.addEventListener('click', () => {
    paymentQrCode = '';
    renderPixPreview();
  });

  document.getElementById('championship-rules-form')
    .addEventListener('submit', saveChampionshipRules);
}

async function saveChampionshipRules(e) {
  e.preventDefault();

  const leagueId = localStorage.getItem('selectedLeagueId') || '1';

  const positions = Math.max(
    0,
    Math.floor(Number(document.getElementById('pz-positions')?.value || 0))
  );

  const totalAmount = Math.max(
    0,
    Number(document.getElementById('pz-totalAmount')?.value || 0)
  );

  const distribution = positions === 0
    ? []
    : Array.from(
        document.querySelectorAll('#pz-distribution input[data-prize-position]')
      ).map(input => ({
        position: Number(input.dataset.prizePosition),
        percentage: Number(input.value || 0)
      }));

  if (positions > 0) {
    const totalPercentage = distribution.reduce(
      (sum, item) => sum + item.percentage,
      0
    );

    if (distribution.length !== positions) {
      toast('Defina o percentual de todas as posições premiadas.', 'error');
      return;
    }

    if (Math.abs(totalPercentage - 100) > 0.001) {
      toast('A soma dos percentuais da premiação deve ser 100%.', 'error');
      return;
    }
  }

  const tieBreakers = Array.from(
    document.querySelectorAll('#tr-selects select[data-tie-index]')
  ).map(select => select.value).filter(Boolean);

  if (new Set(tieBreakers).size !== tieBreakers.length) {
    toast('Não é permitido repetir um critério de desempate.', 'error');
    return;
  }

  const hasGroupPhase = document.getElementById('cr-hasGroupPhase')?.checked === true;
  const hasKnockoutPhase = document.getElementById('cr-hasKnockoutPhase')?.checked === true;
  const totalTeams = hasGroupPhase ? Math.floor(Number(document.getElementById('cr-totalTeams')?.value || 0)) : 0;
  const groupCount = hasGroupPhase ? Math.floor(Number(document.getElementById('cr-groupCount')?.value || 0)) : 0;
  const totalQualified = hasGroupPhase && hasKnockoutPhase ? Math.floor(Number(document.getElementById('cr-totalQualified')?.value || 0)) : 0;
  const groupLegs = hasGroupPhase
    ? (Number(document.getElementById('cr-group-legs')?.value || 1) === 2 ? 2 : 1)
    : 1;

  if (hasGroupPhase) {
    if (!totalTeams || !groupCount) {
      toast('Informe total de times e número de grupos.', 'error');
      return;
    }
    if (totalTeams % groupCount !== 0) {
      toast('O número de times deve ser divisível pelo número de grupos.', 'error');
      return;
    }
    if (hasKnockoutPhase) {
      if (!totalQualified) {
        toast('Informe o número de classificados para o mata-mata.', 'error');
        return;
      }
      if (totalQualified > totalTeams) {
        toast('O número de classificados não pode ser maior que o número de times.', 'error');
        return;
      }
    }
  }

  const payload = {
    leagueId,
    championshipRules: {
      drawIncludesExtraTime:
        document.querySelector('input[name="cr-bet-validation-period"]:checked')?.value === 'extra',
      winnerFromScore:
        document.getElementById('cr-winnerFromScore').checked,
      podiumSize:
        Number(document.getElementById('cr-podiumSize').value) || 4,
      hasGroupPhase,
      hasKnockoutPhase,
      knockoutFormat: hasKnockoutPhase && document.getElementById('cr-knockout-format')?.value === 'home_away' ? 'home_away' : 'single',
      knockoutAwayGoals: hasKnockoutPhase && document.getElementById('cr-knockout-format')?.value === 'home_away' && document.getElementById('cr-knockout-away-goals')?.checked === true,
      groupQualification: {
        totalTeams,
        groupCount,
        totalQualified,
        legs: groupLegs
      }
    },
    prizeZone: {
      positions,
      totalAmount,
      distribution
    },
    rankingRules: {
      tieBreakers
    },
    pixKey: String(document.getElementById('cr-pixKey')?.value || '').trim(),
    pixQrCode: paymentQrCode
  };

  try {
    const res = await api.post('/api/settings/global', payload);
    if (!res?.success) {
      throw new Error(res?.message || 'Erro ao salvar');
    }

    CurrentSettings.championshipRules = {
      ...CurrentSettings.championshipRules,
      ...payload.championshipRules,
      hasGroupPhase
    };
    CurrentSettings.prizeZone = payload.prizeZone;
    CurrentSettings.rankingRules = payload.rankingRules;
    CurrentSettings.payment = {
      pixKey: payload.pixKey,
      pixQrCode: payload.pixQrCode
    };

    toast('Regras do campeonato salvas!', 'success');
    closeModal('championship-rules-modal');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar regras', 'error');
  }
}

/* ============================================================
   🆕 MODAL — RESULTADOS OFICIAIS (CHAMPIONSHIP RESULTS / EXTRAS)
   ============================================================ */

async function openChampionshipResultsModal() {
  const old = document.getElementById('championship-results-modal');
  if (old) old.remove();

  const sr = CurrentSettings.scoringRules || { ...DEFAULT_SCORING };
  const cr = CurrentSettings.championshipResults || {};

  // Só mostra campos que têm pontuação > 0
  const showTopScorer    = (sr.topScorer || 0) > 0;
  const showBestAttack   = (sr.bestAttack || 0) > 0;
  const showWorstDefense = (sr.worstDefense || 0) > 0;
  const showUpset        = (sr.upset || 0) > 0;

  const allMatches = AdminState.matches || [];
  const teams = [...new Set(allMatches.flatMap(m => [m.teamA, m.teamB]))].sort();
  const teamOptions = teams.map(t => `<option value="${t}">${withFlag(t)}</option>`).join('');

  let fieldsHtml = '';

  if (showTopScorer) {
    fieldsHtml += `
      <div class="form-group">
        <label>⚽ Artilheiro Oficial <span style="color:#ffda44;">(${sr.topScorer} pts)</span></label>
        <input type="text" id="cr-res-topScorer" value="${cr.topScorer || ''}" placeholder="Nome do artilheiro">
      </div>`;
  }
  if (showBestAttack) {
    fieldsHtml += `
      <div class="form-group">
        <label>🔥 Melhor Ataque Oficial <span style="color:#ffda44;">(${sr.bestAttack} pts)</span></label>
        <select id="cr-res-bestAttack"><option value="">Selecione...</option>${teamOptions}</select>
      </div>`;
  }
  if (showWorstDefense) {
    fieldsHtml += `
      <div class="form-group">
        <label>🥅 Pior Defesa Oficial <span style="color:#ffda44;">(${sr.worstDefense} pts)</span></label>
        <select id="cr-res-worstDefense"><option value="">Selecione...</option>${teamOptions}</select>
      </div>`;
  }
  if (showUpset) {
    fieldsHtml += `
      <div class="form-group">
        <label>🦓 Zebra Oficial <span style="color:#ffda44;">(${sr.upset} pts)</span></label>
        <input type="text" id="cr-res-upset" value="${cr.upset || ''}" placeholder="Descreva a maior zebra">
      </div>`;
  }

  if (!fieldsHtml) {
    fieldsHtml = '<p style="text-align:center; color:#888;">Nenhuma categoria de extra está ativa. Defina pontuação > 0 nas Regras de Pontuação primeiro.</p>';
  }

  const html = `
    <div id="championship-results-modal" class="modal active">
      <div class="modal-content" style="max-width: 460px;">
        <div class="modal-header">
          <h3>🏅 Resultados Oficiais (Extras)</h3>
          <button class="close-modal" onclick="closeModal('championship-results-modal')">&times;</button>
        </div>
        <form id="championship-results-form" style="display:flex; flex-direction:column; gap:12px; margin-top:10px;">
          ${fieldsHtml}
          <button type="submit" class="btn btn-success" style="width:100%; margin-top:8px;">
            <i class="fas fa-save"></i> Salvar Resultados Oficiais
          </button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  // Preenche selects com valor salvo
  if (showBestAttack && cr.bestAttack) {
    const sel = document.getElementById('cr-res-bestAttack');
    if (sel) sel.value = cr.bestAttack;
  }
  if (showWorstDefense && cr.worstDefense) {
    const sel = document.getElementById('cr-res-worstDefense');
    if (sel) sel.value = cr.worstDefense;
  }

  document.getElementById('championship-results-form').addEventListener('submit', saveChampionshipResults);
}

async function saveChampionshipResults(e) {
  e.preventDefault();
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';

  const sr = CurrentSettings.scoringRules || { ...DEFAULT_SCORING };
  const results = {};

  if ((sr.topScorer || 0) > 0) {
    const val = document.getElementById('cr-res-topScorer')?.value?.trim();
    if (val) results.topScorer = val;
  }
  if ((sr.bestAttack || 0) > 0) {
    const val = document.getElementById('cr-res-bestAttack')?.value;
    if (val) results.bestAttack = val;
  }
  if ((sr.worstDefense || 0) > 0) {
    const val = document.getElementById('cr-res-worstDefense')?.value;
    if (val) results.worstDefense = val;
  }
  if ((sr.upset || 0) > 0) {
    const val = document.getElementById('cr-res-upset')?.value?.trim();
    if (val) results.upset = val;
  }

  const payload = { leagueId, championshipResults: results };

  try {
    const res = await api.post('/api/settings/global', payload);
    if (!res?.success) throw new Error(res?.message || 'Erro ao salvar');

    CurrentSettings.championshipResults = results;
    toast('Resultados oficiais salvos!', 'success');
    closeModal('championship-results-modal');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar resultados', 'error');
  }
}

// =============== BLOQUEIO SIMPLES DE SALVAR PALPITES (frontend-only) ===============
const SAVE_LOCK_KEYS = {
  bets: 'bolao_block_save_bets',
  knockout: 'bolao_block_save_knockout',
  requireAll: 'bolao_require_all_group_bets',
};

let GLOBAL_SAVE_LOCKS = {
  blockSaveBets: false,
  blockSaveKnockout: false,
  requireAllBets: false,
  testMode: false
};

export async function loadGlobalSaveLocks() {
  try {
    const leagueId = localStorage.getItem('selectedLeagueId') || '1';
    const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
    if (res && res.success && res.data) {
      GLOBAL_SAVE_LOCKS = { ...GLOBAL_SAVE_LOCKS, ...res.data };
      refreshTestModeUI();
    }
  } catch (e) {
    console.warn('Não foi possível carregar configurações globais', e);
  }
}


async function toggleLeagueTestMode() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  const currentlyEnabled = GLOBAL_SAVE_LOCKS.testMode === true;
  const enabled = !currentlyEnabled;

  if (enabled) {
    const confirmed = window.confirm(
      'ATIVAR MODO DE TESTE?\n\n' +
      'Isso permitirá editar regras após o início do campeonato e fazer apostas em partidas já iniciadas ou finalizadas.\n\n' +
      'As travas atuais serão guardadas para restauração quando o modo for encerrado.'
    );
    if (!confirmed) return;
  } else {
    const confirmed = window.confirm(
      'ENCERRAR MODO DE TESTE?\n\n' +
      'A configuração anterior da liga será restaurada.'
    );
    if (!confirmed) return;
  }

  try {
    const res = await api.post('/api/settings/test-mode', {
      leagueId,
      enabled
    });

    if (!res?.success) {
      throw new Error(res?.message || 'Não foi possível alterar o modo de teste.');
    }

    GLOBAL_SAVE_LOCKS = {
      ...GLOBAL_SAVE_LOCKS,
      ...(res.data || {}),
      testMode: Boolean(res.testMode)
    };

    // Atualiza o estado do frontend de partidas imediatamente.
    if (window.STATE) {
      window.STATE.testMode = Boolean(res.testMode);
      window.STATE.lockedPhases = new Set(res.data?.lockedPhases || []);
      window.STATE.unlockedPhases = new Set(res.data?.unlockedPhases || []);
      window.STATE.betLockMode =
        res.data?.betLockMode === 'match' ? 'match' : 'grade';
    }

    // Se a página já estiver aberta, a rotina de salvar do app passa a
    // enxergar os bloqueios restaurados/liberados sem precisar relogar.
    GLOBAL_SAVE_LOCKS.blockSaveBets = Boolean(res.data?.blockSaveBets);
    GLOBAL_SAVE_LOCKS.blockSaveKnockout = Boolean(res.data?.blockSaveKnockout);

    refreshTestModeUI();

    if (window.STATE && typeof window.renderMatches === 'function') {
      try { window.renderMatches(); } catch (_) {}
    }
    if (window.STATE && typeof window.renderKnockoutMatches === 'function') {
      try { window.renderKnockoutMatches(); } catch (_) {}
    }

    window.dispatchEvent(new CustomEvent('league-test-mode-changed', {
      detail: { enabled: Boolean(res.testMode) }
    }));

    toast(
      enabled
        ? '🧪 Modo de teste ATIVADO. Partidas encerradas e regras estão liberadas.'
        : '🔒 Modo de teste encerrado. Configuração anterior restaurada.',
      'success'
    );
  } catch (err) {
    console.error('Erro ao alternar modo de teste:', err);
    toast(err.message || 'Erro ao alterar modo de teste.', 'error');
  }
}

function refreshTestModeUI() {
  const btn = document.getElementById('btn-toggle-test-mode');
  if (!btn) return;

  const enabled = GLOBAL_SAVE_LOCKS.testMode === true;
  btn.classList.toggle('btn-danger', enabled);
  btn.classList.toggle('btn-warning', !enabled);
  btn.innerHTML = enabled
    ? '<i class="fas fa-flask"></i><span style="white-space:nowrap;">Teste ON</span>'
    : '<i class="fas fa-flask"></i><span style="white-space:nowrap;">Teste</span>';
  btn.title = enabled
    ? 'Modo de teste ativo — clique para encerrar e restaurar as travas'
    : 'Ativar modo de teste temporário';
}

async function updateGlobalSaveLocks(patch) {
  try {
    const leagueId = localStorage.getItem('selectedLeagueId') || '1';
    const dataToSend = { ...patch, leagueId };
    const res = await api.post('/api/settings/global', dataToSend);
    if (res && res.success && res.data) {
      GLOBAL_SAVE_LOCKS = { ...GLOBAL_SAVE_LOCKS, ...res.data };
      return true;
    }
  } catch (e) {
    console.warn('Falha ao atualizar configurações globais', e);
  }
  return false;
}

export function isSaveBetsBlocked() {
  try {
    if (GLOBAL_SAVE_LOCKS && typeof GLOBAL_SAVE_LOCKS.blockSaveBets !== 'undefined') {
      return !!GLOBAL_SAVE_LOCKS.blockSaveBets;
    }
    return localStorage.getItem(SAVE_LOCK_KEYS.bets) === '1';
  } catch (e) { return false; }
}

export function isSaveKnockoutBlocked() {
  try {
    if (GLOBAL_SAVE_LOCKS && typeof GLOBAL_SAVE_LOCKS.blockSaveKnockout !== 'undefined') {
      return !!GLOBAL_SAVE_LOCKS.blockSaveKnockout;
    }
    return localStorage.getItem(SAVE_LOCK_KEYS.knockout) === '1';
  } catch (e) { return false; }
}

export function isRequireAllBetsEnabled() {
  try {
    if (GLOBAL_SAVE_LOCKS && typeof GLOBAL_SAVE_LOCKS.requireAllBets !== 'undefined') {
      return !!GLOBAL_SAVE_LOCKS.requireAllBets;
    }
    return localStorage.getItem(SAVE_LOCK_KEYS.requireAll) === '1';
  } catch (e) { return false; }
}

async function setSaveBetsBlocked(value) {
  try {
    const ok = await updateGlobalSaveLocks({ blockSaveBets: !!value });
    if (!ok) {
      if (value) localStorage.setItem(SAVE_LOCK_KEYS.bets, '1');
      else localStorage.removeItem(SAVE_LOCK_KEYS.bets);
    }
  } catch (e) {}
}

async function setSaveKnockoutBlocked(value) {
  try {
    const ok = await updateGlobalSaveLocks({ blockSaveKnockout: !!value });
    if (!ok) {
      if (value) localStorage.setItem(SAVE_LOCK_KEYS.knockout, '1');
      else localStorage.removeItem(SAVE_LOCK_KEYS.knockout);
    }
  } catch (e) {}
}

async function setRequireAllBetsEnabled(value) {
  try {
    const ok = await updateGlobalSaveLocks({ requireAllBets: !!value });
    if (!ok) {
      if (value) localStorage.setItem(SAVE_LOCK_KEYS.requireAll, '1');
      else localStorage.removeItem(SAVE_LOCK_KEYS.requireAll);
    }
  } catch (e) {}
}

export function refreshSaveLocksUI() {
  const btnBets = document.getElementById('btn-toggle-save-bets');
  const btnKO = document.getElementById('btn-toggle-save-knockout');
  const btnRequireAll = document.getElementById('btn-toggle-require-all-bets');

  if (btnBets) {
    const blocked = isSaveBetsBlocked();
    btnBets.innerHTML = `<i class="fas ${blocked ? 'fa-lock' : 'fa-lock-open'}"></i>`;
    btnBets.classList.toggle('btn-danger', blocked);
    btnBets.classList.toggle('btn-secondary', !blocked);
    btnBets.classList.toggle('is-blocked', blocked);
    btnBets.title = blocked ? 'Desbloquear salvar palpites' : 'Bloquear salvar palpites';
  }

  if (btnKO) {
    const blocked = isSaveKnockoutBlocked();
    btnKO.innerHTML = `<i class="fas ${blocked ? 'fa-lock' : 'fa-lock-open'}"></i>`;
    btnKO.classList.toggle('btn-danger', blocked);
    btnKO.classList.toggle('btn-secondary', !blocked);
    btnKO.classList.toggle('is-blocked', blocked);
    btnKO.title = blocked ? 'Desbloquear salvar mata-mata' : 'Bloquear salvar mata-mata';
  }

  if (btnRequireAll) {
    const enabled = isRequireAllBetsEnabled();
    btnRequireAll.innerHTML = `<i class="fas ${enabled ? 'fa-check-circle' : 'fa-circle'}"></i>`;
    btnRequireAll.classList.toggle('btn-primary', enabled);
    btnRequireAll.classList.toggle('btn-secondary', !enabled);
    btnRequireAll.classList.toggle('is-active', enabled);
    btnRequireAll.title = enabled ? 'Não exigir todos os palpites' : 'Exigir todos os palpites antes de salvar';
  }

  const saveBetsBtn = document.getElementById('save-bets');
  if (saveBetsBtn) {
    const blocked = isSaveBetsBlocked();
    saveBetsBtn.disabled = blocked;
    saveBetsBtn.classList.toggle('btn-disabled', blocked);
    saveBetsBtn.style.opacity = blocked ? '0.6' : '';
    saveBetsBtn.style.cursor = blocked ? 'not-allowed' : '';
  }

  const saveKoBtn = document.getElementById('save-knockout-bets');
  if (saveKoBtn) {
    const blocked = isSaveKnockoutBlocked();
    saveKoBtn.disabled = blocked;
    saveKoBtn.classList.toggle('btn-disabled', blocked);
    saveKoBtn.style.opacity = blocked ? '0.6' : '';
    saveKoBtn.style.cursor = blocked ? 'not-allowed' : '';
  }

  const requireCheckbox = document.getElementById('require-all-bets');
  if (requireCheckbox) {
    const enabled = isRequireAllBetsEnabled();
    if (enabled) {
      requireCheckbox.checked = true;
      requireCheckbox.disabled = true;
      requireCheckbox.title = 'Esta opção foi exigida pelo administrador.';
    } else {
      requireCheckbox.disabled = false;
      requireCheckbox.title = '';
    }
  }
}

function wireSaveLocksAdmin() {
  loadGlobalSaveLocks().then(() => refreshSaveLocksUI());
  const btnBets = document.getElementById('btn-toggle-save-bets');
  const btnKO   = document.getElementById('btn-toggle-save-knockout');
  const btnRequireAll = document.getElementById('btn-toggle-require-all-bets');

  if (btnBets) {
    btnBets.addEventListener('click', () => {
      const newVal = !isSaveBetsBlocked();
      setSaveBetsBlocked(newVal).then(() => {
        GLOBAL_SAVE_LOCKS.blockSaveBets = newVal;
        refreshSaveLocksUI();
      });
      toast(newVal ? 'Salvar palpites bloqueado.' : 'Salvar palpites liberado.', 'info');
    });
  }

  if (btnKO) {
    btnKO.addEventListener('click', () => {
      const newVal = !isSaveKnockoutBlocked();
      setSaveKnockoutBlocked(newVal).then(() => {
        GLOBAL_SAVE_LOCKS.blockSaveKnockout = newVal;
        refreshSaveLocksUI();
      });
      toast(newVal ? 'Salvar mata-mata bloqueado.' : 'Salvar mata-mata liberado.', 'info');
    });
  }

  if (btnRequireAll) {
    btnRequireAll.addEventListener('click', () => {
      const newVal = !isRequireAllBetsEnabled();
      GLOBAL_SAVE_LOCKS.requireAllBets = newVal;
      refreshSaveLocksUI();
      setRequireAllBetsEnabled(newVal);
      toast(newVal ? 'Exigência de todos os palpites ativada.' : 'Exigência desativada.', 'info');
    });
  }
}

// =============== LISTAR PARTIDAS (ADMIN) ===============
async function loadAdminMatches() {
  try {
    const leagueId = localStorage.getItem('selectedLeagueId') || '1';
    const res = await api.get(`/api/matches/admin/all?leagueId=${leagueId}`);
    if (!res || !res.success) throw new Error(res?.message || 'Erro ao listar partidas');
    AdminState.matches = res.data || [];
    renderAdminMatches(AdminState.matches);
  } catch (err) {
    console.error('Erro loadAdminMatches:', err);
    const container = $adminMatchesList();
    if (container) container.innerHTML = '<p>Erro ao carregar partidas.</p>';
    toast('Erro ao carregar partidas', 'error');
  }
}

const KNOCKOUT_GROUPS = [
  '16-avos de final',
  'Oitavas de final',
  'Quartas de final',
  'Semifinal',
  '3º lugar',
  'Final'
];

function renderAdminMatches(matchesList) {
  const container = $adminMatchesList();
  if (!container) return;

  if (!matchesList || matchesList.length === 0) {
    container.innerHTML = '<p class="admin-empty-state">Nenhuma partida encontrada.</p>';
    updateAdminBulkBar();
    return;
  }

  const validIds = new Set(matchesList.map(m => String(m.matchId)));
  [...selectedAdminMatchIds].forEach(id => {
    if (!validIds.has(String(id))) selectedAdminMatchIds.delete(String(id));
  });

  let html = `
    <div class="admin-match-toolbar">
      <div class="admin-match-tabs" role="tablist">
        <button class="admin-match-tab ${activeAdminTab === 'group' ? 'active' : ''}" onclick="window.switchAdminTab('group')">
          <i class="fas fa-users"></i><span>Grupos</span>
        </button>
        <button class="admin-match-tab ${activeAdminTab === 'knockout' ? 'active' : ''}" onclick="window.switchAdminTab('knockout')">
          <i class="fas fa-sitemap"></i><span>Mata-mata</span>
        </button>
      </div>
      <div class="admin-match-toolbar-actions">
        <button class="admin-select-mode-btn ${adminMatchSelectionMode ? 'active' : ''}" type="button"
          onclick="window.toggleAdminSelectionMode()" title="Selecionar partidas">
          <i class="fas fa-check-square"></i>
        </button>
        <button class="admin-close-matches" type="button" onclick="window.closeAdminMatchesPanel()" title="Fechar lista">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>
  `;

  const filteredMatches = matchesList.filter(m => {
    if (activeAdminTab === 'group') {
      return m.phase === 'group' || m.phase === 'points_run' ||
             m.phase === 'pontos_corridos' || !m.phase;
    }
    return m.phase === 'knockout';
  });

  if (filteredMatches.length === 0) {
    html += `<p class="admin-empty-state">Nenhuma partida encontrada nesta fase.</p>`;
    container.innerHTML = html;
    updateAdminBulkBar();
    return;
  }

  const leagues = {};
  filteredMatches.forEach(m => {
    const leagueName = m.leagueName || "Outras Ligas";
    if (!leagues[leagueName]) leagues[leagueName] = [];
    leagues[leagueName].push(m);
  });

  Object.keys(leagues).forEach((leagueName, lIdx) => {
    const leagueMatches = leagues[leagueName];
    const groups = {};
    leagueMatches.forEach(m => {
      const phase = String(m.phase || '').toLowerCase();
      let g = m.group || '';
      if (phase === 'group' || phase === 'pontos_corridos' || phase === 'points_run') {
        g = Number.isInteger(Number(m.roundNumber)) && Number(m.roundNumber) > 0
          ? `Rodada ${Number(m.roundNumber)}` : (g || 'Geral');
      }
      if (!g) g = 'Geral';
      if (!groups[g]) groups[g] = [];
      groups[g].push(m);
    });

    html += `
      <section class="admin-league-block">
        <button class="admin-league-header" type="button" onclick="window.toggleAdminSection('admin-league-${lIdx}')">
          <span class="admin-section-title">
            <i class="fas fa-trophy"></i>
            <strong>${String(leagueName).toUpperCase()}</strong>
            <small>${leagueMatches.length} jogos</small>
          </span>
          <i class="fas fa-chevron-down admin-chevron"></i>
        </button>
        <div id="admin-league-${lIdx}" class="admin-league-content">
          ${Object.keys(groups).map((groupName, gIdx) => {
            const groupMatches = groups[groupName];
            const uniqueId = `lg-${lIdx}-gr-${gIdx}`;
            const allGroupSelected = groupMatches.length > 0 &&
              groupMatches.every(m => selectedAdminMatchIds.has(String(m.matchId)));
            const lid = String(leagueMatches[0]?.leagueId || localStorage.getItem('selectedLeagueId') || '');
            const firstMatch = groupMatches[0] || {};
            const phase = String(firstMatch.phase || '').toLowerCase();
            const roundNumber = Number(firstMatch.roundNumber);
            const hasRound = (phase === 'group' || phase === 'pontos_corridos' || phase === 'points_run') &&
              Number.isInteger(roundNumber) && roundNumber > 0;
            const ln = String(leagueName).replace(/'/g, "\\'");
            const gn = String(groupName).replace(/'/g, "\\'");
            const bulkParams = hasRound
              ? `{leagueId:'${lid}',phase:'${phase}',roundNumber:${roundNumber}}`
              : `{leagueId:'${lid}',leagueName:'${ln}',groupName:'${gn}'}`;
            return `
              <section class="admin-round-block">
                <button class="admin-round-header" type="button" onclick="window.toggleAdminSection('admin-round-${uniqueId}')">
                  <span>
                    <i class="fas fa-folder-open"></i>
                    <strong>${String(groupName).toUpperCase()}</strong>
                    <small>${groupMatches.length} jogos</small>
                  </span>
                  <i class="fas fa-chevron-down admin-chevron"></i>
                </button>
                <div id="admin-round-${uniqueId}" class="admin-round-content">
                  <div class="admin-round-tools ${adminMatchSelectionMode ? 'selection-mode-on' : ''}">
                    ${adminMatchSelectionMode ? `<label class="admin-select-group" onclick="event.stopPropagation()">
                      <input type="checkbox" ${allGroupSelected ? 'checked' : ''}
                        onchange="window.toggleAdminGroupSelection(this, ${JSON.stringify(groupMatches.map(m => m.matchId))})">
                      <span>Selecionar rodada</span>
                    </label>` : '<span></span>'}
                    <div class="admin-round-bulk-actions">
                      <button type="button" class="admin-mini-action admin-mini-reopen"
                        onclick="event.stopPropagation(); window.bulkUnfinish(${bulkParams})"
                        title="Reabrir grupo/rodada"><i class="fas fa-undo"></i></button>
                      <button type="button" class="admin-mini-action admin-mini-delete"
                        onclick="event.stopPropagation(); window.bulkDelete(${bulkParams})"
                        title="Excluir grupo/rodada"><i class="fas fa-trash"></i></button>
                    </div>
                  </div>
                  <div class="admin-match-list">
                    ${groupMatches.map(match => renderSingleMatchRow(match)).join('')}
                  </div>
                </div>
              </section>
            `;
          }).join('')}
        </div>
      </section>
    `;
  });

  container.innerHTML = html;
  updateAdminBulkBar();
}


function renderSingleMatchRow(match) {
  const statusLabels = {
    scheduled: 'Agendado', '1_tempo': '1º Tempo', intervalo: 'Intervalo',
    '2_tempo': '2º Tempo', prorrogacao: 'Prorrogação', penaltis: 'Pênaltis',
    finished: 'Finalizado', cancelled: 'Cancelado', postponed: 'Adiado'
  };

  const isLive = ['1_tempo','intervalo','2_tempo','prorrogacao','penaltis'].includes(match.status);
  const statusClass = match.status === 'finished' ? 'finished' : isLive ? 'in_progress' : 'scheduled';
  const score = (match.status === 'finished' || isLive)
    ? `<span class="score-box">${match.scoreA ?? 0} x ${match.scoreB ?? 0}</span>`
    : '<span class="score-box">VS</span>';
  const penaltyScore = (match.penaltiesA !== null && match.penaltiesB !== null)
    ? `<span class="penalty-score-box">Pênaltis ${match.penaltiesA} - ${match.penaltiesB}</span>` : '';
  const statusText = statusLabels[match.status] || match.status;
  const selected = selectedAdminMatchIds.has(String(match.matchId));

  const finishOrReopen = match.status !== 'finished'
    ? `<button class="admin-match-action admin-action-finish" onclick="event.stopPropagation(); prepareFinishMatch(${match.matchId})" title="Finalizar"><i class="fas fa-flag-checkered"></i></button>`
    : `<button class="admin-match-action admin-action-reopen" onclick="event.stopPropagation(); adminUnfinishMatch(${match.matchId})" title="Reabrir"><i class="fas fa-undo"></i></button>`;

  const teamA = String(match.teamA || '').replace(/'/g, "\\'");
  const teamB = String(match.teamB || '').replace(/'/g, "\\'");

  return `
    <article class="admin-match-card ${statusClass} ${selected ? 'is-selected' : ''}"
      data-match-id="${match.matchId}" onclick="window.toggleAdminCardActions(this, event)">
      ${adminMatchSelectionMode ? `<div class="admin-match-select" onclick="event.stopPropagation()">
        <input type="checkbox" aria-label="Selecionar partida ${match.matchId}"
          ${selected ? 'checked' : ''}
          onchange="window.toggleAdminMatchSelection(${match.matchId}, this.checked)">
      </div>` : ''}
      <div class="admin-match-main">
        <div class="admin-match-top">
          <span>ID ${match.matchId}</span>
          <span>API: ${match.apiId || '---'}</span>
          <span class="admin-match-phase">${match.group || '-'}</span>
          <span class="admin-match-menu"><i class="fas fa-ellipsis-v"></i></span>
        </div>
        <div class="admin-match-teams">
          <div class="admin-team admin-team-home"><span>${match.teamA}</span>${renderTeamMedia(match.teamA, match.logoA)}</div>
          ${score}
          <div class="admin-team admin-team-away">${renderTeamMedia(match.teamB, match.logoB)}<span>${match.teamB}</span></div>
        </div>
        <div class="admin-match-meta">
          <span class="admin-status ${statusClass}">${statusText}</span>
          ${penaltyScore}
          <span class="admin-bets-count"
            onclick="event.stopPropagation(); showMatchBetsModal(${match.matchId}, '${teamA} vs ${teamB}')">
            <i class="fas fa-ticket-alt"></i> ${match.betsCount || 0}
          </span>
        </div>
        <div class="admin-match-actions" aria-hidden="true">
          <button class="admin-match-action admin-action-edit" onclick="event.stopPropagation(); editMatch(${match.matchId})" title="Editar"><i class="fas fa-edit"></i></button>
          ${finishOrReopen}
          <button class="admin-match-action admin-action-delete" onclick="event.stopPropagation(); adminDeleteMatchForce(${match.matchId})" title="Excluir"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    </article>
  `;
}


function getConfiguredPodiumSize() {
  const size = Number(CurrentSettings?.championshipRules?.podiumSize ?? 4);
  return Math.min(4, Math.max(1, Number.isFinite(size) ? size : 4));
}

function getPodiumFieldConfig() {
  return [
    { key: 'first',  id: 'podium-first',  label: '🥇 1º Lugar' },
    { key: 'second', id: 'podium-second', label: '🥈 2º Lugar' },
    { key: 'third',  id: 'podium-third',  label: '🥉 3º Lugar' },
    { key: 'fourth', id: 'podium-fourth', label: '⭐ 4º Lugar' }
  ];
}

function renderOfficialPodiumFields() {
  const container = document.getElementById('official-podium-fields');
  if (!container) return;

  const size = getConfiguredPodiumSize();
  const fields = getPodiumFieldConfig().slice(0, size);

  container.innerHTML = `
    <div class="form-row">
      ${fields.map(field => `
        <div class="form-group" data-podium-position="${fields.indexOf(field) + 1}">
          <label>${field.label}</label>
          <select id="${field.id}"></select>
        </div>
      `).join('')}
    </div>
    <small style="display:block; margin-top:6px; color:#888;">
      O pódio oficial segue o tamanho definido em <strong>Regras do Campeonato</strong>: ${size} ${size === 1 ? 'posição' : 'posições'}.
    </small>
  `;
}

function populatePodiumSelects() {
  const size = getConfiguredPodiumSize();
  const ids = getPodiumFieldConfig().slice(0, size).map(f => f.id);
  const selects = ids.map(id => document.getElementById(id)).filter(Boolean);
  if (!selects.length) return;

  const set = new Set();
  (AdminState.matches || []).forEach(m => {
    if (m?.teamA) set.add(m.teamA);
    if (m?.teamB) set.add(m.teamB);
  });
  const teams = Array.from(set).sort((a, b) => a.localeCompare(b));

  selects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>' +
      teams.map(t => `<option value="${t}">${withFlag(t)}</option>`).join('');
    if (current && teams.includes(current)) sel.value = current;
  });
}

async function openAddMatchModal() {
  const modal = document.getElementById('add-match-modal');
  if (!modal) return toast('Modal de adicionar partida não encontrado', 'error');
  openModal('add-match-modal');

  const form = document.getElementById('add-match-form');
  if (form) {
    form.removeEventListener('submit', handleAddMatch);
    form.addEventListener('submit', handleAddMatch);
  }
  setupPhaseToggle();
}

function setupPhaseToggle() {
  const phaseSelect = document.getElementById('match-phase');
  const groupInput = document.getElementById('match-group');
  const groupWrapper = groupInput?.closest('.form-group');
  const knockoutSelect = document.getElementById('match-group-knockout');
  const knockoutWrapper = knockoutSelect?.closest('.form-group');

  if (!phaseSelect || !groupWrapper || !knockoutWrapper) return;

  function updateFields() {
    if (phaseSelect.value === 'knockout') {
      groupWrapper.style.display = 'none';
      knockoutWrapper.style.display = 'block';
      groupInput.value = '';
      groupInput.required = false;
      knockoutSelect.required = true;
    } else {
      groupWrapper.style.display = 'block';
      knockoutWrapper.style.display = 'none';
      knockoutSelect.value = '';
      knockoutSelect.required = false;
      groupInput.required = true;
    }
  }

  phaseSelect.removeEventListener('change', updateFields);
  phaseSelect.addEventListener('change', updateFields);
  updateFields();
}

async function loadOfficialPodiumIntoModal() {
  try {
    const leagueId = localStorage.getItem('selectedLeagueId') || '1';
    const res = await api.get(`/api/points/podium?leagueId=${leagueId}`);
    const size = getConfiguredPodiumSize();
    const fields = getPodiumFieldConfig().slice(0, size);

    if (!res.success || !res.data) {
      fields.forEach(field => {
        const el = document.getElementById(field.id);
        if (el) el.value = '';
      });
      return;
    }

    fields.forEach(field => {
      const el = document.getElementById(field.id);
      if (el) el.value = res.data[field.key] || '';
    });
  } catch (err) {
    console.warn('Não foi possível carregar pódio atual da liga específica');
  }
}

async function handleAddMatch(e) {
  e.preventDefault();

  const phaseEl = document.getElementById('match-phase');
  const phaseVal = phaseEl ? phaseEl.value : 'group';
  const groupInput = document.getElementById('match-group');
  const knockoutSelect = document.getElementById('match-group-knockout');

  let groupVal = phaseVal === 'knockout'
    ? (knockoutSelect ? knockoutSelect.value : '')
    : (groupInput ? groupInput.value.trim() : '');

  if (phaseVal === 'knockout' && !groupVal) {
    toast('Selecione a fase do mata-mata', 'warning');
    return;
  }

  const payload = {
    matchId: parseInt(document.getElementById('match-id').value, 10),
    apiId: document.getElementById('match-apiId').value ? Number(document.getElementById('match-apiId').value) : null,
    teamA: document.getElementById('team-a').value.trim(),
    teamB: document.getElementById('team-b').value.trim(),
    date: document.getElementById('match-date').value.trim(),
    time: document.getElementById('match-time').value.trim(),
    group: groupVal,
    stadium: document.getElementById('match-stadium').value.trim(),
    phase: phaseVal,
    leagueId: localStorage.getItem('selectedLeagueId') || '1',
    leagueName: document.getElementById('match-league-name')?.value?.trim() || 'Liga Principal'
  };

  try {
    const res = await api.post('/api/matches/admin/add', payload);
    if (!res?.success) throw new Error(res?.message || 'Erro ao adicionar');
    toast('Partida adicionada!', 'success');
    closeModal('add-match-modal');
    const form = document.getElementById('add-match-form');
    if (form) form.reset();
    await loadAdminMatches();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao adicionar partida', 'error');
  }
}

async function openFinishMatchModal() {
  const select = document.getElementById('finish-match-select');
  if (!select) return toast('Modal de finalizar partida não encontrado', 'error');

  select.innerHTML = '<option value="">Selecione uma partida para finalizar...</option>';
  const pendingMatches = AdminState.matches.filter((m) => m.status !== 'finished');

  if (pendingMatches.length === 0) {
    return toast('Nenhuma partida pendente para finalizar', 'info');
  }

  pendingMatches.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.matchId;
    const emojiA = flagEmoji(m.teamA) || '🏳️';
    const emojiB = flagEmoji(m.teamB) || '🏳️';
    opt.textContent = `${emojiA} ${m.teamA} vs ${m.teamB} ${emojiB} (${m.group})`;
    if (m.logoA) opt.dataset.logoA = m.logoA;
    if (m.logoB) opt.dataset.logoB = m.logoB;
    select.appendChild(opt);
  });

  if (typeof openModal === 'function') {
    openModal('finish-match-modal');
  } else {
    const modal = document.getElementById('finish-match-modal');
    if (modal) modal.style.display = 'flex';
  }
}

async function prepareFinishMatch(matchId) {
  openFinishMatchModal();
  setTimeout(() => {
    const select = document.getElementById('finish-match-select');
    if (select) {
      select.value = String(matchId);
      loadMatchDetailsAdmin();
    }
  }, 100);
}

window.loadMatchDetailsAdmin = function loadMatchDetailsAdmin() {
  const select = document.getElementById('finish-match-select');
  const detailsDiv = document.getElementById('match-details');
  if (!select || !detailsDiv) return;

  const matchId = Number(select.value);
  if (!matchId) {
    detailsDiv.style.display = 'none';
    return;
  }

  const match = AdminState.matches.find((m) => m.matchId === matchId);
  if (!match) return;

  const nameContainer = document.getElementById('selected-match-name');
  if (nameContainer) {
    nameContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 5px;"><span>${match.teamA}</span>${renderTeamMedia(match.teamA, match.logoA)}</div>
        <span style="color: #888;">vs</span>
        <div style="display: flex; align-items: center; gap: 5px;">${renderTeamMedia(match.teamB, match.logoB)}<span>${match.teamB}</span></div>
      </div>
    `;
  }

  const penBox = document.getElementById('admin-penalties-box');
  const regularBox = document.getElementById('admin-regular-time-box');
  const qualField = document.getElementById('qualified-side');
  const scoreAInput = document.getElementById('score-a');
  const scoreBInput = document.getElementById('score-b');
  const regAInput = document.getElementById('regular-time-score-a');
  const regBInput = document.getElementById('regular-time-score-b');
  const lblA = document.getElementById('lbl-score-a');
  const lblB = document.getElementById('lbl-score-b');

  const isKnockout = match.phase === 'knockout';

  // Sempre limpa os campos ao trocar de partida para não carregar valores da anterior.
  if (scoreAInput) scoreAInput.value = '';
  if (scoreBInput) scoreBInput.value = '';
  if (regAInput) regAInput.value = '';
  if (regBInput) regBInput.value = '';
  const penAInput = document.getElementById('penalties-a');
  const penBInput = document.getElementById('penalties-b');
  if (penAInput) penAInput.value = '';
  if (penBInput) penBInput.value = '';

  if (isKnockout) {
    if (regularBox) regularBox.style.display = 'block';
    if (penBox) penBox.style.display = 'block';
    if (lblA) lblA.textContent = 'Placar final A';
    if (lblB) lblB.textContent = 'Placar final B';
    if (regAInput) regAInput.placeholder = '90 min';
    if (regBInput) regBInput.placeholder = '90 min';
    if (qualField) {
      qualField.innerHTML = `
        <option value="">Selecione quem avança (se necessário)...</option>
        <option value="A">${withFlag(match.teamA)}</option>
        <option value="B">${withFlag(match.teamB)}</option>
      `;
    }
  } else {
    if (regularBox) regularBox.style.display = 'none';
    if (penBox) penBox.style.display = 'none';
    if (lblA) lblA.textContent = 'Placar final A';
    if (lblB) lblB.textContent = 'Placar final B';
    if (qualField) qualField.innerHTML = '<option value="">Fase de Grupos</option>';
  }

  detailsDiv.style.display = 'block';
};

async function finishMatch() {
  const matchId = Number(document.getElementById('finish-match-select').value);
  const scoreAValue = document.getElementById('score-a')?.value ?? '';
  const scoreBValue = document.getElementById('score-b')?.value ?? '';
  const scoreA = scoreAValue !== '' ? Number(scoreAValue) : null;
  const scoreB = scoreBValue !== '' ? Number(scoreBValue) : null;

  const regAValue = document.getElementById('regular-time-score-a')?.value ?? '';
  const regBValue = document.getElementById('regular-time-score-b')?.value ?? '';
  const regularTimeScoreA = regAValue !== '' ? Number(regAValue) : null;
  const regularTimeScoreB = regBValue !== '' ? Number(regBValue) : null;

  const penAValue = document.getElementById('penalties-a')?.value ?? '';
  const penBValue = document.getElementById('penalties-b')?.value ?? '';
  const penA = penAValue !== '' ? Number(penAValue) : null;
  const penB = penBValue !== '' ? Number(penBValue) : null;

  const qualifiedEl = document.getElementById('qualified-side');
  const qualifiedSide = qualifiedEl ? qualifiedEl.value : '';

  if (!matchId || scoreA === null || scoreB === null) {
    return toast('Preencha o placar final', 'warning');
  }

  const match = AdminState.matches.find((m) => m.matchId === matchId);
  const isKnockout = match?.phase === 'knockout';

  if (isKnockout && (regularTimeScoreA === null || regularTimeScoreB === null)) {
    return toast('Em mata-mata, informe o placar aos 90 minutos.', 'warning');
  }

  if (!isKnockout && (penA !== null || penB !== null)) {
    return toast('Partidas da fase de grupos não possuem pênaltis.', 'warning');
  }

  if (isKnockout && ((penA === null) !== (penB === null))) {
    return toast('Informe os dois placares de pênaltis ou deixe ambos vazios.', 'warning');
  }

  const payload = {
    scoreA,
    scoreB,
    penaltiesA: penA,
    penaltiesB: penB
  };

  if (isKnockout) {
    payload.regularTimeScoreA = regularTimeScoreA;
    payload.regularTimeScoreB = regularTimeScoreB;
  }

  if (qualifiedSide && isKnockout) payload.qualifiedSide = qualifiedSide;

  try {
    const res = await api.post(`/api/matches/admin/finish/${matchId}`, payload);
    if (!res.success) throw new Error(res.message || 'Erro ao finalizar');
    toast('Partida finalizada com sucesso', 'success');
    closeModal('finish-match-modal');
    await loadAdminMatches();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao finalizar partida', 'error');
  }
}

async function editMatch(matchId) {
  const match = AdminState.matches.find((m) => m.matchId === Number(matchId));
  if (!match) return toast('Partida não encontrada', 'error');

  const existing = document.getElementById('edit-match-modal');
  if (existing) existing.remove();

  const isKnockout = match.phase === 'knockout';

  const html = `
    <div id="edit-match-modal" class="modal active">
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">Editar Partida</h3>
          <button class="close-modal" onclick="closeModal('edit-match-modal')">&times;</button>
        </div>
        <form id="edit-match-form">
          <input type="hidden" id="edit-match-id" value="${match.matchId}">
          <div class="form-row">
            <div class="form-group"><label>ID da API</label><input id="edit-apiId" type="number" value="${match.apiId ?? ''}" placeholder="ID Externo" required></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Time A</label><input id="edit-team-a" value="${match.teamA}" required></div>
            <div class="form-group"><label>Time B</label><input id="edit-team-b" value="${match.teamB}" required></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Placar A</label><input id="edit-score-a" type="number" value="${match.scoreA ?? ''}"></div>
            <div class="form-group"><label>Placar B</label><input id="edit-score-b" type="number" value="${match.scoreB ?? ''}"></div>
          </div>
          <div id="edit-penalties-box" style="display: ${isKnockout ? 'block' : 'none'}; background: #222; padding: 10px; border-radius: 8px; margin-bottom: 10px;">
             <p style="font-size:11px; color:#aaa; margin-bottom:5px;">Pênaltis (Mata-mata):</p>
             <div class="form-row">
                <div class="form-group"><input id="edit-penalties-a" type="number" value="${match.penaltiesA ?? ''}" placeholder="Pên. A"></div>
                <div class="form-group"><input id="edit-penalties-b" type="number" value="${match.penaltiesB ?? ''}" placeholder="Pên. B"></div>
             </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Data</label><input id="edit-match-date" value="${match.date || ''}" placeholder="DD/MM/AAAA" required></div>
            <div class="form-group"><label>Horário</label><input id="edit-match-time" value="${match.time || ''}" placeholder="HH:MM" required></div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Status</label>
              <select id="edit-match-status">
                <option value="scheduled" ${match.status === 'scheduled' ? 'selected' : ''}>Agendado</option>
                <option value="1_tempo" ${match.status === '1_tempo' ? 'selected' : ''}>1º Tempo</option>
                <option value="intervalo" ${match.status === 'intervalo' ? 'selected' : ''}>Intervalo</option>
                <option value="2_tempo" ${match.status === '2_tempo' ? 'selected' : ''}>2º Tempo</option>
                <option value="prorrogacao" ${match.status === 'prorrogacao' ? 'selected' : ''}>Prorrogação</option>
                <option value="1_tet" ${match.status === '1_tet' ? 'selected' : ''}>1º Tempo Extra</option>
                <option value="2_tet" ${match.status === '2_tet' ? 'selected' : ''}>2º Tempo Extra</option>
                <option value="penaltis" ${match.status === 'penaltis' ? 'selected' : ''}>Pênaltis</option>
                <option value="finished" ${match.status === 'finished' ? 'selected' : ''}>Finalizado</option>
                <option value="cancelled" ${match.status === 'cancelled' ? 'selected' : ''}>Cancelado</option>
                <option value="postponed" ${match.status === 'postponed' ? 'selected' : ''}>Adiado</option>
              </select>
            </div>
            <div class="form-group"><label>Grupo</label><input id="edit-match-group" value="${match.group || ''}" required></div>
          </div>
          <div class="form-row" style="gap:8px; margin-top:12px;">
            <button type="submit" class="btn btn-success" style="flex:1"><i class="fas fa-save"></i> Salvar</button>
            <button type="button" class="btn btn-danger" onclick="adminDeleteMatchForce(${match.matchId})"><i class="fas fa-trash"></i></button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('edit-match-form').addEventListener('submit', handleEditMatch);
}

async function handleEditMatch(e) {
  e.preventDefault();
  const matchId = Number(document.getElementById('edit-match-id').value);

  const updates = {
    apiId: document.getElementById('edit-apiId').value ? Number(document.getElementById('edit-apiId').value) : null,
    teamA: document.getElementById('edit-team-a').value.trim(),
    teamB: document.getElementById('edit-team-b').value.trim(),
    date: document.getElementById('edit-match-date').value.trim(),
    time: document.getElementById('edit-match-time').value.trim(),
    group: document.getElementById('edit-match-group').value.trim(),
    status: document.getElementById('edit-match-status').value,
  };

  const scoreAInput = document.getElementById('edit-score-a').value;
  const scoreBInput = document.getElementById('edit-score-b').value;
  updates.scoreA = (scoreAInput !== '') ? Number(scoreAInput) : null;
  updates.scoreB = (scoreBInput !== '') ? Number(scoreBInput) : null;

  const penAInput = document.getElementById('edit-penalties-a')?.value;
  const penBInput = document.getElementById('edit-penalties-b')?.value;
  if (penAInput !== undefined) {
    updates.penaltiesA = (penAInput !== '') ? Number(penAInput) : null;
    updates.penaltiesB = (penBInput !== '') ? Number(penBInput) : null;
  }

  const currentMatch = AdminState.matches.find((m) => m.matchId === matchId);
  const leagueId =
    currentMatch?.leagueId ||
    localStorage.getItem('selectedLeagueId') ||
    '1';

  updates.leagueId = String(leagueId).trim();

  try {
    const res = await api.put(`/api/matches/admin/edit/${matchId}`, updates);
    if (!res.success) throw new Error(res.message || 'Erro ao editar');
    toast('Partida atualizada!', 'success');
    closeModal('edit-match-modal');
    await loadAdminMatches(); 
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao editar partida', 'error');
  }
}

async function adminUnfinishMatch(matchId) {
    if (!confirm('Reabrir esta partida (zerar placares e pontos)?')) return;

    const currentMatch = AdminState.matches.find((m) => m.matchId === Number(matchId));
    const leagueId =
        currentMatch?.leagueId ||
        localStorage.getItem('selectedLeagueId') ||
        '1';

    try {
        const res = await api.post('/api/matches/admin/unfinish-bulk', {
            matchId: Number(matchId),
            leagueId: String(leagueId).trim()
        });
        if (res.success) {
            toast('Partida reaberta com sucesso', 'success');
            closeModal('edit-match-modal');
            await loadAdminMatches();
        } else {
            throw new Error(res.message);
        }
    } catch (err) {
        console.error('Erro ao reabrir partida:', err);
        toast('Erro ao reabrir partida', 'error');
    }
}

async function adminDeleteMatchForce(matchId) {
    if (!confirm('Excluir DEFINITIVAMENTE esta partida?')) return;

    const currentMatch = AdminState.matches.find((m) => m.matchId === Number(matchId));
    const leagueId =
        currentMatch?.leagueId ||
        localStorage.getItem('selectedLeagueId') ||
        '1';

    try {
        const res = await api.del('/api/matches/admin/delete-bulk', {
            matchId: Number(matchId),
            leagueId: String(leagueId).trim()
        });
        if (res.success) {
            toast('Partida excluída com sucesso', 'success');
            if (typeof closeModal === 'function') closeModal('edit-match-modal');
            await loadAdminMatches();
        }
    } catch (err) {
        console.error('Erro ao excluir:', err);
        toast(err.message || 'Erro ao excluir', 'error');
    }
}

async function setPodium() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  const size = getConfiguredPodiumSize();
  const fields = getPodiumFieldConfig().slice(0, size);
  const payload = { leagueId, first: null, second: null, third: null, fourth: null };

  fields.forEach(field => {
    payload[field.key] = document.getElementById(field.id)?.value || null;
  });

  if (!fields.some(field => payload[field.key])) {
    return toast('Selecione ao menos uma posição do pódio', 'warning');
  }

  try {
    const res = await api.post('/api/points/process-podium', payload);
    if (!res.success) throw new Error(res.message);
    toast(`Pódio da liga ${leagueId} atualizado com sucesso`, 'success');
    closeModal('set-podium-modal');
  } catch (err) {
    toast(err.message || 'Erro ao atualizar pódio', 'error');
  }
}

async function resetOfficialPodium() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  if (!confirm(`Zerar pódio oficial da liga ${leagueId}?`)) return;

  try {
    const res = await api.post('/api/points/podium/reset', { leagueId });
    if (!res.success) throw new Error(res.message);

    getPodiumFieldConfig().forEach(field => {
      const el = document.getElementById(field.id);
      if (el) el.value = '';
    });
    toast(`Pódio da liga ${leagueId} zerado`, 'success');
  } catch (err) {
    toast('Erro ao zerar pódio', 'error');
  }
}

async function recalculateAllPoints() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  try {
    const res = await api.post('/api/points/recalculate-all', { leagueId });
    if (!res.success) throw new Error(res.message || 'Erro ao recalcular');
    toast(`Pontos da liga ${leagueId} recalculados`, 'success');
  } catch (err) {
    toast(err.message || 'Erro ao recalcular', 'error');
  }
}

async function checkDataIntegrity() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  try {
    const res = await api.get(`/api/points/integrity-check?leagueId=${leagueId}`);
    if (!res.success) throw new Error(res.message || 'Erro na verificação');
    toast(`Integridade da liga ${leagueId} OK`, 'success');
  } catch (err) {
    toast(err.message || 'Erro na verificação', 'error');
  }
}

async function openSetPodiumModal() {
  await loadLeagueSettings();
  renderOfficialPodiumFields();
  populatePodiumSelects();
  await loadOfficialPodiumIntoModal();
  openModal('set-podium-modal');
}

async function resetAllBets() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  if (!confirm(`⚠️ APAGAR TODOS OS PALPITES DA LIGA ${leagueId}?`)) return;

  try {
    const res = await api.post('/api/bets/admin/reset-all', { leagueId });
    if (!res.success) throw new Error(res.message || 'Erro ao resetar');
    toast(`Apostas da liga ${leagueId} resetadas`, 'success');
    if (typeof loadAdminMatches === 'function') await loadAdminMatches();
  } catch (err) {
    toast(err.message || 'Erro ao resetar', 'error');
  }
}

// --- FUNCIONALIDADE DE WHITELIST (CONVITES) ---

async function openWhitelistModal() {
  const modalHtml = `
    <div id="modal-whitelist" class="modal active">
      <div class="modal-content card">
        <div class="modal-header">
          <h3>👤 Gerenciar Convidados</h3>
          <button class="close-modal" onclick="document.getElementById('modal-whitelist').remove()">&times;</button>
        </div>
        <div class="admin-form-group" style="margin: 20px 0; display: flex; gap: 8px; flex-wrap: wrap;">
          <input type="email" id="wl-email" placeholder="E-mail do amigo" class="admin-input" style="flex:1; padding:10px; border-radius:8px; border:1px solid #444; background:#222; color:#fff;">
          <input type="text" id="wl-label" placeholder="Nome (opcional)" class="admin-input" style="flex:1; padding:10px; border-radius:8px; border:1px solid #444; background:#222; color:#fff;">
          <button id="btn-save-wl" class="btn btn-success">Autorizar</button>
        </div>
        <h4 style="margin-bottom:10px;">E-mails Autorizados</h4>
        <div id="wl-list-container" style="max-height: 250px; overflow-y: auto; background: #1a1a1a; padding: 10px; border-radius: 8px;">
          <p style="text-align:center; color:#888;">Carregando lista...</p>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  loadWhitelist();

  document.getElementById('btn-save-wl').onclick = async () => {
    const email = document.getElementById('wl-email').value.trim().toLowerCase();
    const label = document.getElementById('wl-label').value.trim();
    if (!email) return toast('Digite um e-mail válido', 'error');

    try {
      const res = await api.post('/api/auth/whitelist', { email, label });
      if (res.success) {
        toast('E-mail autorizado!', 'success');
        document.getElementById('wl-email').value = '';
        document.getElementById('wl-label').value = '';
        loadWhitelist();
      } else {
        toast(res.message || 'Erro ao autorizar', 'error');
      }
    } catch (err) {
      toast('Falha na comunicação com o servidor', 'error');
    }
  };
}

async function loadWhitelist() {
  const container = document.getElementById('wl-list-container');
  try {
    const res = await api.get('/api/auth/whitelist');
    if (res.success && res.emails.length > 0) {
      container.innerHTML = res.emails.map(item => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #333;">
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight:bold; color:#fff;">${item.label || 'Convidado'}</span>
            <span style="font-size:12px; color:#aaa;">${item.email}</span>
          </div>
          <span style="font-size:10px; color:#666;">${new Date(item.createdAt).toLocaleDateString()}</span>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">Nenhum convidado na lista.</p>';
    }
  } catch (err) {
    container.innerHTML = '<p style="text-align:center; color: #ff4444;">Erro ao carregar lista.</p>';
  }
}

/* ============================
   📊 ADMIN — TOGGLE STATS LOCK
============================ */

async function loadStatsLockStatus() {
  const btn = document.getElementById('btn-toggle-stats-lock');
  if (!btn) return;
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  try {
    const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
    if (res && res.success) {
      const locked = res.data?.statsLocked === true;
      updateStatsBtnUI(locked);
    }
  } catch (err) {
    console.error('Erro ao carregar stats lock:', err);
  }
}

function updateStatsBtnUI(isLocked) {
  const btn = document.getElementById('btn-toggle-stats-lock');
  if (!btn) return;
  if (isLocked) {
    btn.innerText = '📊🔒'; 
    btn.style.backgroundColor = '#e03131';
    btn.style.color = 'white';
    btn.title = 'Estatísticas BLOQUEADAS';
  } else {
    btn.innerText = '📊'; 
    btn.style.backgroundColor = '#fcc419';
    btn.style.color = 'black';
    btn.title = 'Estatísticas LIBERADAS';
  }
}

async function toggleStatsLock() {
  const btn = document.getElementById('btn-toggle-stats-lock');
  if (!btn) return;
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  const isCurrentlyLocked = btn.style.backgroundColor === 'rgb(224, 49, 49)' || btn.style.backgroundColor === '#e03131';
  const newValue = !isCurrentlyLocked;

  try {
    const res = await api.post('/api/settings/global', { leagueId, statsLocked: newValue, lockedReason: newValue ? 'ADMIN_LOCK' : null });
    if (res.success) {
      updateStatsBtnUI(newValue);
      toast(newValue ? `Estatísticas da liga ${leagueId} bloqueadas!` : `Estatísticas da liga ${leagueId} liberadas!`, 'info');
    }
  } catch (err) {
    console.error('Erro ao salvar stats lock:', err);
    toast('Erro ao alterar trava', 'error');
  }
}

function openEmailModal() {
  const oldModal = document.getElementById('modal-email');
  if (oldModal) oldModal.remove();

  const modalHtml = `
    <div id="modal-email" class="modal active">
      <div class="modal-content card" style="max-width: 550px;">
        <div class="modal-header">
          <h3>✉️ Enviar Comunicado Geral</h3>
          <button class="close-modal" onclick="document.getElementById('modal-email').remove()">&times;</button>
        </div>
        <form id="form-broadcast" style="display:flex; flex-direction:column; gap:12px; margin-top:15px;">
          <input type="text" id="email-subject" placeholder="Assunto do E-mail" required class="admin-input">
          <textarea id="email-message" placeholder="Escreva aqui..." rows="6" required class="admin-input" style="resize: vertical;"></textarea>
          <div style="border: 1px dashed #555; padding: 10px; border-radius: 5px; background: rgba(0,0,0,0.2);">
            <label style="display:block; font-size:12px; margin-bottom:5px; color:#aaa;">Anexar arquivo:</label>
            <input type="file" id="email-attachment">
          </div>
          <button type="submit" id="btn-send-email" class="btn btn-success" style="margin-top:10px;">🚀 Enviar para Todos</button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  document.getElementById('form-broadcast').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-send-email');
    const subject = document.getElementById('email-subject').value;
    const message = document.getElementById('email-message').value;
    const fileInput = document.getElementById('email-attachment');

    const formData = new FormData();
    formData.append('subject', subject);
    formData.append('message', message);
    if (fileInput.files[0]) formData.append('attachment', fileInput.files[0]);

    try {
      btn.disabled = true;
      btn.innerText = '⏳ Enviando...';
      const res = await api.post('/api/admin/send', formData);
      if (res.success) {
        alert('✅ E-mails enviados!');
        document.getElementById('modal-email').remove();
      }
    } catch (err) {
      console.error('Erro no envio:', err);
      const msg = err.data?.message || err.message || 'Erro ao conectar com o servidor';
      alert('❌ Erro: ' + msg);
    } finally {
      btn.disabled = false;
      btn.innerText = '🚀 Enviar para Todos';
    }
  };
}

/* ============================================================
   GESTÃO DE PAGAMENTOS
   ============================================================ */

export async function loadAdminUsers() {
    const section = document.getElementById('admin-users-section');
    const container = document.getElementById('admin-users-list');
    if (!container || !section) return;

    if (section.style.display === 'block') {
        section.style.display = 'none';
        return; 
    }

    section.style.display = 'block';
    container.innerHTML = '<p style="text-align:center; color:#888; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Carregando...</p>';

    try {
        const response = await api.get('/api/admin/users');
        const users = response.users || [];

        if (!users || users.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#888;">Nenhum usuário encontrado.</p>';
            return;
        }

        container.innerHTML = users.map(user => `
            <div class="user-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #222; border-radius: 8px; margin-bottom: 8px; border-left: 4px solid ${user.hasPaid ? '#00ff00' : '#ffcc00'};">
                <div style="display: flex; flex-direction: column;">
                    <strong style="color: #fff;">${user.name || 'Sem Nome'}</strong>
                    <span style="font-size: 12px; color: #888;">${user.email}</span>
                </div>
                <div>
                    ${user.hasPaid 
                        ? '<span style="color: #00ff00; font-weight: bold;">✅ PAGO</span>' 
                        : `<button class="btn btn-success btn-sm" onclick="handleApproveUser('${user._id}', '${user.name}')">Aprovar PIX</button>`
                    }
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error("Erro ao carregar usuários:", err);
        toast("Erro ao carregar usuários", "error");
        section.style.display = 'none';
    }
}

window.handleApproveUser = async (id, name) => {
    if (!confirm(`Confirmar pagamento de ${name}?`)) return;
    try {
        const res = await api.put(`/api/admin/approve-user/${id}`);
        if (res.success || res.message) {
            toast(`Acesso liberado para ${name}!`, "success");
            loadAdminUsers();
        }
    } catch (err) {
        toast(err.message || "Erro na aprovação", "error");
    }
};

window.loadAdminUsers = loadAdminUsers;

/* ============================================================
   MODAL DE DETALHES DE APOSTAS
   ============================================================ */
window.showMatchBetsModal = async function(matchId, matchName) {
    try {
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!leagueId) {
        console.error("League ID não encontrado no localStorage.");
        return;
    }

    const [usersRes, allBetsRes] = await Promise.all([
        api.get(`/api/bets/users-for-filter?leagueId=${leagueId}`), 
        api.get(`/api/bets/all-bets?matchId=${matchId}&leagueId=${leagueId}`)
    ]);

        const allUsers = usersRes.data || [];
        const betsData = allBetsRes.data || [];
        const usersWhoBet = new Set(betsData.map(b => b.userName));

        let listHtml = `
            <div style="max-height: 450px; overflow-y: auto; padding: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 12px; color: #aaa; border-bottom: 1px solid #333; padding-bottom: 10px;">
                    <span><i class="fas fa-circle" style="color: #2ecc71;"></i> Apostou</span>
                    <span><i class="fas fa-circle" style="color: #e74c3c;"></i> Pendente</span>
                </div>
                <div class="list-group">
        `;

        allUsers.sort((a, b) => a.name.localeCompare(b.name)).forEach(user => {
            const hasBet = usersWhoBet.has(user.name);
            const color = hasBet ? '#2ecc71' : '#e74c3c';
            const icon = hasBet ? 'fa-check-circle' : 'fa-times-circle';
            listHtml += `
                <div class="list-group-item" style="background: #1a1a1a; border: 1px solid #333; color: white; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; padding: 12px; border-radius: 8px;">
                    <span style="color: ${color}; font-weight: 500;"><i class="fas ${icon} me-2"></i> ${user.name}</span>
                    <span style="font-size: 11px; color: ${color}; border: 1px solid ${color}44; padding: 2px 8px; border-radius: 10px; background: ${hasBet ? 'rgba(46, 204, 113, 0.05)' : 'rgba(231, 76, 60, 0.05)'}">${hasBet ? 'CONFIRMADO' : 'PENDENTE'}</span>
                </div>
            `;
        });

        listHtml += `</div></div>`;

        const titleEl = document.getElementById('modal-match-bets-title');
        const bodyEl = document.getElementById('modal-match-bets-body');
        if (titleEl) titleEl.innerText = `Apostas: ${matchName}`;
        if (bodyEl) bodyEl.innerHTML = listHtml;
        openModal('modal-match-bets');
    } catch (err) {
        console.error('Erro ao processar lista de apostas:', err);
        if (typeof toast === 'function') toast('Erro ao carregar dados', 'error');
    }
};

/* ============================================================
   GERENCIAMENTO DO ROBÔ (API)
   ============================================================ */

async function openRobotSettings() {
    try {
        const container = document.getElementById('robot-leagues-container');
        const multiSelect = document.getElementById('input-api-leagues-multi');
        if (container) container.innerHTML = '<p class="text-center w-100"><i class="fas fa-spinner fa-spin"></i> Carregando ligas...</p>';

        const [resSettings, resLeagues] = await Promise.all([
            api.get(`/api/settings/global?leagueId=${localStorage.getItem('selectedLeagueId') || '1'}`),
            api.get('/api/admin/robot/available-leagues')
        ]);

        if (resLeagues.success && resLeagues.results) {
            renderRobotLeagues(resLeagues.results);
            setupLeagueSelects(resLeagues.results);
        }

        if (resSettings.success && resSettings.data) {
            const s = resSettings.data;
            document.getElementById('input-cron-interval').value = s.cron_interval || 5;
            document.getElementById('input-api-season').value = s.api_season || 2026;
            if (multiSelect && s.api_leagues) {
                Array.from(multiSelect.options).forEach(opt => {
                    opt.selected = s.api_leagues.includes(parseInt(opt.value));
                });
            }
            const lastRunDisplay = document.getElementById('last-run-display');
            if (lastRunDisplay) {
                lastRunDisplay.innerText = s.last_api_run > 0 
                    ? new Date(s.last_api_run).toLocaleString('pt-BR') 
                    : 'Nunca executado';
            }
        }
        openModal('robot-settings-modal');
    } catch (err) {
        console.error('Erro ao carregar settings:', err);
        toast('Erro ao carregar configurações do robô', 'error');
    }
}

function renderRobotLeagues(leagues) {
    const container = document.getElementById('robot-leagues-container');
    if (!container) return;
    container.innerHTML = '';
    leagues.sort((a, b) => a.name.localeCompare(b.name));
    leagues.forEach(league => {
        const div = document.createElement('div');
        div.className = 'col-md-4 mb-2';
        div.innerHTML = `
            <div class="form-check">
                <input class="form-check-input robot-league-checkbox" type="checkbox" value="${league.id}" id="league-${league.id}" data-name="${league.name}">
                <label class="form-check-label" for="league-${league.id}" style="cursor:pointer">${league.name}</label>
            </div>
        `;
        container.appendChild(div);
    });
}

function setupLeagueSelects(leagues) {
    const multiSelect = document.getElementById('input-api-leagues-multi');
    if (!multiSelect) return;
    multiSelect.innerHTML = leagues.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
}

async function saveRobotSettings() {
    const multiSelect = document.getElementById('input-api-leagues-multi');
    const leaguesArray = Array.from(multiSelect.selectedOptions).map(opt => parseInt(opt.value));
    const payload = {
        leagueId: localStorage.getItem('selectedLeagueId') || '1',
        cron_interval: Number(document.getElementById('input-cron-interval').value),
        api_season: Number(document.getElementById('input-api-season').value),
        api_leagues: leaguesArray
    };
    try {
        const res = await api.post('/api/settings/global', payload);
        if (res.success) {
            toast('Configurações atualizadas!', 'success');
            closeModal('robot-settings-modal');
        }
    } catch (err) {
        console.error('Erro ao salvar settings:', err);
        toast('Erro ao salvar configurações', 'error');
    }
}

async function runRobotSync() {
    const selectedCheckboxes = document.querySelectorAll('.robot-league-checkbox:checked');
    const elFrom = document.getElementById('robot-date-from');
    const elTo = document.getElementById('robot-date-to');
    const elPhase = document.getElementById('sync-match-phase');
    const elKnockout = document.getElementById('sync-match-group-knockout');
    const loader = document.getElementById('robot-sync-loader');

    if (selectedCheckboxes.length === 0) return toast("Selecione pelo menos uma liga!", "error");
    if (!elFrom?.value || !elTo?.value) return toast("Preencha as datas!", "error");

    const dateFrom = elFrom.value;
    const dateTo = elTo.value;
    const selectedPhase = elPhase ? elPhase.value : 'auto';
    const isPointsRun = (selectedPhase === 'points_run');
    // Pontos corridos é uma fase própria. Não converter para 'group',
    // pois isso faz as partidas serem persistidas/renderizadas como grupos.
    const phaseToApi = isPointsRun ? 'pontos_corridos' : selectedPhase;
    const knockoutPhase = elKnockout ? elKnockout.value : null;

    if (loader) loader.style.display = 'block';
    let totalCriados = 0;
    let totalAtualizados = 0;

    try {
        for (const cb of selectedCheckboxes) {
            const leagueId = cb.value;
            const leagueName = cb.getAttribute('data-name');
            toast(`Sincronizando: ${leagueName}...`, 'info');

            const payload = { 
                leagueId, leagueName, dateFrom, dateTo,
                phaseType: phaseToApi,
                knockoutPhase: phaseToApi === 'knockout' ? knockoutPhase : null,
                unifyGroups: isPointsRun,
                isPointsRun: isPointsRun 
            };

            const res = await api.post('/api/admin/robot/sync', payload);
            if (res && res.success) {
                totalCriados += res.details?.criados || 0;
                totalAtualizados += res.details?.atualizados || 0;
            }
        }

        toast(`✅ Sincronia concluída! Criados: ${totalCriados} | Atualizados: ${totalAtualizados}`, 'success');
        if (typeof closeModal === 'function') closeModal('robot-settings-modal');
        if (typeof loadAdminMatches === 'function') await loadAdminMatches();
    } catch (err) {
        console.error('Erro na sincronização:', err);
        toast('Erro ao processar sincronização.', 'error');
    } finally {
        if (loader) loader.style.display = 'none';
    }
}


function updateAdminBulkBar() {
  const bar = document.getElementById('admin-bulk-bar');
  if (!bar) return;
  const count = selectedAdminMatchIds.size;
  const countEl = bar.querySelector('[data-admin-selected-count]');
  if (countEl) countEl.textContent = `${count} selecionada${count === 1 ? '' : 's'}`;
  bar.classList.toggle('is-visible', count > 0);
}

window.toggleAdminSelectionMode = function() {
  adminMatchSelectionMode = !adminMatchSelectionMode;
  if (!adminMatchSelectionMode) {
    selectedAdminMatchIds.clear();
  }
  renderAdminMatches(AdminState.matches);
  updateAdminBulkBar();
};

window.toggleAdminMatchSelection = function(matchId, checked) {
  const id = String(matchId);
  if (checked) selectedAdminMatchIds.add(id);
  else selectedAdminMatchIds.delete(id);
  const card = document.querySelector(`#admin-matches-list .admin-match-card[data-match-id="${id}"]`);
  if (card) card.classList.toggle('is-selected', checked);
  updateAdminBulkBar();
};

window.toggleAdminGroupSelection = function(input, ids) {
  const shouldSelect = Boolean(input.checked);
  (ids || []).forEach(id => {
    const key = String(id);
    if (shouldSelect) selectedAdminMatchIds.add(key);
    else selectedAdminMatchIds.delete(key);
  });
  renderAdminMatches(AdminState.matches);
};

window.toggleAdminSection = function(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('is-collapsed');
};

window.openAdminMatchesPanel = async function() {
  const panel = document.getElementById('admin-matches-panel');
  if (!panel) return;
  adminMatchesPanelOpen = true;
  panel.hidden = false;
  panel.classList.add('is-open');
  await loadAdminMatches();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.closeAdminMatchesPanel = function() {
  const panel = document.getElementById('admin-matches-panel');
  if (!panel) return;
  adminMatchesPanelOpen = false;
  panel.classList.remove('is-open');
  panel.hidden = true;
  selectedAdminMatchIds.clear();
  adminMatchSelectionMode = false;
  updateAdminBulkBar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

async function bulkSelectedMatches(action) {
  const ids = [...selectedAdminMatchIds].map(Number).filter(Number.isInteger);
  if (!ids.length) {
    toast('Selecione pelo menos uma partida.', 'info');
    return;
  }
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  const isReopen = action === 'reopen';
  if (!confirm(
    `⚠️ ${isReopen ? 'REABRIR' : 'EXCLUIR'} ${ids.length} partida(s)?\n\n` +
    (isReopen
      ? 'Os placares e pontos dessas partidas serão limpos.'
      : 'A exclusão é definitiva e remove essas partidas dos palpites.')
  )) return;

  try {
    const res = isReopen
      ? await api.post('/api/matches/admin/unfinish-bulk', { leagueId, matchIds: ids })
      : await api.del('/api/matches/admin/delete-bulk', { leagueId, matchIds: ids });

    selectedAdminMatchIds.clear();
    toast(res.message || (isReopen ? 'Partidas reabertas.' : 'Partidas excluídas.'), 'success');
    await loadAdminMatches();
  } catch (err) {
    console.error('Erro na ação em lote:', err);
    toast(err.message || 'Erro ao executar ação em lote.', 'error');
  }
}

window.bulkUnfinishSelected = () => bulkSelectedMatches('reopen');
window.bulkDeleteSelected = () => bulkSelectedMatches('delete');

function updateBetLockVisual(blocked) {
  const btn = document.getElementById('btn-toggle-save-bets');
  if (!btn) return;
  btn.classList.toggle('is-locked', !!blocked);
  btn.classList.toggle('is-unlocked', !blocked);
  const icon = btn.querySelector('i');
  if (icon) icon.className = blocked ? 'fas fa-lock' : 'fas fa-unlock';
  btn.setAttribute('aria-label', blocked ? 'Palpites bloqueados' : 'Palpites liberados');
}

// EXCLUIR LIGA OU GRUPO
async function bulkDelete(params) {
    const scope = params.roundNumber
      ? `a rodada ${params.roundNumber}`
      : params.groupName
        ? `o grupo "${params.groupName}"`
        : `a liga "${params.leagueName}"`;
    if (!confirm(`⚠️ EXCLUSÃO DEFINITIVA: Deseja apagar todas as partidas de ${scope}?`)) return;
    try {
        const res = await api.del('/api/matches/admin/delete-bulk', params);
        if (res.success) {
            toast(res.message || 'Excluído com sucesso', 'success');
            await loadAdminMatches();
        }
    } catch (err) {
        console.error('Erro no bulkDelete:', err);
        toast(err.message || "Erro ao excluir", 'error');
    }
}

async function bulkUnfinish(params) {
    const scope = params.roundNumber
      ? `a rodada ${params.roundNumber}`
      : params.groupName
        ? `o grupo "${params.groupName}"`
        : `a liga "${params.leagueName}"`;
    if (!confirm(`Deseja REABRIR (limpar placares e pontos) de ${scope}?`)) return;
    try {
        const res = await api.post('/api/matches/admin/unfinish-bulk', params);
        if (res.success) {
            toast(res.message || 'Partidas reabertas', 'success');
            await loadAdminMatches();
        }
    } catch (err) {
        console.error('Erro no bulkUnfinish:', err);
        toast("Erro ao reabrir", 'error');
    }
}

window.bulkDelete = bulkDelete;
window.bulkUnfinish = bulkUnfinish;
window.openRobotSettings = openRobotSettings;
window.saveRobotSettings = saveRobotSettings;
window.switchRobotTab = switchRobotTab;
window.runRobotSync = runRobotSync;
window.loadAdminMatches = loadAdminMatches;
window.editMatch = editMatch;
window.prepareFinishMatch = prepareFinishMatch;
window.adminUnfinishMatch = adminUnfinishMatch;
window.adminDeleteMatchForce = adminDeleteMatchForce;
window.resetOfficialPodium = resetOfficialPodium;
window.recalculateAllPoints = recalculateAllPoints;
window.checkDataIntegrity = checkDataIntegrity;
window.resetAllBets = resetAllBets;
window.renderAdminMatches = renderAdminMatches;

export { openAddMatchModal, openFinishMatchModal, openSetPodiumModal };

window.toggleAdminCardActions = function(cardEl, event) {
  if (
    event.target.closest('.admin-row-actions') ||
    event.target.closest('button') ||
    event.target.closest('.team-logo') ||
    event.target.closest('img') ||
    event.target.closest('.badge')
  ) {
    return;
  }

  // No modo de seleção, o card inteiro funciona como área de seleção.
  if (adminMatchSelectionMode) {
    const checkbox = cardEl.querySelector('.admin-match-select input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
      window.toggleAdminMatchSelection(cardEl.dataset.matchId, checkbox.checked);
    }
    return;
  }

  // No modo normal, tocar no card revela apenas as ações daquele card.
  const allCards = document.querySelectorAll('#admin-matches-list .admin-match-card');
  allCards.forEach(c => { if (c !== cardEl) c.classList.remove('active-actions'); });
  cardEl.classList.toggle('active-actions');
};