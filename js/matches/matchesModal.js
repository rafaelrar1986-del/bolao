/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesModal(ctx = {}) {
  const get = (name) => ctx[name];

  function prepareMatchForRender(match) {
      const {
          STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier,
          getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints,
          withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel,
          resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal,
          checkUserStatusAtScore, calculateDiff
      } = ctx;
      const currentUserId = window.currentUser?._id || window.currentUser?.id;

      // Compatibilidade segura com o helper legado. Essas funções não fazem parte
      // do fluxo atual do modal; se algum consumidor externo fornecer os helpers,
      // preservamos o comportamento antigo. Caso contrário, não lançamos ReferenceError.
      if (match.goalsDetail && typeof checkUserStatusAtScore === 'function' && typeof calculateDiff === 'function') {
          match.goalsDetail.forEach(event => {
              if (event.type === 'goal' || !event.type) {
                  event.userStatusAtThisMoment = checkUserStatusAtScore(match, event.scoreAtTime);
                  event.diffFull = calculateDiff(match, 'full');
                  event.diffPartial = calculateDiff(match, 'partial');
                  event.diffWrong = calculateDiff(match, 'wrong');
              }
          });
      }
      return match;
  }

  function renderTimelineHTML(match, allBets = []) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
      const normalize = (val) => {
          if (!val) return '';
          const s = String(val).trim().toLowerCase();
          if (s === 'a' || s === 'home' || s === '1') return 'home';
          if (s === 'b' || s === 'away' || s === '2') return 'away';
          if (s === 'draw' || s === 'x' || s === 'empate') return 'draw';
          return s;
      };

      const isKnockout = isKnockoutMatch(match); 
      const currentUserId = window.currentUser?._id || window.currentUser?.id;
      const currentUserName = window.currentUser?.name || window.currentUser?.userName;

      const realQualNormalized = normalize(match.qualifiedSide);

      const rawEvents = (match.goalsDetail || []).map(ev => {
          let extraValue = parseInt(ev.extra) || 0;
          
          if (ev.type === 'period' && ev.name === 'Lance') {
              const relatedInjury = match.goalsDetail.find(i => 
                  (i.type === 'injury' || i.type === 'injuryTime') && parseInt(i.min) === parseInt(ev.min)
              );
              if (relatedInjury) {
                  extraValue = parseInt(relatedInjury.extra) || parseInt(relatedInjury.description) || 0;
              }
          }
          
          return { 
              ...ev, 
              computedTime: parseInt(ev.min) + extraValue,
              displayExtra: extraValue 
          };
      });

      const events = [...rawEvents].sort((a, b) => {
          if (b.computedTime !== a.computedTime) return b.computedTime - a.computedTime;

          const getWeight = (ev) => {
              if (ev.type === 'period') return 3; 
              if (ev.type === 'injury' || ev.type === 'injuryTime') return 1; 
              return 2; 
          };
          return getWeight(b) - getWeight(a);
      });

      if (events.length === 0) {
          return '<div style="text-align:center; padding:20px; color:#999;">Aguardando lances...</div>';
      }

      return events.map(event => {
          const isSystemEvent = event.type === 'period' || event.type === 'injury' || event.type === 'injuryTime';
          const isHome = event.side === 'home'; 
          
          let icon = '⚽';
          let detailHtml = `<strong>${event.name || event.player || ''}</strong>`;
          let countersHtml = '';

          if (event.type === 'goal' || event.type === 'own-goal' || (!event.type && (event.name || event.player))) {
              let beforeA = 0, beforeB = 0;
              let afterA = 0, afterB = 0;
              
              rawEvents.forEach(e => {
                  if (e.type === 'goal' || e.type === 'own-goal' || !e.type) {
                      if (e.computedTime < event.computedTime) {
                          e.side === 'home' ? beforeA++ : beforeB++;
                      }
                      if (e.computedTime <= event.computedTime) {
                          e.side === 'home' ? afterA++ : afterB++;
                      }
                  }
              });

              const resBefore = normalize(resultWinnerFromScore(beforeA, beforeB));
              const resAfter = normalize(resultWinnerFromScore(afterA, afterB));

              const qualBefore = (beforeA > beforeB) ? "home" : (beforeB > beforeA ? "away" : null);
              const qualAfter = (afterA > afterB) ? "home" : (afterB > afterA ? "away" : null);

              let diffFull = 0, diffPartial = 0, diffWrong = 0;
              let myStatus = '';

              allBets.forEach(user => {
                  const ub = user.bets?.[0];
                  if (!ub) return;

                  const uChoice = normalize(ub.choice);
                  const uQual = normalize(ub.qualifier);

                  const hitResBefore = uChoice === resBefore;
                  const hitQualBefore = qualBefore !== null && uQual === qualBefore;
                  let statusBefore = 'wrong';
                  if (isKnockout) {
                      if (hitResBefore && hitQualBefore) statusBefore = 'full';
                      else if (hitResBefore || hitQualBefore) statusBefore = 'partial';
                  } else {
                      if (hitResBefore) statusBefore = 'full';
                  }

                  const hitResAfter = uChoice === resAfter;
                  const hitQualAfter = qualAfter !== null && uQual === qualAfter;
                  let statusAfter = 'wrong';
                  if (isKnockout) {
                      if (hitResAfter && hitQualAfter) statusAfter = 'full';
                      else if (hitResAfter || hitQualAfter) statusAfter = 'partial';
                  } else {
                      if (hitResAfter) statusAfter = 'full';
                  }

                  if (statusBefore !== 'full' && statusAfter === 'full') diffFull++;
                  if (statusBefore === 'full' && statusAfter !== 'full') diffFull--;

                  if (statusBefore !== 'partial' && statusAfter === 'partial') diffPartial++;
                  if (statusBefore === 'partial' && statusAfter !== 'partial') diffPartial--;

                  if (statusBefore !== 'wrong' && statusAfter === 'wrong') diffWrong++;
                  if (statusBefore === 'wrong' && statusAfter !== 'wrong') diffWrong--;

                  const betOwnerId = String(user.userId || user._id || "").trim();
                  const myId = String(currentUserId || "").trim();
                  const myName = String(currentUserName || "").trim();

                  if ((myId !== "" && betOwnerId === myId) || (user.userName === myName)) {
                      myStatus = statusAfter;
                  }
              });

              const fmt = (n) => n >= 0 ? `+${n}` : n;
              countersHtml = `
                  <div class="timeline-counters" style="display:inline-flex; gap:8px; margin-left:8px; font-weight:bold; font-size:0.8rem; vertical-align:middle;">
                      <span class="${myStatus === 'full' ? 'blink-me' : ''}" style="color:#27ae60">🎯 ${fmt(diffFull)}</span>
                      ${isKnockout ? `<span class="${myStatus === 'partial' ? 'blink-me' : ''}" style="color:#f39c12">🌓 ${fmt(diffPartial)}</span>` : ''}
                      <span class="${myStatus === 'wrong' ? 'blink-me' : ''}" style="color:#e74c3c">❌ ${fmt(diffWrong)}</span>
                  </div>`;
          }

          switch (event.type) {
              case 'substitution':
                  icon = '🔄';
                  detailHtml = `<div style="line-height:1.2;"><span style="color:#27ae60; font-weight:700;">↑ ${event.playerIn || '---'}</span><br><span style="color:#e74c3c; font-size:0.75rem;">↓ ${event.playerOut || '---'}</span></div>`;
                  break;
              case 'card':
                  icon = (event.description && event.description.includes('red')) ? '🟥' : '🟨';
                  break;
              case 'varDecision':
                  icon = '🖥️';
                  const varText = event.description === 'cardUpgrade' ? 'Vermelho (VAR)' : 'Gol Anulado (VAR)';
                  detailHtml = `<strong>${event.name || ''}</strong><br><small style="color:#e67e22;">${varText}</small>`;
                  break;
              case 'injuryTime':
              case 'injury':
                  icon = '⏱️';
                  detailHtml = `<strong>ACRÉSCIMOS: +${event.extra || event.description || '?'} MIN</strong>`;
                  break;
              case 'period':
                  if (event.name === 'Lance') {
                      icon = '📢';
                      detailHtml = `<strong>FIM DE PERÍODO</strong>`;
                  }
                  break;
          }

          if (isSystemEvent) {
              return `
                  <div class="timeline-item system-event" style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; margin: 10px 0; padding: 8px 0; border-top: 1px dashed #eee; border-bottom: 1px dashed #eee; background: #fafafa; text-align: center;">
                      <div style="font-weight: bold; color: #666; font-size: 0.75rem; margin-bottom: 2px;">${event.computedTime}'</div>
                      <div style="display: flex; align-items: center; gap: 6px;">
                          <span style="font-size: 1.1rem;">${icon}</span>
                          <span style="font-size: 0.8rem; font-weight: bold; color: #333; text-transform: uppercase;">${detailHtml}</span>
                      </div>
                  </div>`;
          }

          return `
              <div class="timeline-item ${isHome ? 'home-event' : 'away-event'}" 
                   style="display: flex; align-items: center; width: 100%; margin-bottom: 12px; gap: 10px; 
                   ${isHome ? 'justify-content: flex-start; text-align: left;' : 'justify-content: flex-end; flex-direction: row-reverse; text-align: right;'}">
                  
                  <div class="event-min" style="font-weight: bold; width: 45px; color: #666; font-size: 0.85rem; flex-shrink: 0; ${!isHome ? 'text-align: right;' : ''}">
                      ${event.min}${event.extra ? '+' + event.extra : ''}'
                  </div>

                  <div class="event-icon" style="font-size: 1.1rem; min-width: 25px; text-align: center; flex-shrink: 0;">
                      ${icon}
                  </div>

                  <div class="event-content" style="display: flex; flex-direction: column; ${!isHome ? 'align-items: flex-end;' : 'align-items: flex-start;'}">
                      <div style="font-size: 0.9rem;">${detailHtml}</div>
                      <div style="margin-top: 2px;">${countersHtml}</div>
                  </div>
              </div>`;
      }).join('');
  }

  async function fetchAndRenderBets(matchObj) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getMatchRefScore, getMatchRefWinner, getMatchRefQualifier, getLiveRefScore, getMatchPointStatusForUI, getLiveRefWinner, getLiveRefQualifier, renderTimelineHTML } = ctx;
      try {
          const leagueId = localStorage.getItem('selectedLeagueId') || '1';
          const matchIdStr = String(matchObj.matchId);

          const matchCard = document.getElementById(`match-${matchIdStr}`);
          const phaseFromCard = matchCard ? String(matchCard.getAttribute('data-phase')).toLowerCase() : "";
          const groupName = String(matchObj.group || matchObj.phaseName || "").toLowerCase();

          const isKnockout = isKnockoutMatch(matchObj) || 
                             phaseFromCard === 'knockout' || 
                             phaseFromCard === 'mata-mata' ||
                             groupName.includes('avos') || 
                             groupName.includes('16') ||
                             groupName.includes('final') ||
                             matchObj.phase === 'knockout';

          const currentUserIdStr = String(window.currentUser?._id || window.currentUser?.id || localStorage.getItem('userId') || "").trim();
          const currentUserNameStr = String(window.currentUser?.name || window.currentUser?.userName || "").trim();
          
          const [res, settingsRes, leaderboardRes] = await Promise.all([
              api.get(`/api/bets/all-bets?matchId=${matchIdStr}&leagueId=${leagueId}`),
              api.get(`/api/settings/global?leagueId=${leagueId}`),
              api.get(`/api/bets/leaderboard?leagueId=${leagueId}&type=partial`)
          ]);

          const allBets = res?.data || [];
          const unlockedPhases = settingsRes?.success ? (settingsRes.data.unlockedPhases || []) : [];
          
          const isFinish = matchObj.status === 'finished';
          const isLive = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress', 'live'].includes(matchObj.status);
          const isLiveOrFinished = isFinish || isLive;

          const normalize = (val) => {
              if (!val) return '';
              const s = String(val).trim().toLowerCase();
              if (s === 'a' || s === 'home' || s === '1') return 'home';
              if (s === 'b' || s === 'away' || s === '2') return 'away';
              if (s === 'draw' || s === 'x' || s === 'empate') return 'draw';
              return s;
          };

          const refScore = isLive
            ? getLiveRefScore(matchObj)
            : getMatchRefScore(matchObj);
          const scoreA = parseInt(refScore.scoreA) || 0;
          const scoreB = parseInt(refScore.scoreB) || 0;
          const pA = parseInt(matchObj.penaltiesA) || 0;
          const pB = parseInt(matchObj.penaltiesB) || 0;
          const realResult = normalize(isLive ? getLiveRefWinner(matchObj) : getMatchRefWinner(matchObj));

          let realQual = null;
          if (isKnockout) {
              realQual = normalize(isLive ? getLiveRefQualifier(matchObj) : getMatchRefQualifier(matchObj));
          }

          const liveRankingList = leaderboardRes?.success ? (leaderboardRes.data || []) : [];

          allBets.sort((a, b) => {
              const getPos = (userObj) => {
                  const bId = String(userObj.userId || userObj._id || userObj.user?._id || userObj.user?.id || "").trim();
                  const bName = String(userObj.userName || userObj.name || userObj.user?.userName || userObj.user?.name || "").trim();
                  
                  const matchInList = liveRankingList.find(item => {
                      const rId = String(item.user?._id || item.user?.id || "").trim();
                      const rName = String(item.user?.name || "").trim();
                      return (bId !== "" && rId === bId) || (bName !== "" && rName === bName);
                  });
                  return matchInList && matchInList.position != null ? matchInList.position : Infinity;
              };
              return getPos(a) - getPos(b);
          });

          STATE.allBets = allBets; 

          const myLiveMatch = liveRankingList.find(item => {
              const rId = String(item.user?._id || item.user?.id || "").trim();
              const rName = String(item.user?.name || "").trim();
              return (currentUserIdStr !== "" && rId === currentUserIdStr) || 
                     (currentUserNameStr !== "" && rName === currentUserNameStr);
          });
          const myLivePos = myLiveMatch ? myLiveMatch.position : null;

          const generateUserCardHtml = (user, extraClass = '') => {
              const betOwnerId = String(user.userId || user._id || user.user?._id || user.user?.id || "").trim();
              const betOwnerName = String(user.userName || user.name || user.user?.userName || user.user?.name || "Usuário").trim();

              const isMe = (currentUserIdStr !== "" && betOwnerId === currentUserIdStr) || 
                           (currentUserNameStr !== "" && betOwnerName === currentUserNameStr);

              const matchInLiveList = liveRankingList.find(item => {
                  const rId = String(item.user?._id || item.user?.id || "").trim();
                  const rName = String(item.user?.name || "").trim();
                  return (betOwnerId !== "" && rId === betOwnerId) || (betOwnerName !== "" && rName === betOwnerName);
              });
              const cardLivePos = matchInLiveList ? matchInLiveList.position : null;

              let cardClasses = ['bet-user-card'];
              if (isMe) cardClasses.push('blink-me');
              if (extraClass) cardClasses.push(extraClass);

              let inlineStyle = '';
              if (cardLivePos === 1) {
                  inlineStyle = 'background: rgba(255, 215, 0, 0.16) !important; border: 1px solid rgba(255, 215, 0, 0.8) !important; box-shadow: 0 0 15px rgba(255, 215, 0, 0.45), inset 0 0 6px rgba(255, 215, 0, 0.1) !important; color: #ffd700 !important;';
              } else if (!isMe && myLivePos !== null && cardLivePos !== null) {
                  if (cardLivePos < myLivePos) {
                      inlineStyle = 'background: rgba(46, 204, 113, 0.14) !important; border: 1px solid rgba(46, 204, 113, 0.7) !important; box-shadow: 0 0 12px rgba(46, 204, 113, 0.35) !important; color: #2ecc71 !important;';
                  } else if (cardLivePos > myLivePos) {
                      inlineStyle = 'background: rgba(231, 76, 60, 0.08) !important; border: 1px solid rgba(231, 76, 60, 0.45) !important; box-shadow: 0 0 10px rgba(231, 76, 60, 0.15) !important; color: #e74c3c !important;';
                  }
              }

              let nameStyle = isMe ? 'text-shadow: 0 0 8px currentColor !important; font-weight: bold !important; color: inherit !important;' : '';
              
              const displayName = cardLivePos ? `${cardLivePos}° ${betOwnerName}` : betOwnerName;

              return `<div class="${cardClasses.join(' ').trim()}" style="${inlineStyle}">
                          <span style="${nameStyle}">${displayName}</span>
                      </div>`;
          };

          let htmlResult = '';

          if (isLiveOrFinished) {
              const full = [], partial = [], wrong = [];

              const modalSettings = {
                  scoringRules: settingsRes?.success ? (settingsRes.data?.scoringRules || STATE.scoringRules || {}) : (STATE.scoringRules || {}),
                  championshipRules: settingsRes?.success ? (settingsRes.data?.championshipRules || STATE.championshipRules || {}) : (STATE.championshipRules || {}),            };

              const toBackendChoice = (value) => {
                  if (value == null) return null;
                  const s = String(value).trim().toLowerCase();
                  if (s === 'a' || s === 'home' || s === '1') return 'A';
                  if (s === 'b' || s === 'away' || s === '2') return 'B';
                  if (s === 'draw' || s === 'x' || s === 'empate') return 'draw';
                  return value;
              };

              allBets.forEach(user => {
                  // /all-bets normalmente devolve bets como array. Mantemos
                  // fallback para objeto único para não perder participantes
                  // caso o backend/versão da API entregue uma única aposta.
                  const ub = Array.isArray(user?.bets)
                      ? user.bets[0]
                      : (user?.bets || user?.bet || null);
                  if (!ub) return;

                  const betMatch = {
                      scoreA: ub.scoreA,
                      scoreB: ub.scoreB,
                      winner: toBackendChoice(ub.choice ?? ub.winner),
                      qualifier: toBackendChoice(ub.qualifier)
                  };

                  let status;
                  try {
                      status = getMatchPointStatusForUI(
                          betMatch,
                          matchObj,
                          modalSettings,
                          isLiveOrFinished
                      );
                  } catch (statusError) {
                      // O modal nunca deve desaparecer por uma falha de cálculo
                      // visual. Fallback conservador: se houver algum critério
                      // antigo acertado, fica em parcial; caso contrário, errado.
                      console.warn('[Modal Ranking] Falha ao calcular status:', statusError);
                      const fallbackWinner = toBackendChoice(ub.choice ?? ub.winner);
                      const fallbackQualifier = toBackendChoice(ub.qualifier);
                      const fallbackResult = toBackendChoice(realResult);
                      const fallbackQual = toBackendChoice(realQual);
                      const fallbackHitWinner = fallbackWinner && fallbackResult && fallbackWinner === fallbackResult;
                      const fallbackHitQualifier = isKnockout && fallbackQualifier && fallbackQual && fallbackQualifier === fallbackQual;
                      status = {
                          points: 0,
                          category: (fallbackHitWinner && fallbackHitQualifier) ? 'full' : ((fallbackHitWinner || fallbackHitQualifier) ? 'partial' : 'wrong')
                      };
                  }

                  const cardHtml = generateUserCardHtml(user);

                  if (status.category === 'full') {
                      full.push(cardHtml);
                  } else if (status.category === 'partial') {
                      partial.push(cardHtml);
                  } else {
                      wrong.push(cardHtml);
                  }
              });

              // O modal usa sempre as 3 colunas fixas.
              // Antes, em partidas de grupos, a coluna PARCIAL era escondida;
              // com pontuação por placar isso fazia usuários que pontuavam
              // parcialmente desaparecerem do modal.
              htmlResult = `
                  <div class="bet-grid grid-3">
                      <div>
                          <div class="bet-column-title" style="color:#27ae60">🎯 Acertando (${full.length})</div>
                          ${full.join('') || '<div class="bet-user-card">—</div>'}
                      </div>
                      <div>
                          <div class="bet-column-title" style="color:#f39c12">🌓 Parcial (${partial.length})</div>
                          ${partial.join('') || '<div class="bet-user-card">—</div>'}
                      </div>
                      <div>
                          <div class="bet-column-title" style="color:#e74c3c">❌ Errando (${wrong.length})</div>
                          ${wrong.join('') || '<div class="bet-user-card">—</div>'}
                      </div>
                  </div>`;
          } else {
              const isGroupRoundMode =
                  !isKnockout &&
                  matchObj.phase === 'group' &&
                  STATE.groupBetAvailabilityMode === 'round';

              const isVisibleByAdmin = isGroupRoundMode
                  ? (
                      Number.isInteger(Number(matchObj.roundNumber)) &&
                      STATE.unlockedGroupRounds.has(Number(matchObj.roundNumber)) &&
                      !STATE.lockedGroupRounds.has(Number(matchObj.roundNumber))
                    )
                  : (
                      isKnockout
                          ? unlockedPhases.includes(matchObj.group)
                          : (unlockedPhases.includes('group') ||
                             unlockedPhases.includes(matchObj.group) ||
                             unlockedPhases.includes(matchObj.phaseName))
                    );

              if (!isVisibleByAdmin) {
                  htmlResult = `<div class="bet-locked"><div style="font-size:2rem;">🔒</div>Palpites Ocultos.</div>`;
              } else {
                  const torcida = { home: [], draw: [], away: [] };
                  allBets.forEach(u => {
                      const b = u.bets?.[0];
                      if (b && b.choice) {
                          const normalizedChoice = normalize(b.choice);
                          if (torcida[normalizedChoice]) {
                              torcida[normalizedChoice].push(generateUserCardHtml(u));
                          }
                      }
                  });

                  htmlResult = `
                      <div class="bet-grid grid-3">
                          <div>
                              <div class="bet-column-title">VITÓRIA ${matchObj.teamA} (${torcida.home.length})</div>
                              ${torcida.home.join('') || '<div class="bet-user-card">—</div>'}
                          </div>
                          <div>
                              <div class="bet-column-title">EMPATE (${torcida.draw.length})</div>
                              ${torcida.draw.join('') || '<div class="bet-user-card">—</div>'}
                          </div>
                          <div>
                              <div class="bet-column-title">VITÓRIA ${matchObj.teamB} (${torcida.away.length})</div>
                              ${torcida.away.join('') || '<div class="bet-user-card">—</div>'}
                          </div>
                      </div>`;
              }
          }

          const content = document.getElementById('detalhes-body-content');
          if (content) {
              content.innerHTML = htmlResult;
          }

          const timelineContainer = document.getElementById('modal-timeline-content') || document.getElementById('match-timeline-content');
          if (timelineContainer) {
              timelineContainer.innerHTML = renderTimelineHTML(matchObj, STATE.allBets);
          }

      } catch (e) { 
          console.error("Erro ao carregar apostas e ranking via backend:", e); 
      }
  }

  function toNumber(val) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
      if (val === null || val === undefined) return 0;
      if (typeof val === 'number') return val;

      if (typeof val === 'string') {
          if (val.includes('(')) {
              const principal = val.split(/[\/\s(]/)[0];
              return parseFloat(principal) || 0;
          }
          const cleaned = val.replace(/[^\d.-]/g, '');
          return parseFloat(cleaned) || 0;
      }

      if (typeof val === 'object') {
          return toNumber(val.total ?? val.value ?? val.all ?? 0);
      }

      return 0;
  }

  function renderStatRow(label, valA, valB, unit = "") {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
      const numA = parseFloat(valA) || 0;
      const numB = parseFloat(valB) || 0;
      const total = (numA + numB) || 1;
      const pA = (numA / total) * 100;

      const styleH = numA > numB ? "font-weight:800; color:#000;" : "font-weight:400; color:#555;";
      const styleA = numB > numA ? "font-weight:800; color:#000;" : "font-weight:400; color:#555;";

      return `
          <div class="stat-row" style="margin-bottom:12px; padding: 0 5px;">
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.7rem; margin-bottom:3px;">
                  <span style="min-width:35px; ${styleH}">${valA}${unit}</span>
                  <span style="color:#999; text-transform:uppercase; font-size:0.6rem; letter-spacing:0.5px; flex:1; text-align:center;">${label}</span>
                  <span style="min-width:35px; text-align:right; ${styleA}">${valB}${unit}</span>
              </div>
              <div style="display:flex; height:5px; background:#eee; border-radius:10px; overflow:hidden;">
                  <div style="width:${pA}%; background:#333; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
                  <div style="flex:1; background:#c62828; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);"></div>
              </div>
          </div>`;
  }

  function renderAbaEstatisticas(matchId) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, toNumber, renderStatRow } = ctx;
      const match = STATE.matches.find(m => String(m.matchId) === String(matchId));
      
      const statsSource = match?.statistics?.[0] || match?.summary?.stats?.[0];

      if (!match || !statsSource) {
          return '<div style="text-align:center; padding:40px 20px; color:#999; font-size:0.75rem;">Estatísticas técnicas em processamento...</div>';
      }

      const h = statsSource.home || {};
      const a = statsSource.away || {};

      const defensiveActionsH = toNumber(h.tackles_won) + toNumber(h.interceptions);
      const defensiveActionsA = toNumber(a.tackles_won) + toNumber(a.interceptions);

      const calcPassAcc = (obj) => {
          const total = toNumber(obj.passes);
          const acc = toNumber(obj.accurate_passes);
          return total > 0 ? Math.round((acc / total) * 100) : 0;
      };

      const mapaStats = [
          { label: 'Posse de Bola', valH: toNumber(h.ball_possession), valA: toNumber(a.ball_possession), unit: '%' },
          { label: 'xG (Gols Esperados)', valH: toNumber(h.expected_goals), valA: toNumber(a.expected_goals) },
          { label: 'Faltas Cometidas', valH: toNumber(h.fouls), valA: toNumber(a.fouls) },
          { label: 'Total de Chutes', valH: toNumber(h.total_shots), valA: toNumber(a.total_shots) },
          { label: 'Chutes no Gol', valH: toNumber(h.shots_on_target), valA: toNumber(a.shots_on_target) },
          { label: 'Chutes na Trave', valH: toNumber(h.hit_woodwork), valA: toNumber(a.hit_woodwork) },
          { label: 'Grandes Chances', valH: toNumber(h.big_chances), valA: toNumber(a.big_chances) },
          { label: 'Toques na Área', valH: toNumber(h.touches_in_penalty_area), valA: toNumber(a.touches_in_penalty_area) },
          { label: 'Passes Certos', valH: toNumber(h.accurate_passes), valA: toNumber(a.accurate_passes) },
          { label: 'Precisão de Passe', valH: calcPassAcc(h), valA: calcPassAcc(a), unit: '%' },
          { label: 'Ações Defensivas', valH: defensiveActionsH, valA: defensiveActionsA },
          { label: 'Gols Prevenidos', valH: toNumber(h.goals_prevented), valA: toNumber(a.goals_prevented) },
          { label: 'Escanteios', valH: toNumber(h.corner_kicks), valA: toNumber(a.corner_kicks) },
          { label: 'Amarelos', valH: toNumber(h.yellow_cards), valA: toNumber(a.yellow_cards) },
          { label: 'Vermelhos', valH: toNumber(h.red_cards), valA: toNumber(a.red_cards) }
      ];

      let html = `<div style="padding:15px 5px; max-height: 450px; overflow-y: auto; scrollbar-width: none;">`;

      mapaStats.forEach(stat => {
          html += renderStatRow(stat.label, stat.valH, stat.valA, stat.unit || "");
      });

      return html + `</div>`;
  }

  async function fetchTechnicalData(matchIdStr) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, syncScoresWithGoals, renderAbaEstatisticas } = ctx;
      try {
          const leagueId = localStorage.getItem('selectedLeagueId');
          if (!leagueId) {
              throw new Error('leagueId não encontrado para dados técnicos da partida');
          }
          const response = await api.get(
              `/api/matches/match-technical/${encodeURIComponent(matchIdStr)}?leagueId=${encodeURIComponent(leagueId)}`
          );
          
          if (response?.success) {
              const technicalData = response.data;
              const idx = STATE.matches.findIndex(match => String(match.matchId) === String(matchIdStr));
              
              if (idx !== -1) {
                  STATE.matches[idx] = syncScoresWithGoals({ ...STATE.matches[idx], ...technicalData });
                  const matchAtualizado = STATE.matches[idx];

                  const modalAberto = document.getElementById('modal-detalhes');
                  const openedMatchId = modalAberto?.getAttribute('data-opened-match-id');

                  if (modalAberto && String(openedMatchId) === String(matchIdStr)) {
                      const lineupsDiv = document.getElementById('modal-lineups-content');
                      if (lineupsDiv && typeof window.renderLineups === 'function') {
                          lineupsDiv.innerHTML = window.renderLineups(matchAtualizado);
                      }

                      const statsDiv = document.getElementById('stats-render-target');
                      if (statsDiv && typeof window.renderAbaEstatisticas === 'function') {
                          statsDiv.innerHTML = window.renderAbaEstatisticas(matchIdStr);
                      }
                      
                      if (typeof window.syncModalData === 'function') {
                          window.syncModalData(matchAtualizado);
                      }
                  }
              }
          }
      } catch (e) { 
          console.error("Erro ao buscar dados técnicos da partida " + matchIdStr + ":", e);
      }
  }

  async function syncModalData(updatedData = null) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, renderTimelineHTML, fetchAndRenderBets } = ctx;
      const modal = document.getElementById('modal-detalhes');
      if (!modal) return;

      const matchId = modal.getAttribute('data-opened-match-id');
      const current = updatedData || STATE.matches.find(m => String(m.matchId) === String(matchId));
      
      if (!current) {
          console.warn(`[Sync] Partida ${matchId} não encontrada no estado global.`);
          return;
      }

      const liveStatuses = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'prorrogacao', 'penaltis', 'in_progress', 'live'];
      const isLive = liveStatuses.includes(current.status);
      const isFinished = current.status === 'finished' || current.status === 'FT';

      const scoreEl = document.getElementById('modal-placar-score');
      if (scoreEl) {
          const scoreHTML = (isLive || isFinished) 
              ? `${current.scoreA} <span class="score-divider">-</span> ${current.scoreB}` 
              : '<span class="vs-label">VS</span>';
          
          if (scoreEl.innerHTML !== scoreHTML) scoreEl.innerHTML = scoreHTML;
      }

      const labelEl = document.getElementById('modal-status-label');
      if (labelEl) {
          labelEl.textContent = isLive ? 'AO VIVO' : (isFinished ? 'FINALIZADO' : 'AGENDADO');
          labelEl.className = isLive ? 'status-badge status-live animate__animated animate__pulse animate__infinite' : 'status-badge';
      }

      const tempoEl = document.getElementById('modal-placar-tempo');
      if (tempoEl) {
          if (isLive) {
              tempoEl.innerHTML = `<div class="status-badge status-live">⏱️ ${current.minute || 0}'</div>`;
          } else if (isFinished) {
              tempoEl.innerHTML = `<div class="status-badge status-finished">FIM DE JOGO</div>`;
          } else {
              tempoEl.innerHTML = `<div class="status-badge status-scheduled">Aguardando Início</div>`;
          }
      }

      const posCont = document.getElementById('possession-container');
      if (posCont && current.possession) {
          const pA = parseInt(current.possession.home || 50);
          const pB = parseInt(current.possession.away || 50);
          posCont.innerHTML = `
              <div class="possession-labels" style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:0.8rem; font-weight:bold;">
                  <span>${pA}% ${current.teamA_short || 'CASA'}</span>
                  <span>${current.teamB_short || 'FORA'} ${pB}%</span>
              </div>
              <div class="possession-bar-bg" style="height:8px; background:#eee; border-radius:4px; display:flex; overflow:hidden;">
                  <div class="bar-home" style="width: ${pA}%; background:var(--primary-color, #27ae60); transition: width 0.5s ease;"></div>
                  <div class="bar-away" style="width: ${pB}%; background:var(--secondary-color, #e74c3c); transition: width 0.5s ease;"></div>
              </div>`;
      }

      const timelineEl = document.getElementById('modal-timeline-content');
      if (timelineEl) {
          const newTimelineHTML = renderTimelineHTML(current);
          if (timelineEl.innerHTML !== newTimelineHTML) {
              timelineEl.innerHTML = newTimelineHTML;
          }
      }

      if (typeof fetchAndRenderBets === 'function') {
          try {
              await fetchAndRenderBets(current);
          } catch (e) {
              console.error("Erro ao atualizar palpites no modal:", e);
          }
      }
  };

  function renderLineups(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
      const l = match.lineups;
      
      if (!l || (!l.home && !l.away)) {
          return '<div style="text-align:center;color:#999;padding:30px;font-size:0.8rem;">Escalação ainda não confirmada pela API.</div>';
      }

      const tA = l.home || {}; 
      const tB = l.away || {};

      const renderList = (players, isRight) => {
          if (!players || !players.length) {
              return '<div style="color:#ccc;text-align:center;padding:5px;font-size:0.7rem;">—</div>';
          }

          return players.map(p => {
              const num = p.numero || '';
              const nome = p.nome || 'Jogador';
              const pos = (p.posicao || '').toUpperCase();
              
              const posClass = pos ? `pos-${pos[0]}` : '';

              let icons = '';
              if (p.gols > 0) {
                  icons += `<span title="${p.gols} gol(s)" style="margin:0 1px;">⚽<sup style="font-size:7px;">${p.gols > 1 ? p.gols : ''}</sup></span>`;
              }
              if (p.vermelho) {
                  icons += `<span style="color:red; font-size:10px; margin:0 1px;">🟥</span>`;
              } else if (p.amarelo) {
                  icons += `<span style="color:gold; font-size:10px; margin:0 1px;">🟨</span>`;
              }

              const subMin = p.saiu || p.entrou || p.sub_min;
              if (subMin) {
                  const subColor = p.saiu ? '#e53935' : '#43a047';
                  icons += `<span class="sub-icon" style="margin:0 1px; color:${subColor}; font-weight:bold;">🔄</span>`;
              }
              
              return `
                  <div class="player-row" style="display:flex; align-items:center; gap:3px; padding:4px 0; border-bottom:1px solid #f8f8f8; font-size:0.75rem; width:100%; box-sizing:border-box;">
                      ${isRight ? `
                          <div style="flex:1; display:flex; align-items:center; gap:3px; overflow:hidden; justify-content:flex-end; text-align:right;">
                              <div style="display:inline-flex; align-items:center; flex-shrink:0; gap:1px;">${icons}</div>
                              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#333; font-weight:500;">${nome}</span>
                          </div>
                          <span class="${posClass} position-badge" style="flex-shrink:0; margin:0;">${pos}</span>
                          <span class="player-number" style="flex-shrink:0; margin:0;">${num}</span>
                      ` : `
                          <span class="player-number" style="flex-shrink:0; margin:0;">${num}</span>
                          <span class="${posClass} position-badge" style="flex-shrink:0; margin:0;">${pos}</span>
                          <div style="flex:1; display:flex; align-items:center; gap:3px; overflow:hidden;">
                              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#333; font-weight:500; ${subMin && p.saiu ? 'opacity:0.7;' : ''}">${nome}</span>
                              <div style="display:inline-flex; align-items:center; flex-shrink:0; gap:1px;">${icons}</div>
                          </div>
                      `}
                  </div>`;
          }).join('');
      };

      return `
          <div id="modal-detalhes" style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding:2px; width:100%; box-sizing:border-box;">
              <div style="border-right: 1px solid #eee; padding-right: 4px; overflow:hidden;">
                  <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                      <span style="font-size:0.65rem; font-weight:800; color:#555; text-transform:uppercase;">TITULARES</span>
                      <div class="formation-badge">${tA.formation || tA.formacao || ''}</div>
                  </div>
                  ${renderList(tA.titulares || tA.players, false)}
                  
                  <div class="section-header" style="font-size:0.65rem; font-weight:800; color:#999; margin-top:20px; margin-bottom:10px; text-transform:uppercase;">RESERVAS</div>
                  ${renderList(tA.reservas || tA.substitutes, false)}
              </div>

              <div style="padding-left: 4px; overflow:hidden;">
                  <div class="section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-direction:row-reverse;">
                      <span style="font-size:0.65rem; font-weight:800; color:#555; text-transform:uppercase;">TITULARES</span>
                      <div class="formation-badge">${tB.formation || tB.formacao || ''}</div>
                  </div>
                  ${renderList(tB.titulares || tB.players, true)}
                  
                  <div class="section-header" style="font-size:0.65rem; font-weight:800; color:#999; margin-top:20px; margin-bottom:10px; text-align:right; text-transform:uppercase;">RESERVAS</div>
                  ${renderList(tB.reservas || tB.substitutes, true)}
              </div>
          </div>`;
  };

  async function abrirDetalhesPartida (matchId) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, renderTimelineHTML, fetchAndRenderBets, fetchTechnicalData } = ctx;
      const matchIdStr = String(matchId);
      
      const m = STATE.matches.find(match => String(match.matchId) === matchIdStr);
      if (!m) return;

      const oldModal = document.getElementById('modal-detalhes');
      if (oldModal) {
          oldModal.remove();
      }

      const isLive = ['1_tempo', 'intervalo', '2_tempo', '1_tet', '2_tet', 'live', 'prorrogacao', 'penaltis'].some(s => m.status.includes(s));
      const statusText = isLive ? 'AO VIVO' : (m.status === 'finished' ? 'FINALIZADO' : 'AGENDADO');

      const listaDeApostadores = STATE.allBets || [];

      const modalHtml = `
      <div id="modal-detalhes" class="modal-overlay" data-opened-match-id="${matchIdStr}">
        <div class="modal-container">
          <div class="modal-header">
            <h3 class="modal-title">⚽ DETALHES - <span id="modal-status-label">${statusText}</span></h3>
            <button id="btn-fechar-detalhes" class="btn-close-modal">&times;</button>
          </div>
          <div class="modal-body">
            
            <div class="score-card" style="display: flex; align-items: flex-start; justify-content: space-between; width: 100%; padding: 15px 0;">
                <div class="team-box">
                    <div class="modal-flag-container">${renderTeamMedia(m.teamA, m.logoA)}</div>
                    <span class="team-name">${m.teamA}</span>
                </div>
                <div class="score-center">
                    <div id="modal-placar-score" class="score-numbers" style="font-size: 2rem; font-weight: 800;">--</div>
                    <div id="modal-placar-tempo" style="font-size: 0.7rem; color: #666; text-transform: uppercase;"></div>
                </div>
                <div class="team-box">
                    <div class="modal-flag-container">${renderTeamMedia(m.teamB, m.logoB)}</div>
                    <span class="team-name">${m.teamB}</span>
                </div>
            </div>

            <div class="modal-tabs-nav" style="display: flex; gap: 10px; border-bottom: 1px solid #eee; margin-bottom: 15px;">
              <button class="tab-btn active" onclick="switchTab('aba-timeline', event)" style="padding: 10px; cursor: pointer; background: none; border: none; border-bottom: 2px solid #c62828; font-weight: bold;">Timeline</button>
              <button class="tab-btn" onclick="switchTab('aba-estatisticas', event)" style="padding: 10px; cursor: pointer; background: none; border: none; font-weight: bold;">Estatísticas</button>
              <button class="tab-btn" onclick="switchTab('aba-escalacao', event)" style="padding: 10px; cursor: pointer; background: none; border: none; font-weight: bold;">Escalação</button>
            </div>

            <div id="aba-timeline" class="tab-content" style="display: block;">
              <div id="modal-timeline-content" class="timeline-content">
                  ${typeof renderTimelineHTML === 'function' 
                      ? renderTimelineHTML(m, listaDeApostadores) 
                      : '<div style="text-align:center; padding:20px; color:#999;">Carregando linha do tempo...</div>'}
              </div>
              <div id="detalhes-body-content" class="bets-container"></div>
            </div>

            <div id="aba-estatisticas" class="tab-content" style="display: none;">
              <div id="stats-render-target"></div>
            </div>

            <div id="aba-escalacao" class="tab-content" style="display: none;">
              <div id="modal-lineups-content">
                ${(m.lineups && typeof window.renderLineups === 'function') 
                    ? window.renderLineups(m) 
                    : '<div class="loading-box" style="text-align:center; padding:30px; color:#999; font-size:0.8rem;">⚽ Buscando escalação confirmada...</div>'}
              </div>
            </div>

          </div>
        </div>
      </div>`;

      document.body.insertAdjacentHTML('beforeend', modalHtml);

      document.getElementById('btn-fechar-detalhes').onclick = () => {
          const modal = document.getElementById('modal-detalhes');
          if (modal) modal.remove();
      };

      window.syncModalData(m);

      if (typeof fetchTechnicalData === 'function') {
          fetchTechnicalData(matchIdStr);
      }

      if (typeof fetchAndRenderBets === 'function') {
          fetchAndRenderBets(m);
      }
  };

  function switchTab(tabId, event) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, renderAbaEstatisticas } = ctx;
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      document.querySelectorAll('.tab-btn').forEach(btn => {
          btn.classList.remove('active');
          btn.style.borderBottom = 'none';
          btn.style.color = '#888';
      });

      const targetTab = document.getElementById(tabId);
      if (targetTab) targetTab.style.display = 'block';

      if (event && event.currentTarget) {
          const btn = event.currentTarget;
          btn.classList.add('active');
          btn.style.borderBottom = '3px solid #c62828';
          btn.style.color = '#c62828';
      }

      if (tabId === 'aba-estatisticas') {
          const matchId = document.getElementById('modal-detalhes')?.getAttribute('data-opened-match-id');
          if (matchId && typeof renderAbaEstatisticas === 'function') {
              document.getElementById('stats-render-target').innerHTML = renderAbaEstatisticas(matchId);
          }
      }
      
      if (tabId === 'aba-escalacao') {
          const matchId = document.getElementById('modal-detalhes')?.getAttribute('data-opened-match-id');
          const m = STATE.matches.find(match => String(match.matchId) === String(matchId));
          if (m && typeof renderLineups === 'function') {
              document.getElementById('modal-lineups-content').innerHTML = renderLineups(m);
          }
      }
  };
  return {
    prepareMatchForRender,
    renderTimelineHTML,
    fetchAndRenderBets,
    toNumber,
    renderStatRow,
    renderAbaEstatisticas,
    fetchTechnicalData,
    syncModalData,
    renderLineups,
    abrirDetalhesPartida,
    switchTab,
  };
}
