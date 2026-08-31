/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesKnockoutRenderer(ctx = {}) {
  const get = (name) => ctx[name];

  function renderKnockoutMatches(openedGroups = []) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, calculateScoringMatchPointsForUI, getMatchPointStatusForUI, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules, getChampionshipRules, getMatchRefScore, getMatchRefWinner, getMatchRefQualifier, calcLivePoints, getKnockoutGroupProgress, renderKnockoutFilterHeader, renderKnockoutCard, attachKnockoutEvents, getKnockoutConfrontationInfo } = ctx;
    const wrap = document.getElementById('knockout-container');
    if (!wrap) return;

    let list = STATE.matches.filter(isKnockoutMatch);
    if (STATE.knockoutBetAvailabilityMode === 'round') {
      list = list.filter(m => {
        const round = Number(m.roundNumber);
        return Number.isInteger(round) && round > 0 &&
          STATE.unlockedKnockoutRounds.has(round) &&
          !STATE.lockedKnockoutRounds.has(round);
      });
    }
    const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'];
    
    if (STATE.knockoutFilter === 'live') {
      list = list.filter(m => liveStatuses.includes(m.status));
    } 
    else if (STATE.knockoutFilter === 'date' && STATE.knockoutStatusFilter === 'pending') {
      list = list.filter(m => m.status === 'scheduled' || m.status === 'agendado');
    }

    if (!list.length) {
      let emptyHtml = renderKnockoutFilterHeader();
      const msg = STATE.knockoutFilter === 'live' 
        ? 'Nenhum jogo de mata-mata ao vivo agora.' 
        : 'Nenhum jogo pendente encontrado.';
      wrap.innerHTML = emptyHtml + `<div class="details-empty" style="text-align:center; padding:20px; color:rgba(255,255,255,0.6);">${msg}</div>`;
      return;
    }

    let html = renderKnockoutFilterHeader();

    const groups = {};
    list.forEach(m => {
      let key;
      if (STATE.knockoutFilter === 'date' || STATE.knockoutFilter === 'live') {
        const d = parseMatchDate(m);
        key = d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Sem data';
      } else {
        key = m.group || 'Mata-mata';
      }
      (groups[key] ||= []).push(m);
    });

    html += Object.keys(groups)
      .sort((a, b) => {
        if (STATE.knockoutFilter === 'date' || STATE.knockoutFilter === 'live') {
          const da = parseMatchDate(groups[a][0]);
          const db = parseMatchDate(groups[b][0]);
          return (da?.getTime() || 0) - (db?.getTime() || 0);
        }
        return a.localeCompare(b);
      })
      .map((groupName, index) => {
        const games = groups[groupName].slice().sort((a, b) => {
          const da = parseMatchDate(a);
          const db = parseMatchDate(b);
          return (da?.getTime() || 0) - (db?.getTime() || 0);
        });

        const rules = getScoringRules();
        const groupPoints = games.reduce((sum, m) => {
          let p = 0;
          const mId = String(m.matchId);
          
          const choice = STATE.betsMap.get(mId) || STATE.betsMap.get(Number(mId));
          const info = getKnockoutConfrontationInfo(m);
          const isReturnLeg = getChampionshipRules()?.knockoutFormat === 'home_away' && info.index > 0;
          const userQ = isReturnLeg ? null : (STATE.knockoutQualifiers.get(mId) || STATE.knockoutQualifiers.get(Number(mId)));
          const scoreData = STATE.scoresMap.get(Number(mId)) || STATE.scoresMap.get(mId) || {};
          
          // CÁLCULO DE CLASSIFICADO RESPEITANDO FLAG MANUAL DO ADMIN E SCORE DE REFERÊNCIA
          const currentQual = getMatchRefQualifier(m);
          const refScore = getMatchRefScore(m);
          const res = m.status === 'finished' ? getMatchRefWinner(m) : null;
          
          if (m.status === 'finished') {
              const result = calculateScoringMatchPointsForUI(
                {
                  scoreA: scoreData.scoreA,
                  scoreB: scoreData.scoreB,
                  winner: choice,
                  qualifier: userQ
                },
                m,
                { scoringRules: rules },
                false
              );
              p += result.points;
          } 
          else if (liveStatuses.includes(m.status)) {
              // ===== PONTOS PARCIAIS AO VIVO (alinhado com backend) =====
              const liveResult = calcLivePoints(m);
              p += liveResult.points;
          }
          
          return sum + p;
        }, 0);

        const wasOpen = openedGroups.includes(groupName);
        const isLiveMode = STATE.knockoutFilter === 'live';
        const isInitialAutoOpen = openedGroups.length === 0 && index === 0;
        const isActive = (wasOpen || isInitialAutoOpen || isLiveMode) ? 'active' : '';

        const progress = getKnockoutGroupProgress(groupName);
        const percent = progress.total ? Math.round((progress.filled / progress.total) * 100) : 0;
        const barClass = progress.mode === 'games' ? 'progress-fill games' : 'progress-fill decisions';

        return `
          <div class="accordion-item ${isActive}" data-group="${groupName}">
            <button class="accordion-header" onclick="this.parentElement.classList.toggle('active')">
              <div class="accordion-info">
                <div class="accordion-top">
                  <span class="accordion-title">${groupName}</span>
                  <span class="accordion-pts">${groupPoints} pts</span>
                </div>
                <div class="phase-progress">
                  <div class="progress-bar"><div class="${barClass}" style="width:${percent}%"></div></div>
                  <span class="progress-text">${progress.filled} / ${progress.total}</span>
                </div>
              </div>
              <i class="chevron">▼</i>
            </button>
            <div class="accordion-content">
              <div class="group-matches-grid">
                ${games.map(m => renderKnockoutCard(m)).join('')}
              </div>
            </div>
          </div>
        `;
      }).join('');

    wrap.innerHTML = html;
    
    if (typeof attachKnockoutEvents === 'function') {
        attachKnockoutEvents(wrap);
    }
    
    if (typeof window.syncEngravedFlags === 'function') {
        setTimeout(window.syncEngravedFlags, 50);
    }
  }

  function renderKnockoutFilterHeader() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, calculateScoringMatchPointsForUI, getMatchPointStatusForUI, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    if (!STATE.hasSubmitted) return '';

    return `
      <div class="filter-wrapper" style="margin-bottom: 20px;">
        <div class="filter-pills-row" style="display: flex; margin-bottom: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <div class="filter-pills knockout-pills" style="display: flex; gap: 8px;">
            <button class="pill ${STATE.knockoutFilter === 'group' ? 'active' : ''}" onclick="setKnockoutFilter('group')">Fase</button>
            <button class="pill ${STATE.knockoutFilter === 'date' ? 'active' : ''}" onclick="setKnockoutFilter('date')">Data</button>
            <button class="pill ${STATE.knockoutFilter === 'live' ? 'active' : ''}" onclick="setKnockoutFilter('live')">📡 Ao Vivo</button>
          </div>
        </div>

        ${STATE.knockoutFilter === 'date' ? `
          <div class="status-filter-row" style="display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
            <span style="font-size: 13px; color: #ffffff; font-weight: 600;">Pendentes</span>
            <label class="switch">
              <input type="checkbox" ${STATE.knockoutStatusFilter === 'pending' ? 'checked' : ''} onchange="window.toggleKnockoutPendingFilter(this.checked)">
              <span class="slider round"></span>
            </label>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderKnockoutCard(m) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, calculateScoringMatchPointsForUI, getMatchPointStatusForUI, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules, hasScoreInput, winnerDerivesFromScore, getDisplayWinner, getPredictionScoreInputStyle, hasWinnerBet, hasQualifierBet, getChampionshipRules, generateShotmapDots, getMatchRefScore, getMatchRefWinner, getMatchRefQualifier, calcLivePoints, isMatchEditable, getKnockoutConfrontationInfo, getConfrontationQualifierBet } = ctx;
    const mId = String(m.matchId);
    const idNum = Number(m.matchId);
    
    // Acesso seguro ao STATE e declaração antecipada das apostas/placares
    const storedChoice = STATE.betsMap ? (STATE.betsMap.get(mId) || STATE.betsMap.get(idNum)) : null;
    const confrontationInfo = getKnockoutConfrontationInfo(m);
    const isReturnLeg = getChampionshipRules()?.knockoutFormat === 'home_away' && confrontationInfo.index > 0;
    const firstLegQualifier = getConfrontationQualifierBet(m);
    const userQualifier = isReturnLeg ? firstLegQualifier : (STATE.knockoutQualifiers ? (STATE.knockoutQualifiers.get(mId) || STATE.knockoutQualifiers.get(idNum)) : null);
    const scoreData = STATE.scoresMap ? (STATE.scoresMap.get(idNum) || STATE.scoresMap.get(mId) || {}) : {};
    const choice = getDisplayWinner(storedChoice, scoreData);
    const realQualifier = getMatchRefQualifier(m); 
    
    // 🚀 LÓGICA DE EDIÇÃO E TRAVAMENTO DE FASES (Mata-mata)
    const isEditing = window.STATE?.editingMatches?.has(idNum);
    const isSessionLocked = !STATE.testMode && STATE.lockedMatches &&
      (STATE.lockedMatches.has(idNum) || STATE.lockedMatches.has(mId));
    const isLockedByRule = !isMatchEditable(m);
    const isLockedCard = Boolean(isSessionLocked || isLockedByRule);
    const isScheduled = m.status === 'scheduled' || m.status === 'agendado';
    const isLive = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'].includes(m.status);
    const isPenalties = m.status === 'penaltis';

    // 🔒 Respeita o modo de bloqueio definido pelo admin.
    const canEditByRule = !isLockedByRule;
    const hasSavedBet = Boolean(
      choice ||
      userQualifier ||
      scoreData.scoreA != null ||
      scoreData.scoreB != null
    );
    // Após o primeiro envio, uma aposta salva fica em somente leitura até
    // o clique em ✏️ Editar. Em testMode, a elegibilidade continua verdadeira
    // e o botão Editar deve aparecer normalmente.
    const canEdit = canEditByRule && (!STATE.hasSubmitted || isEditing || !hasSavedBet);

    let actionBarHtml = '';
    if (STATE.hasSubmitted && hasSavedBet && canEditByRule) {
      if (isEditing) {
        actionBarHtml = `
          <div class="card-action-bar" style="display: flex; justify-content: flex-end; padding: 6px 8px 0 8px; margin-top: -31px;">
            <button class="btn-save-bet" onclick="window.saveSingleBet(${m.matchId}, event)" 
                    style="background: #2ecc71; color: white; border: none; padding: 4px 12px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 4px; z-index: 2; position: relative;">
              💾 Salvar
            </button>
          </div>
        `;
      } else {
        actionBarHtml = `
          <div class="card-action-bar" style="display: flex; justify-content: flex-start; padding: 6px 8px 0 8px; margin-top: -31px;">
            <button class="btn-edit-bet" onclick="window.unlockMatchForEdit(${m.matchId}, event)" 
                    style="background: lightblue; color: #3498db; border: 1px solid #3498db; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 4px; z-index: 2; position: relative;">
              ✏️ Editar
            </button>
          </div>
        `;
      }
    }
    
    const matchResult = m.status === 'finished' ? getMatchRefWinner(m) : null;
    let statusClass = isLive ? 'live-match-card' : '';
    let points = 0;
    let partialPoints = 0;

    // CÁLCULO DE CLASSIFICADO RESPEITANDO FLAG MANUAL DO ADMIN E SCORE DE REFERÊNCIA
    const currentQual = getMatchRefQualifier(m);
    const refScore = getMatchRefScore(m);

    // ===== PONTOS PARCIAIS AO VIVO =====
    if (isLive) {
      const liveResult = calcLivePoints(m);
      partialPoints = liveResult ? (liveResult.points || 0) : 0;

      // scoreData agora está devidamente acessível no escopo
      const hasBet = Boolean(choice || userQualifier || scoreData.scoreA != null);
      if (partialPoints > 0 && hasBet) {
        if (liveResult?.breakdown?.qualifier > 0 && liveResult?.breakdown?.winner > 0) {
          statusClass += ' live-winning-full';
        } else {
          statusClass += ' live-winning-partial';
        }
      } else if (hasBet) {
        statusClass += ' live-losing';
      }
    }

    if (m.status === 'finished') {
      const rules = getScoringRules();
      const result = calculateScoringMatchPointsForUI(
        {
          scoreA: scoreData.scoreA,
          scoreB: scoreData.scoreB,
          winner: choice,
          qualifier: isReturnLeg ? null : userQualifier
        },
        m,
        { scoringRules: rules },
        false
      );
      points = result.points;

      // A classificação visual deve seguir o mesmo motor de pontuação,
      // inclusive quando o campeonato usa regras personalizadas.
      // Não podemos inferir "acerto total" apenas por breakdown.winner,
      // porque uma regra como "Placar exato = 10" preenche
      // breakdown.matchRulePoints, e não breakdown.winner.
      const pointStatus = getMatchPointStatusForUI(
        {
          scoreA: scoreData.scoreA,
          scoreB: scoreData.scoreB,
          winner: choice,
          qualifier: isReturnLeg ? null : userQualifier
        },
        m,
        { scoringRules: rules },
        false
      );

      statusClass = `hit-${pointStatus.category}`;
    }

    const minutoFormatado = (isLive && m.minute && !isPenalties) 
      ? (String(m.minute).includes("'") ? m.minute : m.minute + "'") : "";
    const minuteHtml = `<span class="live-minute-inline">${minutoFormatado}</span>`;

    let centerContentHtml = '';
    if (isLive) {
      centerContentHtml = `
        <div class="score-container-header big-score">
            <div class="score-numbers-inline">
                ${renderTeamMedia(m.teamA, m.logoA)} 
                
                ${isPenalties ? `
                  <span class="score-a-val" style="display: none;">${m.scoreA ?? 0}</span>
                  <span class="score-b-val" style="display: none;">${m.scoreB ?? 0}</span>
                  <span class="score-val pen-a-val">${m.penaltiesA ?? 0}</span> 
                  <span class="sep" style="margin: 0 6px;">×</span> 
                  <span class="score-val pen-b-val">${m.penaltiesB ?? 0}</span> 
                ` : `
                  <span class="score-val score-a-val">${m.scoreA ?? 0}</span> 
                  <span class="sep" style="margin: 0 6px;">×</span> 
                  <span class="score-val score-b-val">${m.scoreB ?? 0}</span> 
                `}
                
                ${renderTeamMedia(m.teamB, m.logoB)}
            </div>
            ${isPenalties ? `<div class="penalties-label-mini" style="font-size: 0.6rem; color: #7f8c8d; font-weight: bold; text-align: center; margin-top: 4px;">PÊNALTIS</div>` : ''}
        </div>`;
    } else if (isScheduled) {
      centerContentHtml = `<div class="scheduled-time-header"><span class="time-wrapper"><i class="clock-icon" style="font-style: normal; margin-right: 4px;">🕒</i><span class="time-value">${formatMatchTimeLocal(m)}</span></span></div>`;
    }

    let shotmapHtml = '';
    if (isPenalties || (m.shootoutDetail && m.shootoutDetail.length > 0)) {
        let seqA = [];
        let seqB = [];
        if (m.shootoutDetail) {
            if (Array.isArray(m.shootoutDetail)) {
                m.shootoutDetail.forEach(item => {
                    const isHome = item.home === true || item.team === 'A' || item.team === 'home' || item.team === 'teamA';
                    const isConverted = item.type === 'goal' || item.converted === true || item.success === true || item.status === 'score';
                    if (isHome) seqA.push(isConverted);
                    else seqB.push(isConverted);
                });
            } else if (typeof m.shootoutDetail === 'object') {
                seqA = m.shootoutDetail.teamA || m.shootoutDetail.home || [];
                seqB = m.shootoutDetail.teamB || m.shootoutDetail.away || [];
            }
        }
        shotmapHtml = `
            <div class="penalty-shotmap-container" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(0, 0, 0, 0.04); border-radius: 8px; margin-top: -39px; margin-bottom: 8px; border: 1px dashed rgba(46, 204, 113, 0.3);">
                <div class="shotmap-side shotmap-home" style="display: flex; gap: 5px;">
                    ${generateShotmapDots(seqA)}
                </div>
                <span style="font-size: 10px; font-weight: 800; color: #7f8c8d; letter-spacing: 0.5px; text-transform: uppercase;">Série</span>
                <div class="shotmap-side shotmap-away" style="display: flex; gap: 5px;">
                    ${generateShotmapDots(seqB)}
                </div>
            </div>
        `;
    }

    // ===== LINHA DE PONTOS =====
    const pointsLine = (partialPoints > 0)
      ? `<div class="points-earned partial">+${partialPoints} pts (parcial)</div>`
      : (m.status === 'finished' && points > 0)
        ? `<div class="points-earned">+${points} pts</div>`
        : ''; 
    
    let qualifierIndicator = '';
    if (m.status === 'finished' && userQualifier && realQualifier) {
      const ok = userQualifier === realQualifier;
      qualifierIndicator = `<span class="qualified-result ${ok ? 'qualified-correct' : 'qualified-wrong'}">${ok ? '✔' : '❌'}</span>`;
    }

    const pA = m.penaltiesA !== null && m.penaltiesA !== undefined ? `<span class="pen-score">(${m.penaltiesA})</span>` : '';
    const pB = m.penaltiesB !== null && m.penaltiesB !== undefined ? `<span class="pen-score">(${m.penaltiesB})</span>` : '';

    const footerScore = (isPenalties || m.status === 'finished') 
      ? `<div class="placar-mini"> ${renderTeamMedia(m.teamA, m.logoA)} <span>${m.scoreA ?? 0}${pA} x ${m.scoreB ?? 0}${pB}</span> ${renderTeamMedia(m.teamB, m.logoB)}</div>`
      : '';

    const renderGolsNoCard = (side) => {
      if (!m.goalsDetail || !Array.isArray(m.goalsDetail)) return '';
      const gols = m.goalsDetail.filter(g => g.side === side && (g.type === 'goal' || g.type === 'own-goal' || !g.type));
      return gols.map(g => `
        <div class="goal-entry-card" style="font-size: 0.62rem; color: #ffca28; font-weight: bold; text-shadow: 1px 1px 2px #000; text-align: center; pointer-events: none; line-height: 1.1; margin-bottom: 2px;">
          ⚽ ${g.name || g.player} ${g.min}'
        </div>`).join('');
    };

  const winnerLockedButtons =
    isLockedCard ||
    !canEdit ||
    !hasWinnerBet() ||
    winnerDerivesFromScore();

  const qualifierLockedButtons =
    isLockedCard ||
    !canEdit ||
    !hasQualifierBet(m) ||
    isReturnLeg;

    return `
      <div class="match-card ${statusClass}" 
            id="match-${m.matchId}"
            data-match-id="${m.matchId}"
            data-status="${m.status}"
            data-phase="knockout"
            data-team-a="${m.teamA}" 
            data-team-b="${m.teamB}" 
            style="cursor:pointer">
        
        ${actionBarHtml}

        <div class="match-header compact">
          <div class="group-label">${m.group || `ID: ${m.matchId}`}</div>
          ${centerContentHtml}
          <div class="status-wrapper" style="display: flex; align-items: center; gap: 5px;">
            <span class="badge ${m.status}">${statusLabel(m.status)}</span>
            ${minuteHtml}
          </div>
        </div>

        ${hasScoreInput() ? `
    <div
      class="score-inputs-row"
      style="
        position: relative;
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
          ${getPredictionScoreInputStyle(
            m,
            scoreData,
            false
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
          ${getPredictionScoreInputStyle(
            m,
            scoreData,
            false
          )}
        "
      >
    </div>
  ` : ''}

        <div class="bet-options" style="position: relative; display: flex; gap: 5px;">
          ${['A','draw','B'].map(c => {
            const isDraw = c === 'draw';
            const teamName = c === 'A' ? m.teamA : m.teamB;
            const logoUrl = c === 'A' ? m.logoA : m.logoB;
            const label = isDraw ? 'Empate' : teamName;
            const sideKey = c === 'A' ? 'home' : (c === 'B' ? 'away' : null);

            const buttonStyle = `width: 100%; z-index: 1; ${winnerLockedButtons ? 'pointer-events: none; opacity: 1;' : ''}`;

            return `
              <div class="option-wrapper" style="position: relative; flex: 1; display: flex; flex-direction: column; align-items: center;">
                <div class="gols-indicator-container" style="position: absolute; top: -33px; left: -21px; width: 100%; z-index: 10; pointer-events: none; display: flex; flex-direction: column; align-items: center;">
                  ${sideKey ? renderGolsNoCard(sideKey) : ''}
                </div>
                <button class="bet-option ${choice === c ? 'selected' : ''}"
                  data-match="${m.matchId}" data-choice="${c}"
                  style="${buttonStyle}">
                  ${!isDraw ? renderTeamMedia(teamName, logoUrl) : ''}
                  <span class="bet-team-vertical">${label}</span>
                </button>
              </div>`;
          }).join('')}
        </div>

        ${shotmapHtml}

        ${hasQualifierBet(m) ? `
        <div class="knockout-footer-compact">
          <div class="qual-mini-row">
            <span class="qual-label">Classificado:</span>
            
            <div style="position: relative; display: inline-block;">
                <select data-q="${m.matchId}" data-confrontation-first="${confrontationInfo.first?.matchId ?? m.matchId}" ${isReturnLeg ? 'disabled' : ''}
                        style="${qualifierLockedButtons ? 'pointer-events: none; opacity: 1; cursor: pointer;' : ''}" 
                        onclick="event.stopPropagation()">
                  <option value="">...</option>
                  <option value="A" ${userQualifier === 'A' ? 'selected' : ''}>${flagOnly(m.teamA)} ${m.teamA}</option>
                  <option value="B" ${userQualifier === 'B' ? 'selected' : ''}>${flagOnly(m.teamB)} ${m.teamB}</option>
                </select>
                <div class="engraved-real-flag" style="position: absolute; left: 8px; top: 0; height: 100%; pointer-events: none; display: flex; align-items: center; justify-content: center;"></div>
            </div>
            ${qualifierIndicator}
          </div>
          ${footerScore}
        </div>
        ` : (footerScore ? `<div class="knockout-footer-compact">${footerScore}</div>` : '')}
        ${pointsLine}
      </div>
    `;
  }

  function attachKnockoutEvents(wrap) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, calculateScoringMatchPointsForUI, getMatchPointStatusForUI, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, winnerDerivesFromScore, deriveWinnerFromScoreData, updateKnockoutProgressUI, updateBetsCounters } = ctx;
    if (!wrap) return;

    // ============================
    // CLASSIFICADO
    // ============================
    wrap.querySelectorAll('select[data-q]').forEach(sel => {
      sel.onclick = e => e.stopPropagation();

      sel.onchange = (e) => {
        e.stopPropagation();

        const rawId = sel.dataset.q;
        const idNum = Number(rawId);

        if (sel.disabled || sel.dataset.confrontationFirst !== String(rawId)) return;

        if (sel.value) {
          STATE.knockoutQualifiers.set(idNum, sel.value);
          STATE.knockoutQualifiers.set(rawId, sel.value);
        } else {
          STATE.knockoutQualifiers.delete(idNum);
          STATE.knockoutQualifiers.delete(rawId);
        }

        updateBetsCounters();
        updateKnockoutProgressUI();

        if (window.syncEngravedFlags) {
          window.syncEngravedFlags();
        }
      };
    });

    // ============================
    // VENCEDOR
    // ============================
    wrap.querySelectorAll('.bet-option').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();

        const rawId = btn.dataset.match;
        const idNum = Number(rawId);

        if (
          !STATE.testMode &&
          (STATE.lockedMatches.has(idNum) ||
           STATE.lockedMatches.has(rawId))
        ) {
          return;
        }

        const choice = btn.dataset.choice;

        if (winnerDerivesFromScore()) return;

        STATE.betsMap.set(idNum, choice);
        STATE.betsMap.set(rawId, choice);

        const card = btn.closest('.match-card');

        if (card) {
          card.querySelectorAll('.bet-option').forEach(b => {
            b.classList.toggle(
              'selected',
              b.dataset.choice === choice
            );
          });
        }

        updateBetsCounters();
        updateKnockoutProgressUI();
      };
    });

    // ============================
    // PLACAR
    // ============================
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
          updateKnockoutProgressUI();
        }
      };
    });
  }

  function syncKnockoutSelections() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, calculateScoringMatchPointsForUI, getMatchPointStatusForUI, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getDisplayWinner } = ctx;
    const wrap = document.getElementById('knockout-container');
    if (!wrap) return;

    wrap.querySelectorAll('.bet-option').forEach(btn => {
      const rawId = btn.dataset.match;
      const storedChoice = STATE.betsMap.get(rawId) || STATE.betsMap.get(Number(rawId));
      const scoreData = STATE.scoresMap.get(Number(rawId)) || STATE.scoresMap.get(rawId) || {};
      const choice = getDisplayWinner(storedChoice, scoreData);
      btn.classList.toggle('selected', choice === btn.dataset.choice);
    });

    wrap.querySelectorAll('select[data-q]').forEach(sel => {
      const rawId = sel.dataset.q;
      const userQ = STATE.knockoutQualifiers.get(rawId) || STATE.knockoutQualifiers.get(Number(rawId));
      if (userQ) sel.value = userQ;
    });

    if (typeof window.syncEngravedFlags === 'function') {
        setTimeout(window.syncEngravedFlags, 50);
    }
  }

  return {
    renderKnockoutMatches,
    renderKnockoutFilterHeader,
    renderKnockoutCard,
    attachKnockoutEvents,
    syncKnockoutSelections,
  };
}
