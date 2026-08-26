/* ============================================================
   DUELO RENDERER — VERSÃO FINAL (COMPLETA E INTEGRADA)
   ============================================================ */

import { renderTeamMedia } from '../matches4.js';

let currentDuelPhase = 'group';
let currentRenderContext = null;

/* ============================================================
   HELPERS
   ============================================================ */

function normalizeResult(v) {
  if (!v || v === '—' || v === '🔒') return null;
  const c = String(v).toLowerCase();
  if (c === 'a') return 'A';
  if (c === 'b') return 'B';
  if (c === 'draw' || c === 'empate') return 'draw';
  return null;
}

function computeWinnerFromScore(scoreA, scoreB) {
  if (typeof scoreA !== 'number' || typeof scoreB !== 'number') return null;
  if (scoreA > scoreB) return 'A';
  if (scoreB > scoreA) return 'B';
  return 'draw';
}

/**
 * Renderiza o palpite (Logo ou Placar)
 */
function labelForWinner(betObj, teamA, teamB, logoA, logoB) {
  const val = typeof betObj === 'object' ? betObj.winner : betObj;
  
  if (!val || val === '—') return '—';
  if (val === '🔒') return `<span class="locked-bet"><i class="fas fa-lock"></i></span>`;

  if (typeof betObj === 'object' && betObj.scoreA !== undefined && betObj.scoreB !== undefined && betObj.scoreA !== '?') {
    return `<span class="score-bet-label">${betObj.scoreA} x ${betObj.scoreB}</span>`;
  }

  const c = String(val).toUpperCase();
  if (c === 'A') return `<div class="duel-bet-logo-only">${renderTeamMedia(teamA, logoA)}</div>`;
  if (c === 'B') return `<div class="duel-bet-logo-only">${renderTeamMedia(teamB, logoB)}</div>`;
  if (c === 'DRAW' || c === 'EMPATE') return '<span class="draw-label-mini">🤝</span>';
  return val;
}

function renderKnockoutBet(bet, match) {
  if (!bet || bet === '—') return '—';
  if (bet === '🔒' || bet.winner === '🔒' || bet.qualifier === '🔒') {
    return `<span class="locked-bet"><i class="fas fa-lock"></i></span>`;
  }

  const winnerLabel = labelForWinner(bet, match.teamA, match.teamB, match.logoA, match.logoB);
  const qualifiedLabel = labelForWinner(bet.qualifier, match.teamA, match.teamB, match.logoA, match.logoB);

  if (bet.winner && bet.qualifier && normalizeResult(bet.winner) === normalizeResult(bet.qualifier)) {
    return `<div class="qualified-only-logo">${qualifiedLabel}</div>`;
  }

  return `
    <div class="knockout-bet-detail-mini">
      <div class="mini-row">V: ${winnerLabel}</div>
      <div class="mini-row">P: ${qualifiedLabel}</div>
    </div>
  `;
}

