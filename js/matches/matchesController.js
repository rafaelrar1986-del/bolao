/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesController(ctx = {}) {
  const get = (name) => ctx[name];

  async function initMatches(passedOpenedGroups = null) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, startGroupPredictionPointsLiveRefresh, loadLocalDraft, updateBetsCounters, loadGlobalSettings, loadMatches, loadMyBets, loadOfficialPodium, renderMatches, renderKnockoutMatches, syncKnockoutSelections, fillPodiumSelects, renderExtrasSection, updateExtrasPointsDisplay, fillExtrasInputs } = ctx;
    startGroupPredictionPointsLiveRefresh();
    let openedGroups = passedOpenedGroups;

    if (!openedGroups || openedGroups.length === 0) {
      openedGroups = Array.from(document.querySelectorAll('.accordion-item.active'))
        .map(item => {
          return item.getAttribute('data-group') || item.querySelector('.accordion-title')?.textContent.trim();
        })
        .filter(Boolean);
    }

    const leagueName = localStorage.getItem('selectedLeagueName') || 'Torneio';
    console.log(`🔄 Sincronizando dados do torneio: ${leagueName}...`);

    try {
      await Promise.all([
        loadMatches(),
        loadMyBets(),
        loadOfficialPodium(),
        loadGlobalSettings()
      ]);

      window.STATE = Object.assign(window.STATE || {}, STATE);

      /*
       * Restaura o rascunho local depois de carregar os dados oficiais da liga.
       * Assim o usuário consegue continuar exatamente de onde parou sem
       * substituir o estado oficial salvo no backend.
       */
      try {
        loadLocalDraft();
      } catch (draftError) {
        console.warn('⚠️ Não foi possível restaurar o rascunho local:', draftError);
      }

      console.log(`✅ Dados carregados. Jogos desta liga: ${STATE.matches.length}`);

      const matchWrap = document.getElementById('matches-container');
      const knockoutWrap = document.getElementById('knockout-container');
      
      if (matchWrap) matchWrap.innerHTML = ''; 
      if (knockoutWrap) knockoutWrap.innerHTML = '';
      
      if (typeof renderMatches === 'function') {
    renderMatches(openedGroups);
  }

  if (typeof renderKnockoutMatches === 'function') {
    renderKnockoutMatches(openedGroups);
  }

  if (STATE.matches && STATE.matches.length > 0) {

    // ============================
    // EXTRAS
    // ============================
    if (typeof renderExtrasSection === 'function') {
      renderExtrasSection();
    }

    if (typeof updateExtrasPointsDisplay === 'function') {
      updateExtrasPointsDisplay();
    }

    if (typeof fillExtrasInputs === 'function') {
      fillExtrasInputs();
    }

    // ============================
    // PÓDIO
    // ============================
    if (typeof fillPodiumSelects === 'function') {
      fillPodiumSelects();
    }

  } else {
    console.warn("⚠️ Pódio/Extras não renderizados: Esta liga não possui jogos cadastrados.");
  }

      if (typeof updateBetsCounters === 'function') updateBetsCounters();
      
      if (typeof syncKnockoutSelections === 'function') syncKnockoutSelections();

      console.log(`[Init] Renderização concluída. Mantendo abertos:`, openedGroups);

    } catch (err) {
      console.error("❌ Erro ao inicializar matches:", err);
    }
  }

  function updateMatchDom(matchId, rawData) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, refreshPredictionScoreInputs, generateShotmapDots, calcLivePoints, syncScoresWithGoals, fetchAndRenderBets, initMatches, alertGoal } = ctx;
    const matchIdStr = String(matchId);
    const matchCard = document.getElementById(`match-${matchIdStr}`);
    
    console.log(`%c [DOM Update] Iniciando atualização para o ID: ${matchIdStr} `, "background: #333; color: #fff; border-radius: 5px;");
    
    if (!matchCard) {
      console.warn(`[DOM Update] ❌ ERRO: Card match-${matchIdStr} não encontrado no documento.`);
      return;
    }

    const data = syncScoresWithGoals(rawData);

    try {
      const rawPrev = matchCard.getAttribute('data-status') || '';
      const previousStatus = rawPrev.toLowerCase().trim() || 'scheduled';
      const newStatus = (data.status || '').toLowerCase().trim();
      
      const phaseAttr = (matchCard.getAttribute('data-phase') || 'group').toLowerCase();
      const isKnockout = phaseAttr === 'knockout' || 
                         phaseAttr === 'mata-mata' || 
                         phaseAttr === 'eliminatória' ||
                         (typeof isKnockoutMatch === 'function' && isKnockoutMatch(data));
      
      const isStatusChanging = previousStatus !== newStatus;
      const isBeforeStart = (s) => s === 'scheduled' || s === 'agendado' || s === '' || s === 'vazio';
      
      const startedNow = isBeforeStart(previousStatus) && !isBeforeStart(newStatus) && isStatusChanging;
      const enteredPenalties = (previousStatus !== 'penaltis' && newStatus === 'penaltis' && isStatusChanging);
      const justFinished = (previousStatus !== 'finished' && newStatus === 'finished' && isStatusChanging);
      const needsPenaltiesUI = newStatus === 'penaltis' && !matchCard.querySelector('.pen-a-val');

      if (startedNow || enteredPenalties || justFinished || needsPenaltiesUI) {
        matchCard.setAttribute('data-status', newStatus);

        const openedGroups = Array.from(document.querySelectorAll('.accordion-item.active'))
          .map(item =>
            item.getAttribute('data-group') ||
            item.querySelector('.accordion-title')?.textContent.trim()
          )
          .filter(Boolean);

        const currentGroup = matchCard.closest('.accordion-item');
        const currentGroupTitle =
          currentGroup?.getAttribute('data-group') ||
          currentGroup?.querySelector('.accordion-title')?.textContent.trim();
        if (startedNow && currentGroupTitle && !openedGroups.includes(currentGroupTitle)) {
          openedGroups.push(currentGroupTitle);
        }

        if (typeof initMatches === 'function') {
          setTimeout(() => { 
            initMatches(openedGroups); 
          }, 800);
          return; 
        }
      }

      const scoreAEl = matchCard.querySelector('.score-a-val');
      const scoreBEl = matchCard.querySelector('.score-b-val');

      if (scoreAEl && scoreBEl && (data.scoreA !== undefined || data.scoreB !== undefined)) {
        const oldScoreA = Number(scoreAEl.textContent || 0);
        const oldScoreB = Number(scoreBEl.textContent || 0);
        const newScoreA = Number(data.scoreA ?? oldScoreA);
        const newScoreB = Number(data.scoreB ?? oldScoreB);

        if (newScoreA > oldScoreA || newScoreB > oldScoreB) {
          console.log(`%c [GOOOL!] Alerta disparado: ${newScoreA}x${newScoreB} `, "background: #f00; color: #fff;");
          const oldMatchData = {
            scoreA: oldScoreA,
            scoreB: oldScoreB,
            teamA: matchCard.getAttribute('data-team-a') || 'Time A',
            teamB: matchCard.getAttribute('data-team-b') || 'Time B'
          };
          if (typeof alertGoal === 'function') alertGoal(matchId, data, oldMatchData);
        }
        
        scoreAEl.textContent = newScoreA;
        scoreBEl.textContent = newScoreB;

        // ===== RECALCULA PONTOS PARCIAIS AO VIVO =====
        const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'];
        if (liveStatuses.includes(newStatus)) {
    const mIdx = STATE.matches.findIndex(
      m => String(m.matchId) === matchIdStr
    );

    let liveMatch;

    if (mIdx !== -1) {
      STATE.matches[mIdx] = {
        ...STATE.matches[mIdx],
        ...data
      };

      liveMatch = STATE.matches[mIdx];
    } else {
      liveMatch = {
        ...data,
        matchId
      };
    }

    // Atualiza a cor do palpite em tempo real
    refreshPredictionScoreInputs(liveMatch);

    const liveResult = calcLivePoints(liveMatch);

    // Atualiza ou cria a linha de pontos parciais
    let pointsEl =
      matchCard.querySelector('.points-earned.partial');

    if (!pointsEl) {
      pointsEl = document.createElement('div');
      pointsEl.className = 'points-earned partial';
      matchCard.appendChild(pointsEl);
    }

    if (liveResult.points > 0) {
      pointsEl.textContent =
        `+${liveResult.points} pts (parcial)`;
      pointsEl.style.display = '';
    } else {
      pointsEl.style.display = 'none';
    }
  }
      }

      if (data.goalsDetail && Array.isArray(data.goalsDetail)) {
        const getGolsHtml = (side) => {
          return data.goalsDetail
            .filter(g => g.side === side && (g.type === 'goal' || g.type === 'own-goal' || !g.type))
            .map(g => `
              <div class="goal-entry-card" style="font-size: 0.62rem; color: #ffca28; font-weight: bold; text-shadow: 1px 1px 2px #000; text-align: center; pointer-events: none; line-height: 1.1; margin-bottom: 2px; animation: fadeIn 0.5s;">
                ⚽ ${g.name || g.player} ${g.min}'
              </div>`)
            .join('');
        };

        const optionWrappers = matchCard.querySelectorAll('.option-wrapper');
        optionWrappers.forEach(wrapper => {
          const btn = wrapper.querySelector('button');
          if (!btn) return;
          const choice = btn.getAttribute('data-choice');
          const container = wrapper.querySelector('.gols-indicator-container');
          if (container) {
            if (choice === 'A') container.innerHTML = getGolsHtml('home');
            else if (choice === 'B') container.innerHTML = getGolsHtml('away');
            else container.innerHTML = '';
          }
        });
      }

      const penAEl = matchCard.querySelector('.pen-a-val');
      const penBEl = matchCard.querySelector('.pen-b-val');
      if (data.hasOwnProperty('penaltiesA') && penAEl && penBEl) {
        penAEl.textContent = data.penaltiesA;
        penBEl.textContent = data.penaltiesB;
      }

      // --- ATUALIZAÇÃO DINÂMICA DO SHOTMAP ---
      const isPenaltiesCurrent = newStatus === 'penaltis' || newStatus === 'penalties' || data.isPenalties || previousStatus === 'penaltis';
      let shotmapContainer = matchCard.querySelector('.penalty-shotmap-container');
      
      if (isPenaltiesCurrent) {
        if (!shotmapContainer) {
          shotmapContainer = document.createElement('div');
          shotmapContainer.className = 'penalty-shotmap-container';
          shotmapContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(0, 0, 0, 0.04); border-radius: 8px; margin-top: 12px; margin-bottom: 8px; border: 1px dashed rgba(46, 204, 113, 0.3);';
          
          const betOptions = matchCard.querySelector('.bet-options');
          if (betOptions && betOptions.nextSibling) {
              betOptions.parentNode.insertBefore(shotmapContainer, betOptions.nextSibling);
          } else {
              matchCard.appendChild(shotmapContainer);
          }
        }

        let seqA = [];
        let seqB = [];
        const shootoutDetail = data.shootoutDetail || STATE.matches.find(m => String(m.matchId) === matchIdStr)?.shootoutDetail;

        if (shootoutDetail) {
          if (Array.isArray(shootoutDetail)) {
            shootoutDetail.forEach(item => {
              const isHome = item.home === true || item.team === 'A' || item.team === 'home' || item.team === 'teamA';
              const isConverted = item.type === 'goal' || item.converted === true || item.success === true || item.status === 'score';
              if (isHome) seqA.push(isConverted);
              else seqB.push(isConverted);
            });
          } else if (typeof shootoutDetail === 'object') {
            seqA = shootoutDetail.teamA || shootoutDetail.home || [];
            seqB = shootoutDetail.teamB || shootoutDetail.away || [];
          }
        }

        shotmapContainer.innerHTML = `
          <div class="shotmap-side shotmap-home" style="display: flex; gap: 5px;">${generateShotmapDots(seqA)}</div>
          <span style="font-size: 10px; font-weight: 800; color: #7f8c8d; letter-spacing: 0.5px; text-transform: uppercase;">Série</span>
          <div class="shotmap-side shotmap-away" style="display: flex; gap: 5px;">${generateShotmapDots(seqB)}</div>
        `;
        shotmapContainer.style.display = 'flex';
      } else if (shotmapContainer) {
        shotmapContainer.style.display = 'none';
      }
      // ----------------------------------------

      const minuteEl = matchCard.querySelector('.live-minute-inline');
      if (minuteEl && data.minute !== undefined) {
        const minVal = String(data.minute).trim();
        if (minVal && minVal !== '0' && minVal !== 'null' && minVal !== '') {
          minuteEl.textContent = minVal.includes("'") ? minVal : minVal + "'";
          minuteEl.style.display = "inline-block";
        } else {
          minuteEl.textContent = "";
        }
      }

      const badge = matchCard.querySelector('.badge');
      if (badge && newStatus) {
        const label = (typeof statusLabel === 'function') ? statusLabel(newStatus) : newStatus;
        badge.textContent = label;
        badge.className = `badge ${newStatus}`;
      }

      if (newStatus === 'finished') {
        matchCard.setAttribute('data-status', 'finished');
        if (minuteEl) minuteEl.textContent = "";
        return; 
      }

      const norm = (v) => {
          const s = String(v || '').trim().toLowerCase();
          if (s === 'a' || s === 'home') return 'home';
          if (s === 'b' || s === 'away') return 'away';
          if (s === 'draw' || s === 'x') return 'draw';
          return s;
      };

      const bVal = window.STATE?.betsMap?.get(Number(matchId)) || window.STATE?.betsMap?.get(String(matchId));
      const userBet = norm(bVal?.choice || bVal);

      if (userBet || isKnockout) {
        matchCard.classList.remove('live-winning', 'live-losing', 'live-winning-full', 'live-winning-partial');

        // ===== NOVO: Usa calcLivePoints para determinar classe visual =====
        const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress'];
        if (liveStatuses.includes(newStatus)) {
          const mIdx = STATE.matches.findIndex(m => String(m.matchId) === matchIdStr);
          const matchData = mIdx !== -1 ? { ...STATE.matches[mIdx], ...data } : data;
          const liveResult = calcLivePoints(matchData);
          const hasBet = Boolean(userBet || window.STATE?.knockoutQualifiers?.get(Number(matchId)) || window.STATE?.knockoutQualifiers?.get(String(matchId)));

          if (liveResult.points > 0 && hasBet) {
            if (isKnockout && liveResult.breakdown.qualifier > 0 && liveResult.breakdown.winner > 0) {
              matchCard.classList.add('live-winning-full');
            } else {
              matchCard.classList.add('live-winning-partial');
            }
          } else if (hasBet) {
            matchCard.classList.add('live-losing');
          }
        }
      }

      matchCard.setAttribute('data-status', newStatus);

      const modal = document.getElementById('modal-detalhes');
      if (modal && modal.dataset.openedMatchId === matchIdStr) {
          const mIdx = STATE.matches.findIndex(m => String(m.matchId) === matchIdStr);
          if (mIdx !== -1) {
              STATE.matches[mIdx] = { ...STATE.matches[mIdx], ...data };
              const matchFullData = STATE.matches[mIdx];
              console.log(`[SSE-Fix] Evento Live! Disparando atualização do modal e do ranking...`);

              if (typeof window.syncModalData === 'function') {
                  window.syncModalData(matchFullData);
              } else if (typeof fetchAndRenderBets === 'function') {
                  fetchAndRenderBets(matchFullData);
              }
          }
      }

    } catch (err) {
      console.error(`[DOM Update] Falha no ID ${matchIdStr}:`, err);
    }
  }

  function alertGoal(matchId, data, oldMatch) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    console.group(`🚨 INVESTIGAÇÃO DE GOL - ID: ${matchId}`);
    
    console.log("📥 Dados recebidos (data):", data);
    console.log("🏠 Dados antigos (oldMatch):", oldMatch);

    const scoreANovo = Number(data.scoreA ?? oldMatch.scoreA);
    const scoreAAntigo = Number(oldMatch.scoreA);
    const scoreBNovo = Number(data.scoreB ?? oldMatch.scoreB);
    const scoreBAntigo = Number(oldMatch.scoreB);

    const golTimeA = scoreANovo > scoreAAntigo;
    const golTimeB = scoreBNovo > scoreBAntigo;
    
    const bNum = window.STATE?.betsMap?.get(Number(matchId));
    const bStr = window.STATE?.betsMap?.get(String(matchId));
    const rawBet = bNum || bStr;

    const userBet = (rawBet && typeof rawBet === 'object') ? rawBet.choice : rawBet;

    let tipoToast = "info";
    let motivoCausa = "Nenhuma aposta encontrada";

    if (userBet) {
      if (userBet === 'draw' || userBet === 'empate') {
        tipoToast = "info";
        motivoCausa = "Aposta em empate (Neutro)";
      } else if (golTimeA) {
        tipoToast = (userBet === 'A' || userBet === 'home') ? "success" : "danger";
        motivoCausa = `Gol do Time A + Aposta em ${userBet}`;
      } else if (golTimeB) {
        tipoToast = (userBet === 'B' || userBet === 'away') ? "success" : "danger";
        motivoCausa = `Gol do Time B + Aposta em ${userBet}`;
      }
    }

    const bandeira = golTimeA ? flagOnly(oldMatch.teamA) : flagOnly(oldMatch.teamB);
    const nomeTime = (golTimeA ? oldMatch.teamA : oldMatch.teamB) || 'Time';
    const msg = `⚽ GOL ⚽ ${bandeira} ${nomeTime.toUpperCase()}!`;

    if (typeof toast === 'function') {
      toast(msg, tipoToast);
    } else {
      console.error("❌ ERRO CRÍTICO: Função 'toast' não está acessível!");
    }

    console.groupEnd();
  }

  function unlockMatchForEdit(matchId, event) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, renderMatches, renderKnockoutMatches, getKnockoutConfrontationInfo } = ctx;
    if (event) event.stopPropagation();
    if (STATE?.allowBetEditingBeforeLock === false) {
      if (typeof toast === 'function') toast('A edição de palpites já salvos está desativada pelo administrador.', 'warning');
      return;
    }
    
    const idNum = Number(matchId);

    // Inicializa a proteção de variável caso esteja indefinida
    if (!window.STATE.editingMatches) window.STATE.editingMatches = new Set();

    // Adiciona no modo de edição e remove do bloqueio
    window.STATE.editingMatches.add(idNum);
    window.STATE.lockedMatches.delete(idNum);
    window.STATE.lockedMatches.delete(String(matchId));

    // Avisa o usuário sutilmente (se tiver UI instalada)
    if (typeof toast === 'function') toast('Card destravado! Altere seu palpite e clique em Salvar.', 'info');

    // Pega os grupos abertos pra não fechar o accordion bruscamente
    const openedGroups = Array.from(document.querySelectorAll('.accordion-item.active'))
        .map(item => item.getAttribute('data-group'))
        .filter(Boolean);

    // Re-renderiza a tela para desbloquear os botões de aposta e trocar Editar > Salvar
    if (typeof renderMatches === 'function') renderMatches(openedGroups);
    if (typeof renderKnockoutMatches === 'function') renderKnockoutMatches(openedGroups);
  };

  async function saveSingleBet(matchId, event) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, renderMatches, renderKnockoutMatches, getKnockoutConfrontationInfo } = ctx;
    if (event) event.stopPropagation();
    
    const idNum = Number(matchId);
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    
    // Feedback Visual de Carregamento
    btn.innerHTML = '⏳...';
    btn.disabled = true;

    try {
      const choice = window.STATE.betsMap.get(idNum) || window.STATE.betsMap.get(String(matchId));
      const match = window.STATE.matches?.find(m => Number(m.matchId) === idNum);
      const info = match ? getKnockoutConfrontationInfo(match) : { index: 0 };
      const qualifier = info.index === 0
        ? (window.STATE.knockoutQualifiers.get(idNum) || window.STATE.knockoutQualifiers.get(String(matchId)))
        : undefined;
      const scoreData = window.STATE.scoresMap.get(idNum) || window.STATE.scoresMap.get(String(matchId)) || { scoreA: null, scoreB: null };
      const leagueId = localStorage.getItem('selectedLeagueId');

      // Chamada real da API
      const res = await api.post(`/api/bets/single`, { 
        leagueId, 
        matchId: idNum, 
        winner: choice,
        ...(qualifier !== undefined ? { qualifier } : {}),
        scoreA: scoreData.scoreA,
        scoreB: scoreData.scoreB
      });

      if (!res?.success) throw new Error(res?.message || 'Erro ao salvar palpite');

      // Remove do estado de Edição e joga de volta pro bloqueio
      window.STATE.editingMatches.delete(idNum);
      window.STATE.lockedMatches.add(idNum);
      window.STATE.lockedMatches.add(String(matchId));
      
      if (typeof toast === 'function') toast('Palpite salvo com sucesso!', 'success');

      // Re-renderiza para trocar o botão Salvar > Editar e travar os botões do palpite
      const openedGroups = Array.from(document.querySelectorAll('.accordion-item.active'))
          .map(item => item.getAttribute('data-group'))
          .filter(Boolean);

      if (typeof renderMatches === 'function') renderMatches(openedGroups);
      if (typeof renderKnockoutMatches === 'function') renderKnockoutMatches(openedGroups);
      
    } catch (error) {
      console.error("Erro ao salvar palpite isolado:", error);
      if (typeof toast === 'function') toast('Erro ao salvar o palpite. Tente novamente.', 'danger');
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  };
  return {
    initMatches,
    updateMatchDom,
    alertGoal,
    unlockMatchForEdit,
    saveSingleBet,
  };
}
