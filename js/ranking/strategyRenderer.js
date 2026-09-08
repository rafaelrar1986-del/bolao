import { rankingState } from './state.js';
import { isMobile, resolveStrategyTeamLogo, parseMatchTime } from './helpers.js';
import { renderTeamMedia } from '../matches/matchesUtils.js';

export function renderStrategyView(data, mobileRoot, body, targetName = "SEU") {
    const strategyMatches = Array.isArray(data?.matches) ? data.matches :
        (Array.isArray(window.__LAST_LEADERSHIP_MATCHES__) ? window.__LAST_LEADERSHIP_MATCHES__ : []);
    const { summary, matches } = data;
    window.__LAST_SIMULATED_RANKING__ = summary.simulatedRanking || [];
    
    // Filtra e ORDENA cronologicamente os cards de secagem
    const impactMatches = matches ? matches.filter(m => m.hasImpact).sort((a, b) => {
        const tA = parseMatchTime(a);
        const tB = parseMatchTime(b);
        if (tA > 0 && tB > 0) {
            if (tA !== tB) return tA - tB;
        }
        const idA = a.matchId || a.id || 0;
        const idB = b.matchId || b.id || 0;
        return idA - idB;
    }) : [];
    
    // Atualiza as variáveis globais
    window.__CRITICAL_MATCHES__ = matches ? matches.filter(m => m.isCriticalForMiracle) : [];
    window.__CURRENT_MATCHES__ = matches || []; // Utilizado para a Transição Suave

    const ownerLabel = targetName === "SEU" ? "SEU" : targetName.toUpperCase();

    // 🏆 STATUS MATEMÁTICO — apresentação compacta; a explicação detalhada fica fora do card.

    let statusBadgeHtml = '';
    if (summary.statusBadge === 'GUARANTEED_PODIUM') {
        statusBadgeHtml = `
            <div class="strategy-status-badge strategy-status-guaranteed" role="status" aria-label="Pódio garantido">
                <span><i class="fas fa-trophy"></i> Pódio Garantido!</span>
            </div>
            <style>
                @keyframes pulse-gold { 0% { box-shadow: 0 0 0 0 rgba(255,218,68,0.4); } 70% { box-shadow: 0 0 0 7px rgba(255,218,68,0); } 100% { box-shadow: 0 0 0 0 rgba(255,218,68,0); } }
            </style>
        `;
    } else if (summary.statusBadge === 'ELIMINATED') {
        statusBadgeHtml = `
            <div class="strategy-status-badge strategy-status-eliminated" role="status" aria-label="Matematicamente eliminado">
                <span><i class="fas fa-times-circle"></i> Matematicamente Eliminado</span>
            </div>
        `;
    }

    // Cores Dinâmicas da Barra de Probabilidade
    const probColor = summary.statusBadge === 'ELIMINATED' ? '#ff6b6b' : '#2ecc71';
    const probShadow = summary.statusBadge === 'ELIMINATED' ? 'rgba(255, 107, 107, 0.6)' : 'rgba(46, 204, 113, 0.6)';

    // EXTRAS DO CAMPEONATO: grade 2x2 ao lado da melhor posição.
    // Os estados usam a mesma linguagem visual do pódio: vivo = branco,
    // acertado = verde, perdido = vermelho/tachado, bloqueado = cadeado.
    const extrasDetails = Array.isArray(summary.extrasDetails) ? summary.extrasDetails : [];
    const extraCardsHtml = extrasDetails.length > 0 ? extrasDetails.map(extra => {
        let valueHtml = '—';
        if (extra.status === 'locked') {
            valueHtml = '🔒';
        } else if (extra.kind === 'player') {
            const safeValue = String(extra.value || '—')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            valueHtml = safeValue;
        } else if (extra.value) {
            valueHtml = renderTeamMedia(
                extra.value,
                resolveStrategyTeamLogo(extra.value, extra.logoUrl || null, [
                    ...(Array.isArray(summary.teamMediaCatalog) ? summary.teamMediaCatalog : []),
                    ...strategyMatches
                ])
            ) || '—';
        }

        let scoreStyle = 'color: #ffffff; font-weight: 700;';
        let valueClass = '';
        if (extra.status === 'dead') {
            scoreStyle = 'color: #ef4444; font-weight: 500; text-decoration: line-through; opacity: 0.65;';
            valueClass = ' is-dead';
        } else if (extra.status === 'conquered') {
            scoreStyle = 'color: #4ade80; font-weight: 800;';
        }

        const safeLabel = String(extra.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
            <div class="strategy-extra-card${valueClass}">
                <div class="strategy-extra-icon" aria-hidden="true">${extra.icon || ''}</div>
                <div class="strategy-extra-label">${safeLabel}</div>
                <div class="strategy-extra-value">${valueHtml}</div>
                <div class="strategy-extra-points" style="${scoreStyle}">+${Number(extra.points || 0)}</div>
            </div>
        `;
    }).join('') : '';

    const extrasGridHtml = extraCardsHtml ? `
        <div class="strategy-extras-grid">${extraCardsHtml}</div>
    ` : '';

    // RODAPÉ DO PÓDIO: somente posição, bandeira e pontuação. Nunca exibe nome
    // do time e não cria uma legenda separada para os estados.
    const podiumCount = summary.podiumDetails?.length || 0;
    const podiumItemWidth = podiumCount > 0 ? Math.floor(100 / podiumCount) : 25;
    const podiumFooterHtml = podiumCount > 0
        ? `
        <div class="podium-strategy-footer">
            ${summary.podiumDetails.map(pick => {
                const displayPos = `${pick.position}º`;

                let positionStyle = 'color: #9ca3af;';
                let scoreStyle = 'color: #ffffff; font-weight: 600;';
                let pointsText = `+${pick.points}`;

                if (pick.status === 'dead') {
                    positionStyle = 'color: #ef4444; text-decoration: line-through; opacity: 0.6;';
                    scoreStyle = 'color: #ef4444; text-decoration: line-through; opacity: 0.6; font-weight: 400;';
                } else if (pick.status === 'conquered') {
                    scoreStyle = 'color: #4ade80; font-weight: 700;';
                } else if (pick.status === 'locked') {
                    pointsText = '🔒';
                    scoreStyle = 'color: #9ca3af;';
                }

                const teamMediaHtml = pick.status === 'locked'
                    ? '<span class="strategy-locked-flag">🔒</span>'
                    : renderTeamMedia(
                        pick.team,
                        resolveStrategyTeamLogo(pick.team, pick.logoUrl || null, [
                            ...(Array.isArray(summary.teamMediaCatalog) ? summary.teamMediaCatalog : []),
                            ...strategyMatches
                        ])
                    );

                return `
                    <div class="strategy-podium-item" style="width: ${podiumItemWidth}%;">
                        <span class="strategy-podium-position" style="${positionStyle}">${displayPos}</span>
                        <div class="strategy-podium-flag">${teamMediaHtml}</div>
                        <span class="strategy-podium-points" style="${scoreStyle}">${pointsText}</span>
                    </div>
                `;
            }).join('')}
        </div>
        ` : '';

   // 🏆 CÁLCULO DE PARTIDAS DO MILAGRE E ALERTA DINÂMICO
    const miracleAlertHtml = summary.miracleAchieved ? `
        <div style="background: linear-gradient(90deg, rgba(255, 215, 0, 0.15), rgba(255, 140, 0, 0.15)); border: 1px solid #ffda44; padding: 15px; border-radius: 12px; text-align: center; margin-bottom: 20px; box-shadow: 0 0 20px rgba(255, 218, 68, 0.2); animation: pulse 2s infinite;">
            <span style="font-size: 1.1rem; font-weight: 900; color: #ffda44; text-transform: uppercase; display: block; letter-spacing: 1px;">✨ Rota da Liderança Encontrada! ✨</span>
            
            <div style="font-size: 0.85rem; color: rgba(255,255,255,0.9); margin-top: 10px; line-height: 1.5;">
                Você chegará à <strong>1ª posição</strong> no mínimo em <strong>${summary.miracleTotalMatchesNeeded} jogos</strong>.
                <br>
                Você terá obrigatoriamente que acertar 
                <span onclick="showCriticalMatchesModal()" style="cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; color: #ffda44; font-weight: 900; padding: 2px 6px; background: rgba(255,218,68,0.1); border-radius: 4px; transition: background 0.2s; white-space: nowrap; display: inline-block; margin: 0 2px;" onmouseover="this.style.background='rgba(255,218,68,0.2)'" onmouseout="this.style.background='rgba(255,218,68,0.1)'">
                    <i class="fas fa-crosshairs"></i> ${summary.miracleCriticalMatches} jogos decisivos
                </span> 
            </div>
        </div>
        <style>
            @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,218,68,0.4); } 70% { box-shadow: 0 0 0 10px rgba(255,218,68,0); } 100% { box-shadow: 0 0 0 0 rgba(255,218,68,0); } }
            .miracle-golden-btn.selected { background: rgba(255, 218, 68, 0.2) !important; border-color: #ffda44 !important; color: #ffda44 !important; }
            .miracle-golden-btn.selected-qualifier { background: rgba(255, 218, 68, 0.2) !important; border-color: #ffda44 !important; color: #ffda44 !important; }
        </style>
    ` : '';

    // MONTAGEM COMPLETA DA STRING TEMPLATE
    const html = `
    <div class="strategy-container" style="animation: fadeIn 0.3s ease-in-out; padding: 8px;">
        
        <div class="strategy-glass-card" style="background: rgba(0, 0, 0, 0.3); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 18px; padding: 10px; margin-bottom: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); color: white;">
            
            ${statusBadgeHtml}
            ${miracleAlertHtml}

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px; flex-wrap: wrap; gap: 5px;">
                
                <div class="stat-box" style="text-align: center; flex: 1; min-width: 22%;">
                    <span style="display: block; font-size: 0.55rem; font-weight: 800; color: rgba(255,255,255,0.4); letter-spacing: 0.5px; text-transform: uppercase;">RANKING</span>
                    <span style="font-size: 1.2rem; font-weight: 800; color: #ffffff; text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);">${summary.currentPosition}º</span>
                </div>

                <div class="stat-box" style="text-align: center; flex: 1; min-width: 22%;">
                    <span style="display: block; font-size: 0.55rem; font-weight: 800; color: rgba(255,255,255,0.4); letter-spacing: 0.5px; text-transform: uppercase;">PONTOS</span>
                    <span style="font-size: 1.2rem; font-weight: 800; color: #00ffff; text-shadow: 0 0 10px rgba(0, 255, 255, 0.3);">${summary.currentPoints}</span>
                </div>

                <div class="stat-box" style="text-align: center; flex: 1; min-width: 22%;">
                    <span style="display: block; font-size: 0.55rem; font-weight: 800; color: rgba(255,255,255,0.4); letter-spacing: 0.5px; text-transform: uppercase;">PÓDIO VIVO</span>
                    <span style="font-size: 1.2rem; font-weight: 800; color: #ff9800; text-shadow: 0 0 10px rgba(255, 152, 0, 0.3);">${summary.podiumPotential || 0}</span>
                </div>

                <div class="stat-box" style="text-align: center; flex: 1; min-width: 22%;">
                    <span style="display: block; font-size: 0.55rem; font-weight: 800; color: rgba(255,255,255,0.4); letter-spacing: 0.5px; text-transform: uppercase;">TETO ${ownerLabel}</span>
                    <span style="font-size: 1.2rem; font-weight: 800; color: #ffda44; text-shadow: 0 0 10px rgba(255, 218, 68, 0.3);">${summary.maxPoints}</span>
                </div>

            </div>

            <div class="strategy-main-grid">
                <div class="strategy-reach-card">
                    <span class="strategy-reach-title">MELHOR POSIÇÃO ALCANÇÁVEL</span>
                    <div class="strategy-reach-position">${summary.maxPosition}º</div>
                    <div class="probability-section strategy-probability">
                        <div class="strategy-probability-head">
                            <span>ÍNDICE DE ALCANCE</span>
                            <span style="color: ${probColor};">${summary.probability}%</span>
                        </div>
                        <div class="strategy-probability-bar">
                            <div style="width: ${summary.probability}%; background: ${probColor}; box-shadow: 0 0 15px ${probShadow};"></div>
                        </div>
                        <div class="strategy-math-link" onclick="showMathExplanation()">
                            <i class="fas fa-microchip"></i> Ver lógica do cálculo
                        </div>
                    </div>
                </div>
                ${extrasGridHtml}
            </div>

            ${podiumFooterHtml}

        </div>

        <div class="secagem-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.05); gap: 10px; flex-wrap: wrap;">
                <h4 style="color: white; font-size: 0.8rem; font-weight: 800; margin: 0; text-transform: uppercase; letter-spacing: 1px; padding-left: 5px; border-left: 3px solid ${rankingState.strategyMode === 'simulacao' ? '#ff9800' : (rankingState.isMiracleActive ? '#ffda44' : '#ff6b6b')}; flex: 1; min-width: 150px;">
                    ${rankingState.strategyMode === 'simulacao' ? '🎮 Laboratório de Simulação' : '🎯 Foco na Secagem'}
                </h4>
                
                <div style="display: flex; gap: 8px;">
                    <button onclick="toggleMiracleMode()" title="Motor do Milagre" style="background: ${rankingState.isMiracleActive ? 'rgba(255, 218, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)'}; border: 1px solid ${rankingState.isMiracleActive ? 'rgba(255, 218, 68, 0.5)' : 'rgba(255, 255, 255, 0.1)'}; border-radius: 8px; padding: 6px 10px; cursor: pointer; color: ${rankingState.isMiracleActive ? '#ffda44' : 'rgba(255,255,255,0.6)'}; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; transition: all 0.2s; display: flex; align-items: center; gap: 5px;">
                        <i class="fas fa-magic"></i> ${rankingState.isMiracleActive ? 'Liderança ON' : 'Liderança OFF'}
                    </button>

                    <button onclick="showSimulatedRankingModal()" title="Placar Simulado" style="background: rgba(46, 204, 113, 0.15); border: 1px solid rgba(46, 204, 113, 0.4); border-radius: 8px; padding: 6px 10px; cursor: pointer; color: #2ecc71; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; transition: all 0.2s; display: flex; align-items: center; gap: 5px;">
                        <i class="fas fa-list-ol"></i> Ranking Simulado
                    </button>
                    
                    ${(rankingState.strategyMode === 'simulacao' || rankingState.isMiracleActive) ? `
                        <button onclick="resetSimulations()" title="Limpar Cenário" style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #ff9800; transition: background 0.2s; padding: 0;">
                            <i class="fas fa-undo"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
            
            <div class="secagem-grid">
                ${impactMatches.length === 0 
                    ? `<div style="text-align:center; padding: 40px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 15px; color: rgba(255,255,255,0.3);">Nenhum jogo futuro altera seu teto.</div>` 
                    : impactMatches.map(m => {
                        const mId = String(m.matchId || m.id);
                        const isKnockout = m.phase === 'knockout' || m.phase === 'mata-mata';
                        
                        const teamsArray = m.teams ? m.teams.split(/ x | X | vs | VS /) : [];
                        const teamA = teamsArray[0]?.trim() || 'Time A';
                        const teamB = teamsArray[1]?.trim() || 'Time B';

                        // A Estratégia deve usar a mesma fonte visual de equipes dos
                        // cards oficiais: renderTeamMedia(). O backend devolve logoA/logoB
                        // junto da partida; nunca montamos bandeiras diretamente aqui.
                        const teamAMedia = renderTeamMedia(teamA, m.logoA || null);
                        const teamBMedia = renderTeamMedia(teamB, m.logoB || null);
                        const teamADisplay = `${teamAMedia}${teamAMedia ? ' ' : ''}${teamA}`;
                        const teamBDisplay = `${teamBMedia}${teamBMedia ? ' ' : ''}${teamB}`;

                        const isMiracleCard = rankingState.isMiracleActive && m.isMiracleResult;
                        const currentSim = rankingState.simulatedResults[mId] || {};
                        const displaySim = (isMiracleCard && (m.miracleScoreA != null || m.miracleScoreB != null))
                            ? { ...currentSim, scoreA: currentSim.scoreA ?? m.miracleScoreA, scoreB: currentSim.scoreB ?? m.miracleScoreB }
                            : currentSim;
                        const winnerFromScore = m.winnerFromScore === true;
                        let chosenWinner = currentSim.winner;
                        let chosenQualifier = currentSim.qualifier;

                        // Se o Milagre estiver ativo, mostramos visualmente os botões do Milagre como "selecionados"
                        if (isMiracleCard && m.miracleChoice) {
                            chosenWinner = m.miracleChoice;
                            if (chosenWinner && chosenWinner.toLowerCase() === 'draw') chosenWinner = 'Draw';
                            chosenQualifier = m.miracleQualifier;
                        }

                        // Lógica de Bordas e Cores
                        const borderStyle = isMiracleCard 
                            ? 'border-left: 4px solid #ffda44; box-shadow: 0 0 15px rgba(255, 218, 68, 0.15); background: rgba(255, 218, 68, 0.05);' 
                            : `border-left: 4px solid ${rankingState.strategyMode === 'simulacao' ? '#ff9800' : '#ff6b6b'}; background: rgba(255, 255, 255, 0.03);`;

                        const btnColorClass = isMiracleCard ? 'miracle-golden-btn' : '';

                        const btnWinnerA = (chosenWinner === 'A' || chosenWinner === 'a') ? `selected ${btnColorClass}` : '';
                        const btnWinnerDraw = (chosenWinner === 'Draw' || chosenWinner === 'draw') ? `selected ${btnColorClass}` : '';
                        const btnWinnerB = (chosenWinner === 'B' || chosenWinner === 'b') ? `selected ${btnColorClass}` : '';

                        const btnQualA = (chosenQualifier === 'A' || chosenQualifier === 'a') ? `selected-qualifier ${btnColorClass}` : '';
                        const btnQualB = (chosenQualifier === 'B' || chosenQualifier === 'b') ? `selected-qualifier ${btnColorClass}` : '';

                        // 🚀 COMPACT IMPACT BADGE (Milagre & Simulação Dinâmica UNIFICADOS)
                        let impactHtml = '';
                        if (m.miracleImpact) {
                            const { posBefore, posAfter, gapBefore, gapAfter } = m.miracleImpact;
                            const hasPosChange = posBefore !== posAfter;
                            const hasGapChange = gapBefore !== gapAfter;

                            if (hasPosChange || hasGapChange) {
                                const isPosUp = posBefore > posAfter;
                                const isPosDown = posBefore < posAfter;
                                const isGapBetter = gapBefore > gapAfter;
                                const isGapWorse = gapBefore < gapAfter;

                                // Cores dinâmicas: Se for milagre subindo = Dourado, se for caindo = Vermelho
                                // Se for simulação subindo = Verde, se for caindo = Vermelho
                                let posColor = isPosUp ? (isMiracleCard ? '#ffda44' : '#2ecc71') : (isPosDown ? '#ff6b6b' : '#aaaaaa');
                                let gapColor = isGapBetter ? (isMiracleCard ? '#ffda44' : '#2ecc71') : (isGapWorse ? '#ff6b6b' : '#aaaaaa');
                                
                                // Ícones sempre presentes para indicar o movimento
                                let posIcon = isPosUp ? ' ' : (isPosDown ? ' ' : '');
                                let gapIcon = isGapBetter ? ' 🟢' : (isGapWorse ? ' 🔴' : '');

                                const bgClass = isMiracleCard ? 'rgba(255,218,68,0.1)' : 'rgba(0,0,0,0.25)';
                                const borderClass = isMiracleCard ? 'rgba(255,218,68,0.3)' : 'rgba(255,255,255,0.1)';

                                impactHtml = `
                                    <div style="display: flex; gap: 6px; font-size: 0.65rem; font-weight: 900; background: ${bgClass}; border: 1px solid ${borderClass}; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.5px; align-items: center;">
                                        ${hasPosChange ? `<span style="color: ${posColor};">${posBefore}º ➔ ${posAfter}º${posIcon}</span>` : ''}
                                        ${hasGapChange ? `<span style="color: ${gapColor}; ${hasPosChange ? `border-left: 1px solid ${borderClass}; padding-left: 6px;` : ''}">GAP: ${gapBefore} ➔ ${gapAfter}${gapIcon}</span>` : ''}
                                    </div>
                                `;
                            }
                        }

                        // 🚀 Renderização Dinâmica e Colorida dos Rivais
                        const opponentsHtml = (m.opponentsToWatch && m.opponentsToWatch.length > 0)
                            ? m.opponentsToWatch.map(op => {
                                const opName = typeof op === 'string' ? op : (op.name || 'Desconhecido');
                                const opColor = typeof op === 'string' ? 'red' : (op.color || 'red');
                                
                                let bgClass = 'rgba(231, 76, 60, 0.15)';
                                let textColor = '#ff6b6b';
                                let borderCol = 'rgba(231, 76, 60, 0.2)';
                                
                                if (opColor === 'gold') { bgClass = 'rgba(255, 218, 68, 0.15)'; textColor = '#ffda44'; borderCol = 'rgba(255, 218, 68, 0.3)'; }
                                else if (opColor === 'green') { bgClass = 'rgba(46, 204, 113, 0.15)'; textColor = '#2ecc71'; borderCol = 'rgba(46, 204, 113, 0.3)'; }
                                else if (opColor === 'locked') { bgClass = 'rgba(150, 150, 150, 0.15)'; textColor = '#aaaaaa'; borderCol = 'rgba(150, 150, 150, 0.3)'; }

                                return `<span style="background: ${bgClass}; color: ${textColor}; border: 1px solid ${borderCol}; padding: 2px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: 700;">${opName}</span>`;
                            }).join('')
                            : '<span style="color: rgba(255,255,255,0.3); font-size: 0.65rem;">Nenhum adversário direto apostou contra você.</span>';

                        const matchDate = m.date || '';
                        const matchTime = m.time ? `às ${m.time}` : '';

                        return `
                        <div class="secagem-card" data-simulation-match-id="${mId}" style="${borderStyle} border-top: 1px solid rgba(255, 255, 255, 0.05); border-right: 1px solid rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(255, 255, 255, 0.05); border-radius: 15px; padding: 15px; margin-bottom: 10px; transition: all 0.3s ease;">
                            
                            ${(matchDate || matchTime) ? `<div style="font-size: 0.6rem; color: rgba(255,255,255,0.5); margin-bottom: 8px; text-transform: uppercase; font-weight: 700; display: flex; align-items: center; gap: 4px;"><i class="far fa-calendar-alt"></i> ${matchDate} ${matchTime}</div>` : ''}

                            <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 800; color: white; font-size: 0.9rem; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px;">
                                <span style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">${teamADisplay} <span style="opacity:0.55;">x</span> ${teamBDisplay}</span>
                                <div style="display: flex; align-items: center; gap: 5px;">${impactHtml}</div>
                            </div>

                            <div style="display: flex; gap: 15px; margin-bottom: 12px; flex-wrap: wrap;">
                                ${winnerFromScore ? `
                                <div style="display: flex; flex-direction: column; min-width: 90px;">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: rgba(255,255,255,0.4); text-transform: uppercase;">Seu Palpite (Placar):</span>
                                    <span style="font-size: 0.8rem; font-weight: 800; color: #67e8f9;">${m.myChoice?.scoreA != null && m.myChoice?.scoreB != null ? `${m.myChoice.scoreA} x ${m.myChoice.scoreB}` : 'Sem Placar'}</span>
                                </div>
                                ` : `
                                <div style="display: flex; flex-direction: column; min-width: 120px;">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: rgba(255,255,255,0.4); text-transform: uppercase;">Seu Palpite (Resultado):</span>
                                    <span style="font-size: 0.8rem; font-weight: 700; color: #00ffff;">${m.myChoice?.label || 'Sem Palpite'}</span>
                                </div>
                                `}

                                ${!winnerFromScore && m.scoreScoring?.enabled && (m.myChoice?.scoreA != null || m.myChoice?.scoreB != null) ? `
                                <div style="display: flex; flex-direction: column; min-width: 90px;">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: rgba(255,255,255,0.4); text-transform: uppercase;">Seu Palpite (Placar):</span>
                                    <span style="font-size: 0.8rem; font-weight: 800; color: #67e8f9;">${m.myChoice?.scoreA ?? '-'} x ${m.myChoice?.scoreB ?? '-'}</span>
                                </div>
                                ` : ''}

                                ${isKnockout ? `
                                <div style="display: flex; flex-direction: column; min-width: 120px;">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: rgba(255,255,255,0.4); text-transform: uppercase;">Seu Palpite (Classificado):</span>
                                    <span style="font-size: 0.8rem; font-weight: 700; color: #ffda44;">${m.myChoice?.qualifierName || 'Sem Palpite'}</span>
                                </div>
                                ` : ''}
                            </div>

                            ${(rankingState.strategyMode === 'simulacao' || rankingState.isMiracleActive) ? `
                                ${!winnerFromScore ? `
                                <div style="margin-bottom: 10px; background: rgba(0,0,0,0.15); padding: 10px; border-radius: 10px; border: 1px solid ${isMiracleCard ? 'rgba(255, 218, 68, 0.3)' : 'rgba(255, 152, 0, 0.15)'};">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: ${isMiracleCard ? '#ffda44' : '#ff9800'}; text-transform: uppercase; display:block; margin-bottom:6px;">Simular Resultado:</span>
                                    <div class="sim-btn-group">
                                        <button data-sim-field="winner" data-sim-value="A" class="sim-choice-btn ${btnWinnerA}" onclick="registerSimulation('${mId}', 'winner', 'A')">${teamADisplay}</button>
                                        <button data-sim-field="winner" data-sim-value="Draw" class="sim-choice-btn ${btnWinnerDraw}" onclick="registerSimulation('${mId}', 'winner', 'Draw')">Empate</button>
                                        <button data-sim-field="winner" data-sim-value="B" class="sim-choice-btn ${btnWinnerB}" onclick="registerSimulation('${mId}', 'winner', 'B')">${teamBDisplay}</button>
                                    </div>
                                </div>
                                ` : ''}

                                ${(m.scoreScoring?.enabled || winnerFromScore) && rankingState.strategyMode === 'simulacao' ? `
                                <div style="margin-bottom: 12px; background: rgba(0,0,0,0.15); padding: 10px; border-radius: 10px; border: 1px solid ${isMiracleCard ? 'rgba(255, 218, 68, 0.3)' : 'rgba(255, 152, 0, 0.15)'};">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: ${isMiracleCard ? '#ffda44' : '#ff9800'}; text-transform: uppercase; display:block; margin-bottom:6px;">Simular Placar:</span>
                                    <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
                                        <input type="number" min="0" max="99" step="1" inputmode="numeric" aria-label="Gols de ${teamA}" value="${displaySim.scoreA ?? ''}" oninput="updateSimulationScore('${mId}', 'scoreA', this.value)" style="width:64px; text-align:center; padding:8px 6px; border-radius:8px; border:1px solid rgba(255,152,0,0.35); background:rgba(255,255,255,0.06); color:white; font-weight:800; font-size:0.9rem;">
                                        <span style="color:rgba(255,255,255,0.65); font-weight:900;">×</span>
                                        <input type="number" min="0" max="99" step="1" inputmode="numeric" aria-label="Gols de ${teamB}" value="${displaySim.scoreB ?? ''}" oninput="updateSimulationScore('${mId}', 'scoreB', this.value)" style="width:64px; text-align:center; padding:8px 6px; border-radius:8px; border:1px solid rgba(255,152,0,0.35); background:rgba(255,255,255,0.06); color:white; font-weight:800; font-size:0.9rem;">
                                    </div>
                                </div>
                                ` : ''}

                                ${(() => {
                                    const req = window.__getSimulationCardRequirements(mId);
                                    return req?.requiresQualifier ? `
                                <div style="margin-bottom: 12px; background: rgba(0,0,0,0.15); padding: 10px; border-radius: 10px; border: 1px solid ${isMiracleCard ? 'rgba(255, 218, 68, 0.3)' : 'rgba(255, 152, 0, 0.15)'};">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: ${isMiracleCard ? '#ffda44' : '#ff9800'}; text-transform: uppercase; display:block; margin-bottom:6px;">Simular Classificado:</span>
                                    <div class="sim-btn-group">
                                        <button data-sim-field="qualifier" data-sim-value="A" class="sim-choice-btn ${btnQualA}" onclick="registerSimulation('${mId}', 'qualifier', 'A')"> ${teamADisplay}</button>
                                        <button data-sim-field="qualifier" data-sim-value="B" class="sim-choice-btn ${btnQualB}" onclick="registerSimulation('${mId}', 'qualifier', 'B')"> ${teamBDisplay}</button>
                                    </div>
                                </div>
                                ` : '';
                                })()}

                            ` : ''}

                            <div class="rivals-container" style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; border: 1px dashed rgba(255,255,255,0.05);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                    <span style="font-size: 0.6rem; font-weight: 800; color: #ff6b6b; text-transform: uppercase;"><i class="fas fa-skull-crossbones"></i> SECAR RIVAIS:</span>
                                    ${m.isKamikaze ? `<span style="font-size: 0.6rem; background: rgba(255, 51, 102, 0.15); color: #ff3366; border: 1px solid rgba(255, 51, 102, 0.3); padding: 3px 6px; border-radius: 4px; font-weight: 800; display: flex; align-items: center; gap: 4px; letter-spacing: 0.5px;" title="Risco Extremo"><i class="fas fa-meteor"></i> FATOR KAMIKAZE: ${m.kamikazeFactor !== undefined ? m.kamikazeFactor + '%' : 'ATIVO'}</span>` : ''}
                                </div>
                                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                                    ${opponentsHtml}
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
            </div>
        </div>
    </div>`;

    if (isMobile()) {
        mobileRoot.innerHTML = html;
        mobileRoot.style.display = 'block';
    } else {
        const container = document.getElementById('strategy-desktop-wrapper');
        if (container) { 
            container.innerHTML = html; 
            container.style.display = 'block'; 
        }
    }
}

/* =====================
    🎮 GERENCIADOR DE ESCOLHAS DA SIMULAÇÃO
===================== */