export function renderDuelInterface(
  visitedBets,
  myBets,
  allMatches,
  targetName,
  containerId = 'duel-bets-list'
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const unlockedPhases = window.STATE?.settings?.unlockedPhases || [];

  container.innerHTML = `
    <div class="duel-phase-nav">
      <button class="phase-btn ${currentDuelPhase === 'group' ? 'active' : ''}" data-phase="group">Grupos / Rodadas</button>
      <button class="phase-btn ${currentDuelPhase === 'knockout' ? 'active' : ''}" data-phase="knockout">Mata-mata</button>
    </div>
    <div id="duel-accordion-container"></div>
  `;

  const accordionRoot = container.querySelector('#duel-accordion-container');

  function renderPhase() {
    const matchesToShow = allMatches.filter(m =>
      currentDuelPhase === 'group' ? (m.phase === 'group' || m.phase === 'pontos_corridos') : m.phase !== 'group'
    );

    const groups = {};
    matchesToShow.forEach(m => {
      let title = m.phaseName;

      // Se o phaseName for exatamente "FASE DE GRUPOS", desconsidera para usar o grupo específico
      if (title && title.trim().toUpperCase() === 'FASE DE GRUPOS') {
        title = null;
      }

      // Fallback: se não houver phaseName (ou se foi anulado acima), usa o Grupo ou a Phase
      if (!title) {
        title = m.group ? ` ${m.group}` : m.phase;
      }

      if (!groups[title]) groups[title] = [];
      groups[title].push(m);
    });

    // Ordena os títulos dos acordeões em ordem alfabética (Grupo A, Grupo B, etc.)
    const sortedGroupTitles = Object.keys(groups).sort((a, b) => a.localeCompare(b));

    accordionRoot.innerHTML = sortedGroupTitles
      .map(groupTitle => `
        <div class="duel-accordion-item open">
          <div class="duel-accordion-header" onclick="this.parentElement.classList.toggle('open')">
            <span>${groupTitle.replace(/-/g, ' ').toUpperCase()}</span>
            <i class="fas fa-chevron-down"></i>
          </div>
          <div class="duel-accordion-body">
            ${groups[groupTitle].map(renderMatch).join('')}
          </div>
        </div>
      `).join('');
  }

  function renderMatch(m) {
    // 🛡️ CORREÇÃO DEFINITIVA DE PRIVACIDADE:
    // Se o backend enviar isLocked: false, NADA no frontend deve trancar.
    const isLockedByBackend = (m.isLocked === true);
    
    // Fallback apenas se o backend não enviou a info: checa window.STATE
    const isPhaseUnlocked = unlockedPhases.includes('group') || 
                            unlockedPhases.includes(m.group) || 
                            unlockedPhases.includes(m.phaseName);

    // O jogo só será visível se NÃO estiver trancado pelo backend OU se a fase estiver liberada explicitamente
    const isVisible = !isLockedByBackend || isPhaseUnlocked || m.status === 'finished';

    const bV_raw = visitedBets.find(b => Number(b.matchId) === Number(m.matchId)) || {};
    const bM = myBets.find(b => Number(b.matchId) === Number(m.matchId)) || {};

    // Se NÃO estiver visível, forçamos o objeto bV (Rival) a ter o cadeado
    const bV = (!isVisible) 
        ? { ...bV_raw, winner: '🔒', qualifier: '🔒', choice: '🔒', scoreA: '?', scoreB: '?' } 
        : bV_raw;

    const logoA = renderTeamMedia(m.teamA, m.logoA);
    const logoB = renderTeamMedia(m.teamB, m.logoB);

    const labelV = currentDuelPhase === 'knockout' ? renderKnockoutBet(bV, m) : labelForWinner(bV, m.teamA, m.teamB, m.logoA, m.logoB);
    const labelM = currentDuelPhase === 'knockout' ? renderKnockoutBet(bM, m) : labelForWinner(bM, m.teamA, m.teamB, m.logoA, m.logoB);

    let isLocked = (bV.winner === '🔒');
    let isSameBet = false;

    if (!isLocked && (bV.winner || bV.scoreA !== undefined) && (bM.winner || bM.scoreA !== undefined)) {
        const resV = normalizeResult(bV.winner) || computeWinnerFromScore(Number(bV.scoreA), Number(bV.scoreB));
        const resM = normalizeResult(bM.winner) || computeWinnerFromScore(Number(bM.scoreA), Number(bM.scoreB));
        
        const sameWin = resV === resM && resV !== null;
        const sameScore = Number(bV.scoreA) === Number(bM.scoreA) && Number(bV.scoreB) === Number(bM.scoreB);
        
        isSameBet = (bV.scoreA !== undefined && bV.scoreA !== '?' && bM.scoreA !== undefined) ? sameScore : sameWin;
    }

    const icon = isLocked ? '<i class="fas fa-lock" style="color: #888; font-size:0.9rem;"></i>' : (isSameBet ? '🤝' : '⚔️');
    const scoreDisplay = (m.status === 'finished' || String(m.status).includes('tempo') || m.status === 'intervalo') 
        ? `${m.scoreA ?? 0} x ${m.scoreB ?? 0}` 
        : 'VS';

    let duelSplitClass = 'duel-pending';
    if (m.status === 'finished') {
        const realWinner = computeWinnerFromScore(m.scoreA, m.scoreB);
        const realQual = m.qualifiedSide || m.qualifiedTeam;

        const getColor = (bet, isRival = false) => {
            if (isRival && (bet.winner === '🔒' || !bet.winner)) return 'pending';
            if (!bet || (bet.winner === '—' && bet.scoreA === undefined)) return 'pending';
            
            const betWin = normalizeResult(bet.winner) || computeWinnerFromScore(Number(bet.scoreA), Number(bet.scoreB));

            if (currentDuelPhase === 'group') {
                return betWin === realWinner ? 'green' : 'red';
            } else {
                const winHit = betWin === realWinner ? 1 : 0;
                const qualHit = normalizeResult(bet.qualifier) === normalizeResult(realQual) ? 1 : 0;
                const total = winHit + qualHit;
                return total === 2 ? 'green' : (total === 1 ? 'yellow' : 'red');
            }
        };
        duelSplitClass = `duel-split-${getColor(bV, true)}-${getColor(bM)}`;
    }

    return `
      <div class="chip ${duelSplitClass} ${isSameBet ? 'match-concordance' : ''}">
        <div class="match-main-info" style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <div class="team-side-left" style="display: flex; align-items: center; gap: 8px; flex: 1; justify-content: flex-end;">
            <strong style="text-align: right;">${m.teamA}</strong>
            <div class="flag-mini">${logoA}</div>
          </div>
          <span class="duel-score-pill">${scoreDisplay}</span>
          <div class="team-side-right" style="display: flex; align-items: center; gap: 8px; flex: 1; justify-content: flex-start;">
            <div class="flag-mini">${logoB}</div>
            <strong style="text-align: left;">${m.teamB}</strong>
          </div>
        </div>
        <div class="comparison-grid" style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-top: 8px;">
          <div class="user-bet" style="text-align: right;">
            <div class="label-side">${targetName?.split(' ')[0].toUpperCase() || 'RIVAL'}:</div>
            <div class="val-content" style="display: flex; justify-content: flex-end;">${labelV}</div>
          </div>
          <div class="status-icon" style="padding: 0 15px;">${icon}</div>
          <div class="user-bet" style="text-align: left;">
            <div class="label-side">VOCÊ:</div>
            <div class="val-content" style="display: flex; justify-content: flex-start;">${labelM}</div>
          </div>
        </div>
      </div>
    `;
  }

  container.querySelectorAll('.phase-btn').forEach(btn => {
    btn.onclick = () => {
      currentDuelPhase = btn.dataset.phase;
      container.querySelectorAll('.phase-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPhase();
    };
  });

  currentRenderContext = { container, renderPhase };
  renderPhase();
}