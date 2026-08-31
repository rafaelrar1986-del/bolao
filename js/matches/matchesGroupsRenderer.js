/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesGroupsRenderer(ctx = {}) {
  const get = (name) => ctx[name];

  function renderMatches(openedGroups = []) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, calculateScoringMatchPointsForUI, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules, winnerDerivesFromScore, deriveWinnerFromScoreData, calcLivePoints, getGroupPhaseProgress, updateGroupProgressUI, updateBetsCounters, renderFilterHeader, renderGroupPredictionSection, refreshPredictedGroupForMatch, bindAllGroupPredictionSections, renderGroupCard } = ctx;
    if (!STATE.hasSubmitted) STATE.groupFilter = 'group';

    const wrap = $('#matches-container');
    if (!wrap) return;

    wrap.innerHTML = '';

    let list = (STATE.matches || []).filter(m => !isKnockoutMatch(m));

    // Disponibilidade por rodada:
    // - grupos usam unlockedGroupRounds
    // - pontos corridos usam unlockedPointsRunRounds
    // O modo "all" não restringe a lista.
    list = list.filter(m => {
      const phase = String(m.phase || '').toLowerCase();
      const isGroup = phase === 'group';
      const isPointsRun = phase === 'pontos_corridos' || phase === 'points_run';

      if (!isGroup && !isPointsRun) return true;

      const mode = isGroup
        ? STATE.groupBetAvailabilityMode
        : STATE.pointsRunBetAvailabilityMode;

      if (mode !== 'round') return true;

      const round = Number(m.roundNumber);
      if (!Number.isInteger(round) || round <= 0) return false;

      const unlocked = isGroup
        ? STATE.unlockedGroupRounds
        : STATE.unlockedPointsRunRounds;
      const locked = isGroup
        ? STATE.lockedGroupRounds
        : STATE.lockedPointsRunRounds;

      return unlocked.has(round) && !locked.has(round);
    });

    const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'];

    if (STATE.groupFilter === 'live') {
      list = list.filter(m => liveStatuses.includes(m.status));
    } 
    else if (STATE.hasSubmitted && STATE.groupFilter === 'date' && STATE.groupStatusFilter === 'pending') {
      list = list.filter(m => m.status === 'scheduled');
    }

    if (!list.length) {
      let emptyHtml = renderFilterHeader();
      const msg = STATE.groupFilter === 'live' 
        ? 'Nenhuma partida ao vivo no momento para este torneio.' 
        : 'Nenhuma partida encontrada.';
      emptyHtml += `<div style="text-align:center; padding:40px; color:rgba(255,255,255,0.6); font-style: italic;">${msg}</div>`;
      wrap.innerHTML = emptyHtml;
      return;
    }

    let html = renderFilterHeader();
    const groups = {};
    
    list.forEach(m => {
      let key;
      // Data continua sendo agrupada exclusivamente por data.
      // Ao Vivo é agrupado por grupo para que a classificação prevista
      // possa ser mostrada uma única vez para o grupo inteiro.
      if (STATE.hasSubmitted && STATE.groupFilter === 'date') {
        const d = parseMatchDate(m);
        key = d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Sem data';
      } else {
        key = m.group || m.phaseName || 'Grupo';
      }
      (groups[key] ||= []).push(m);
    });

    html += Object.keys(groups)
      .sort((a, b) => {
        if (STATE.hasSubmitted && STATE.groupFilter === 'date') {
          const da = parseMatchDate(groups[a][0]);
          const db = parseMatchDate(groups[b][0]);
          return (da?.getTime() || 0) - (db?.getTime() || 0);
        }
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      })
      .map((groupName, index) => {
        const games = groups[groupName].slice().sort((a, b) => {
          const da = parseMatchDate(a);
          const db = parseMatchDate(b);
          return (da?.getTime() || 0) - (db?.getTime() || 0);
        });

        // No Ao Vivo, somente as partidas LIVE são exibidas, mas a
        // classificação prevista é sempre calculada sobre TODOS os jogos
        // do grupo, incluindo os ainda agendados.
        const predictionGames = STATE.groupFilter === 'live'
          ? (STATE.matches || [])
              .filter(m =>
                !isKnockoutMatch(m) &&
                String(m.group || '').trim() === String(groupName).trim()
              )
              .slice()
              .sort((a, b) => {
                const da = parseMatchDate(a);
                const db = parseMatchDate(b);
                return (da?.getTime() || 0) - (db?.getTime() || 0);
              })
          : games;

        const rules = getScoringRules();
        const totalPoints = games.reduce((sum, m) => {
          const mId = String(m.matchId);
          const choice = STATE.betsMap.get(mId) || STATE.betsMap.get(Number(mId));
          const scoreData = STATE.scoresMap.get(Number(mId)) || STATE.scoresMap.get(mId) || {};

          if (m.status === 'finished') {
            const result = calculateScoringMatchPointsForUI(
              {
                scoreA: scoreData.scoreA,
                scoreB: scoreData.scoreB,
                winner: choice
              },
              m,
              { scoringRules: rules },
              false
            );
            return sum + result.points;
          }
          else if (liveStatuses.includes(m.status)) {
            // ===== PONTOS PARCIAIS AO VIVO (alinhado com backend) =====
            const liveResult = calcLivePoints(m);
            return sum + liveResult.points;
          }

          return sum;
        }, 0);

        const wasOpen = openedGroups.includes(groupName);
        const isLiveMode = STATE.groupFilter === 'live';
        const isInitialAutoOpen = openedGroups.length === 0 && index === 0;
        const isActive = (wasOpen || isInitialAutoOpen || isLiveMode) ? 'active' : '';

        const progress = getGroupPhaseProgress(groupName, games);
        const percent = progress.mode !== 'none' && progress.total ? Math.round((progress.filled / progress.total) * 100) : 0;
        const barClass = progress.mode === 'games' ? 'progress-fill games' : 'progress-fill decisions';

        return `
          <div class="accordion-item ${isActive}" data-group="${groupName}">
            <button class="accordion-header" onclick="this.parentElement.classList.toggle('active')">
              <div class="accordion-info">
                <div class="accordion-top">
                  <span class="accordion-title">${groupName.toUpperCase()}</span>
                  ${totalPoints > 0 ? `<span class="accordion-pts">${totalPoints} pts</span>` : ''}
                </div>
                ${progress.mode !== 'none' ? `
                  <div class="phase-progress">
                    <div class="progress-bar"><div class="${barClass}" style="width:${percent}%"></div></div>
                    <span class="progress-text">${progress.filled} / ${progress.total}</span>
                  </div>
                ` : ''}
              </div>
              <i class="chevron">▼</i>
            </button>
            <div class="accordion-content">
              <div class="group-matches-grid">
                ${games.map(m => renderGroupCard(m)).join('')}
              </div>
              ${renderGroupPredictionSection(groupName, predictionGames)}
            </div>
          </div>
        `;
      }).join('');

    wrap.innerHTML = html;
    bindAllGroupPredictionSections();

    wrap.querySelectorAll('.bet-option').forEach(btn => {
      btn.onclick = (e) => {
        const rawId = btn.dataset.match;
        const idNum = Number(rawId);
        
        if (!STATE.testMode && (STATE.lockedMatches.has(idNum) || STATE.lockedMatches.has(rawId))) {
          return;
        }
        
        e.stopPropagation();

        if (winnerDerivesFromScore()) return;
        
        STATE.betsMap.set(idNum, btn.dataset.choice);
        STATE.betsMap.set(rawId, btn.dataset.choice);
        
        const card = btn.closest('.match-card');
        card.querySelectorAll('.bet-option').forEach(b => {
          b.classList.toggle('selected', b.dataset.choice === btn.dataset.choice);
        });
        
        if (typeof updateBetsCounters === 'function') updateBetsCounters();
        
        if (typeof updateGroupProgressUI === 'function') {
          setTimeout(updateGroupProgressUI, 10);
        }

        refreshPredictedGroupForMatch(idNum);
      };
    });

    // 🆕 Event listeners para inputs de placar
   wrap.querySelectorAll('.score-input').forEach(inp => {

      inp.onmousedown = (e) => {
          e.stopPropagation();

          const rawId = inp.dataset.match;
          const idNum = Number(rawId);

          if (
              (!STATE.testMode &&
               (STATE.lockedMatches.has(idNum) ||
                STATE.lockedMatches.has(rawId))) ||
              !inp.closest('.match-card')
          ) {
              e.preventDefault();
              return;
          }
      };

      inp.onclick = (e) => {
          e.stopPropagation();
      };

      inp.onfocus = (e) => {
          e.stopPropagation();
      };

      inp.oninput = (e) => {
          e.stopPropagation();

          const rawId = inp.dataset.match;
          const idNum = Number(rawId);
          const side = inp.dataset.side;

          const current =
              STATE.scoresMap.get(idNum) ||
              STATE.scoresMap.get(rawId) ||
              {
                  scoreA: null,
                  scoreB: null
              };

          const updated = { ...current };

          if (side === 'A') {
              updated.scoreA =
                  inp.value === ''
                      ? null
                      : parseInt(inp.value);
          }

          if (side === 'B') {
              updated.scoreB =
                  inp.value === ''
                      ? null
                      : parseInt(inp.value);
          }

          STATE.scoresMap.set(idNum, updated);
          STATE.scoresMap.set(rawId, updated);

          if (winnerDerivesFromScore()) {
              const derivedWinner = deriveWinnerFromScoreData(updated);
              if (derivedWinner) {
                  STATE.betsMap.set(idNum, derivedWinner);
                  STATE.betsMap.set(rawId, derivedWinner);
              } else {
                  STATE.betsMap.delete(idNum);
                  STATE.betsMap.delete(rawId);
              }
              const card = inp.closest('.match-card');
              if (card) {
                  card.querySelectorAll('.bet-option').forEach(b => {
                      b.classList.toggle('selected', b.dataset.choice === derivedWinner);
                  });
              }
              updateBetsCounters();
              updateGroupProgressUI();
          }

          refreshPredictedGroupForMatch(idNum);
      };
  });

  }

  function renderGroupCard(m) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, calculateScoringMatchPointsForUI, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules, hasScoreInput, winnerDerivesFromScore, getDisplayWinner, getPredictionScoreSideInputStyle, hasWinnerBet, generateShotmapDots, getMatchRefWinner, calcLivePoints, isMatchEditable } = ctx;
    const idNum = Number(m.matchId);
    const storedChoice = STATE.betsMap.get(idNum) || STATE.betsMap.get(String(m.matchId));
    
    // Declaração antecipada com fallback seguro
    const scoreData = STATE.scoresMap ? (STATE.scoresMap.get(idNum) || STATE.scoresMap.get(String(m.matchId)) || {}) : {};
    const choice = getDisplayWinner(storedChoice, scoreData);
    const matchResult = m.status === 'finished' ? getMatchRefWinner(m) : null;

    const isEditing = window.STATE?.editingMatches?.has(idNum);
    const isLockedCard = !STATE.testMode && STATE.lockedMatches && (STATE.lockedMatches.has(idNum) || STATE.lockedMatches.has(String(m.matchId)));
    const isLive = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'].includes(m.status);
    const isScheduled = m.status === 'scheduled' || m.status === 'agendado';
    const isPenalties = m.status === 'penaltis';

    const canEdit = isMatchEditable(m);

    let actionBarHtml = '';
    if (STATE.hasSubmitted && canEdit) {
      if (isEditing) {
        actionBarHtml = `<div class="card-action-bar" style="display: flex; justify-content: flex-end; padding: 6px 8px 0 8px; margin-top: -31px;"><button class="btn-save-bet" onclick="window.saveSingleBet(${m.matchId}, event)" style="background: #2ecc71; color: white; border: none; padding: 4px 12px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 4px; z-index: 2; position: relative;">💾 Salvar</button></div>`;
      } else if (isLockedCard) {
        actionBarHtml = `<div class="card-action-bar" style="display: flex; justify-content: flex-start; padding: 6px 8px 0 8px; margin-top: -31px;"><button class="btn-edit-bet" onclick="window.unlockMatchForEdit(${m.matchId}, event)" style="background: lightblue; color: #3498db; border: 1px solid #3498db; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 4px; z-index: 2; position: relative;">✏️ Editar</button></div>`;
      }
    }

    let statusClass = isLive ? 'live-match-card' : ''; 
    let points = 0;
    let partialPoints = 0;

    // ===== PONTOS PARCIAIS AO VIVO =====
    if (isLive) {
      const liveResult = calcLivePoints(m);
      partialPoints = liveResult ? (liveResult.points || 0) : 0;
      
      // Agora scoreData existe no escopo
      if (partialPoints > 0) {
        statusClass += ' live-winning';
      } else if (choice || scoreData.scoreA != null) {
        statusClass += ' live-losing';
      }
    }

    if (m.status === 'finished') {
      const rules = getScoringRules();
      const result = calculateScoringMatchPointsForUI(
        {
          scoreA: scoreData.scoreA,
          scoreB: scoreData.scoreB,
          winner: choice
        },
        m,
        { scoringRules: rules },
        false
      );
      points = result.points;

      statusClass = points > 0 ? 'hit-full' : 'hit-none';
    }

    const minutoFormatado = (isLive && m.minute && !isPenalties) ? (String(m.minute).includes("'") ? m.minute : m.minute + "'") : "";
    const minuteHtml = `<span class="live-minute-inline">${minutoFormatado}</span>`;

    let centerContentHtml = '';
    if (isLive) {
      centerContentHtml = `<div class="score-container-header big-score"><div class="score-numbers-inline">${renderTeamMedia(m.teamA, m.logoA)} ${isPenalties ? `<span class="score-val pen-a-val">${m.penaltiesA ?? 0}</span> <span class="pen-bubble score-a-val" style="background: #eee; color: #333; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; justify-content: center; align-items: center; font-size: 0.75rem; font-weight: bold; margin-left: 6px; vertical-align: middle; box-shadow: 0 0 5px rgba(0,0,0,0.2);" title="Placar do Tempo Normal">${m.scoreA ?? 0}</span><span class="sep" style="margin: 0 6px;">×</span><span class="pen-bubble score-b-val" style="background: #eee; color: #333; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; justify-content: center; align-items: center; font-size: 0.75rem; font-weight: bold; margin-right: 6px; vertical-align: middle; box-shadow: 0 0 5px rgba(0,0,0,0.2);" title="Placar do Tempo Normal">${m.scoreB ?? 0}</span><span class="score-val pen-b-val">${m.penaltiesB ?? 0}</span>` : `<span class="score-val score-a-val">${m.scoreA ?? 0}</span><span class="sep" style="margin: 0 6px;">×</span><span class="score-val score-b-val">${m.scoreB ?? 0}</span>`}${renderTeamMedia(m.teamB, m.logoB)}</div>${isPenalties ? `<div class="penalties-label-mini" style="font-size: 0.6rem; color: #7f8c8d; font-weight: bold; text-align: center; margin-top: 4px;">PÊNALTIS</div>` : ''}</div>`;
    } else if (isScheduled) {
      centerContentHtml = `<div class="scheduled-time-header"><span class="time-wrapper"><i class="clock-icon">🕒</i><span class="time-value">${formatMatchTimeLocal(m)}</span></span></div>`;
    }

    let shotmapHtml = '';
    if (isPenalties || (m.shootoutDetail && m.shootoutDetail.length > 0)) {
      let seqA = [], seqB = [];
      if (m.shootoutDetail) {
        if (Array.isArray(m.shootoutDetail)) {
          m.shootoutDetail.forEach(item => {
            const isHome = item.home === true || item.team === 'A' || item.team === 'home' || item.team === 'teamA';
            const isConverted = item.type === 'goal' || item.converted === true || item.success === true || item.status === 'score';
            if (isHome) seqA.push(isConverted); else seqB.push(isConverted);
          });
        } else if (typeof m.shootoutDetail === 'object') {
          seqA = m.shootoutDetail.teamA || m.shootoutDetail.home || [];
          seqB = m.shootoutDetail.teamB || m.shootoutDetail.away || [];
        }
      }
      shotmapHtml = `<div class="penalty-shotmap-container" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(0, 0, 0, 0.04); border-radius: 8px; margin-top: -39px; margin-bottom: 8px; border: 1px dashed rgba(46, 204, 113, 0.3);"><div class="shotmap-side shotmap-home" style="display: flex; gap: 5px;">${generateShotmapDots(seqA)}</div><span style="font-size: 10px; font-weight: 800; color: #7f8c8d; letter-spacing: 0.5px; text-transform: uppercase;">Série</span><div class="shotmap-side shotmap-away" style="display: flex; gap: 5px;">${generateShotmapDots(seqB)}</div></div>`;
    }

    // ===== LINHA DE PONTOS =====
    const pointsLine = (partialPoints > 0)
      ? `<div class="points-earned partial">+${partialPoints} pts (parcial)</div>`
      : (m.status === 'finished' && points > 0)
        ? `<div class="points-earned">+${points} pts</div>`
        : '';
    const resultLine = m.status === 'finished' ? `<div class="final-score"> ${renderTeamMedia(m.teamA, m.logoA)} ${m.scoreA} x ${m.scoreB} ${renderTeamMedia(m.teamB, m.logoB)}</div>` : '';

    const renderGolsNoCard = (side) => {
      if (!m.goalsDetail || !Array.isArray(m.goalsDetail)) return '';
      const gols = m.goalsDetail.filter(g => g.side === side && (g.type === 'goal' || g.type === 'own-goal' || !g.type));
      return gols.map(g => `<div class="goal-entry-card" style="font-size: 0.62rem; color: #ffca28; font-weight: bold; text-shadow: 1px 1px 2px #000; text-align: center; pointer-events: none; line-height: 1.1; margin-bottom: 2px;">⚽ ${g.name || g.player} ${g.min}'</div>`).join('');
    };

    const scoreInputsHtml = hasScoreInput() ? `
    <div
      class="score-inputs-row"
      style="
        position: ${isScheduled ? 'relative' : 'absolute'};
        top: ${isScheduled ? 'auto' : '48px'};
        left: ${isScheduled ? 'auto' : '0'};
        width: ${isScheduled ? 'auto' : '100%'};
        z-index: 50;
        pointer-events: auto;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 2px;
        padding: 8px 0;
      "
    >
      <input
        type="number"
        min="0"
        class="score-input"
        data-match="${m.matchId}"
        data-side="A"
        value="${scoreData.scoreA ?? ''}"
        placeholder="0"
        ${!canEdit ? 'readonly' : ''}
        style="
          position: relative;
          z-index: 51;
          pointer-events: auto;
          width: 44px;
          text-align: center;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.3);
          font-size: 1rem;
          padding: 4px;
          ${getPredictionScoreSideInputStyle(
    m,
    scoreData,
    'A',
    isLockedCard || !canEdit
  )}
        "
      >

      <span style="
        color: rgba(255,255,255,0.6);
        font-weight: bold;
      ">×</span>

      <input
        type="number"
        min="0"
        class="score-input"
        data-match="${m.matchId}"
        data-side="B"
        value="${scoreData.scoreB ?? ''}"
        placeholder="0"
        ${!canEdit ? 'readonly' : ''}
        style="
          position: relative;
          z-index: 51;
          pointer-events: auto;
          width: 44px;
          text-align: center;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.3);
          font-size: 1rem;
          padding: 4px;
          ${getPredictionScoreSideInputStyle(
    m,
    scoreData,
    'B',
    isLockedCard || !canEdit
  )}
        "
      >
    </div>
  ` : '';

   const winnerButtonsHtml = `
    <div class="bet-options" style="position: relative; display: flex; gap: 5px;">
      ${['A', 'draw', 'B'].map(c => {
        const isDraw = c === 'draw';
        const teamName = c === 'A' ? m.teamA : m.teamB;
        const logoUrl = c === 'A' ? m.logoA : m.logoB;
        const label = isDraw ? 'Empate' : teamName;
        const sideKey = c === 'A' ? 'home' : (c === 'B' ? 'away' : null);

        const buttonLocked =
          isLockedCard ||
          !canEdit ||
          !hasWinnerBet() ||
          winnerDerivesFromScore();

        const buttonStyle = `
          width: 100%;
          z-index: 1;
          ${buttonLocked ? 'pointer-events: none; opacity: 1;' : ''}
        `;

        return `
          <div
            class="option-wrapper"
            style="position: relative; flex: 1; display: flex; flex-direction: column; align-items: center;"
          >
            <div
              class="gols-indicator-container"
              style="position: absolute; top: -33px; left: -21px; width: 100%; z-index: 10; pointer-events: none; display: flex; flex-direction: column; align-items: center;"
            >
              ${sideKey ? renderGolsNoCard(sideKey) : ''}
            </div>

            <button
              class="bet-option ${choice === c ? 'selected' : ''}"
              data-match="${m.matchId}"
              data-choice="${c}"
              style="${buttonStyle}"
            >
              ${!isDraw ? renderTeamMedia(teamName, logoUrl) : ''}
              <span class="bet-team-vertical">${label}</span>
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;

    return `
      <div class="match-card ${statusClass}" id="match-${m.matchId}" data-match-id="${m.matchId}" data-status="${m.status}" data-phase="group" data-team-a="${m.teamA}" data-team-b="${m.teamB}" style="cursor:pointer">
        ${actionBarHtml} 
        <div class="match-header compact">
          <div class="group-label">${m.group || ''}</div>
          ${centerContentHtml}
          <div class="status-wrapper" style="display: flex; align-items: center; gap: 5px;">
            <span class="badge ${m.status}">${statusLabel(m.status)}</span>
            ${minuteHtml} 
          </div>
        </div>
        ${scoreInputsHtml}
        ${winnerButtonsHtml}
        ${shotmapHtml}
        ${resultLine}
        ${pointsLine}
      </div>`;
  }

  return {
    renderMatches,
    renderGroupCard,
  };
}
