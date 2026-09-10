import { api } from '../api.js';
import { toast } from '../ui.js';
import { rankingState, setRankingLoader } from './state.js';
import { isMobile, getMedal, getRankingMeta, getCriterionValue, formatMoney, renderRankingFooter, renderPrizeSummary, renderTieBreakerSummary, getUserAvatar, getPreviousRanking, saveCurrentRanking, getMovement } from './helpers.js';
import { renderStrategyView } from './strategyRenderer.js';
import { getSimulationPayload, clearAllSimulationRequestTimers } from './simulation.js';
import { applyAnimations, attachMobileCardEvents, attachUserLinkEvents } from './viewEvents.js';

export async function loadRanking(targetUserId = null, targetUserName = "SEU") {
    const requestGeneration = ++rankingState.strategyRequestGeneration;
    const body = document.getElementById('ranking-body');
    const mobileRoot = document.getElementById('ranking-mobile-root');
    const strategyWrapper = document.getElementById('strategy-desktop-wrapper');
    const strategySelector = document.getElementById('strategy-selector-container');
    const userSelect = document.getElementById('strategy-user-select');
    const shareBtn = document.querySelector('.btn-share-ranking');
    const prizeSummary = document.getElementById('ranking-prize-summary');
    const tieBreakerSummary = document.getElementById('ranking-tiebreak-summary');
    const rankingFooter = document.getElementById('ranking-footer-info');
    
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!body || !mobileRoot || !leagueId) return;

    const mobile = isMobile();
    const rankingType = window.__CURRENT_RANK_TAB__ || 'official';

    window.__RANKING_CACHE__ = [];

    if (strategySelector) strategySelector.style.display = (rankingType === 'strategy') ? 'block' : 'none';
    if (strategyWrapper) strategyWrapper.style.display = 'none';
    if (rankingFooter && rankingType === 'strategy') rankingFooter.hidden = true;
    if (body.closest('table')) body.closest('table').style.display = (rankingType === 'strategy' || mobile) ? 'none' : 'table';
    
    if (shareBtn) {
        shareBtn.style.display = (rankingType === 'strategy') ? 'none' : 'flex';
    }

    if (mobile || rankingType === 'strategy') {
        mobileRoot.innerHTML = `<div class="loading" style="text-align:center; padding:40px;"><i class="fas fa-spinner fa-spin"></i> Analisando dados...</div>`;
        mobileRoot.style.display = 'block';
    } else {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center;"><div class="loading">Carregando...</div></td></tr>`;
    }

    try {
        /* =====================
            💡 MODO ESTRATÉGIA / SIMULAÇÃO
        ===================== */
        if (rankingType === 'strategy') {
            if (userSelect && userSelect.options.length <= 1) {
                const cache = window.__OFFICIAL_RANKING_CACHE__ || window.__RANKING_CACHE__ || [];
                cache.forEach(entry => {
                    const id = entry.userId || entry.user?._id || entry.user?.id;
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = `${entry.position}º - ${entry.name || entry.user?.name}`;
                    userSelect.appendChild(opt);
                });
            }
            const idParaConsulta = (targetUserId === 'me' || !targetUserId) ? null : targetUserId;
            
            let endpoint = `/api/bets/leadership-path?leagueId=${leagueId}${idParaConsulta ? `&userId=${idParaConsulta}` : ''}&mode=${rankingState.strategyMode}`;
            
            if (rankingState.strategyMode === 'simulacao') {
                endpoint += `&simulations=${encodeURIComponent(JSON.stringify(getSimulationPayload()))}`;
            }
            
            if (rankingState.isMiracleActive) {
                endpoint += `&miracle=true`;
            }

            let res = await api.get(endpoint);
            if (requestGeneration !== rankingState.strategyRequestGeneration) return;

            /* ========================================================
               🔄 PRESERVAR DADOS DO MILAGRE NO RECÁLCULO
            ======================================================== */
            if (rankingState.isMiracleActive && res.data?.summary?.miracleAchieved && res.data?.matches) {
                const realTotalMatchesNeeded = res.data.summary.miracleTotalMatchesNeeded;
                const realCriticalMatches = res.data.summary.miracleCriticalMatches;
                
                const tempSimulations = {};
                const originalMiracleMatches = {};

                // 1. Salva o objeto COMPLETO da partida do milagre original
                res.data.matches.forEach(m => {
                    if (m.isMiracleResult && m.miracleChoice) {
                        const mId = String(m.matchId || m.id); // Blindagem
                        originalMiracleMatches[mId] = m; // Copia a referência completa, incluindo o miracleImpact 🚀

                        if (!tempSimulations[mId]) tempSimulations[mId] = {};
                        
                        let choice = m.miracleChoice;
                        if (choice.toLowerCase() === 'draw') choice = 'Draw';

                        tempSimulations[mId].winner = choice;
                        // O backend exige um card completo para aceitar a
                        // simulação. Ao recalcular uma rota do Milagre,
                        // preservamos também o placar encontrado pelo oráculo.
                        const miracleScoreA = m.miracleScoreA ?? m.scoreA;
                        const miracleScoreB = m.miracleScoreB ?? m.scoreB;
                        if (Number.isInteger(miracleScoreA) && Number.isInteger(miracleScoreB)) {
                            tempSimulations[mId].scoreA = miracleScoreA;
                            tempSimulations[mId].scoreB = miracleScoreB;
                        }
                        
                        const isKnockoutPhase = m.phase === 'knockout';
                        if (isKnockoutPhase && choice !== 'Draw') {
                            tempSimulations[mId].qualifier = m.miracleQualifier || choice;
                        }
                    }
                });

                let recalculateEndpoint = `/api/bets/leadership-path?leagueId=${leagueId}${idParaConsulta ? `&userId=${idParaConsulta}` : ''}&mode=simulacao`;
                recalculateEndpoint += `&simulations=${encodeURIComponent(JSON.stringify(tempSimulations))}`;
                
                const resRecalculated = await api.get(recalculateEndpoint);
                if (requestGeneration !== rankingState.strategyRequestGeneration) return;

                if (resRecalculated.data?.matches) {
                    // 2. Devolve os dados do milagre e flags para as partidas (incluindo o miracleImpact)
                    resRecalculated.data.matches.forEach(m => {
                        const mId = String(m.matchId || m.id); // Blindagem
                        if (originalMiracleMatches[mId]) {
                            const orig = originalMiracleMatches[mId];
                            m.isMiracleResult = true;
                            m.miracleChoice = orig.miracleChoice;
                            m.miracleQualifier = orig.miracleQualifier;
                            m.opponentsToWatch = orig.opponentsToWatch || []; 
                            m.isCriticalForMiracle = orig.isCriticalForMiracle || false;
                            m.miracleImpact = orig.miracleImpact; // 🚀 Garante que a bagde visual retorne
                        }
                    });

                    // 3. Impede duplicação garantindo a checagem String === String
                    Object.keys(originalMiracleMatches).forEach(mId => {
                        const exists = resRecalculated.data.matches.some(m => String(m.matchId || m.id) === mId);
                        if (!exists) {
                            resRecalculated.data.matches.push(originalMiracleMatches[mId]);
                        }
                    });
                }

                res = resRecalculated;
                res.data.summary.miracleAchieved = true;
                res.data.summary.miracleTotalMatchesNeeded = realTotalMatchesNeeded;
                res.data.summary.miracleCriticalMatches = realCriticalMatches;
            }

            window.__LAST_LEADERSHIP_MATCHES__ = Array.isArray(res.data?.matches) ? res.data.matches : [];
            renderStrategyView(res.data, mobileRoot, body, targetUserName);
            return;
        }

        /* =====================
            🏆 MODO RANKING (OFICIAL/PARCIAL)
        ===================== */
        const res = await api.get(`/api/bets/leaderboard?type=${rankingType}&leagueId=${leagueId}`);
        
        const entries = Array.isArray(res?.data) ? res.data : (res?.data?.ranking || res?.data?.data || []);
        const rankingMeta = getRankingMeta(res, entries);
        window.__RANKING_LAST_RESPONSE__ = {
            rankingRules: res?.rankingRules || res?.data?.rankingRules || { tieBreakers: rankingMeta.tieBreakers },
            prizeZone: res?.prizeZone || res?.data?.prizeZone || rankingMeta.prizeZone
        };
        renderPrizeSummary(rankingMeta, prizeSummary);
        renderTieBreakerSummary(rankingMeta, tieBreakerSummary);
        renderRankingFooter(rankingType, res, rankingFooter, () => loadRanking(targetUserId, targetUserName));

        if (!entries.length) {
            const msg = 'Sem dados disponíveis';
            if (mobile) mobileRoot.innerHTML = `<div style="text-align:center;padding:20px;">${msg}</div>`;
            else body.innerHTML = `<tr><td colspan="12" style="text-align:center;">${msg}</td></tr>`;
            return;
        }

        const prevRanking = getPreviousRanking();
        window.__RANKING_CACHE__ = entries; 
        if (rankingType === 'official') window.__OFFICIAL_RANKING_CACHE__ = entries;
        saveCurrentRanking(entries);

        if (window.renderUserRankingSummary) window.renderUserRankingSummary();

        if (mobile) {
            const criteria = rankingMeta.tieBreakers;
            mobileRoot.style.setProperty('--ranking-criteria-count', String(Math.max(1, criteria.length)));
            mobileRoot.innerHTML = `
                <div class="ranking-mobile-list">
                    ${entries.map(e => {
                        const pos = Number(e.position || 0);
                        const userId = e.userId || e.user?._id || e.user?.id;
                        const movement = getMovement(userId, pos, prevRanking);
                        const isMe = window.currentUser && (window.currentUser._id === userId || window.currentUser.id === userId);
                        const prize = Number(e.prizeAmount || 0);
                        const criteriaHtml = criteria.length ? `
                            <div class="ranking-item-criteria">
                                ${criteria.map((key, index) => {
                                    const c = RANKING_CRITERIA_META[key];
                                    const value = getCriterionValue(e, key);
                                    return `<div class="ranking-mini-stat ${c.tone}">
                                        <span class="ranking-mini-icon">${c.icon}</span>
                                        <small>${index + 1}º ${c.label}</small>
                                        <strong>${value == null ? '—' : value}</strong>
                                    </div>`;
                                }).join('')}
                            </div>` : '';
                        return `
                        <article class="ranking-item ${isMe ? 'is-me' : ''}" data-user-id="${userId || ''}">
                            <div class="ranking-main-row">
                                <div class="user-info-flex">
                                    <span class="medal-icon">${getMedal(pos)}</span>
                                    ${getUserAvatar(e)}
                                    ${movement.label ? `<span class="ranking-move ${movement.move} ranking-move-hidden">${movement.label}</span>` : ''}
                                    <a href="#" class="ranking-user-link user-name-text" data-user-id="${userId || ''}">${e.name || e.user?.name || '-'}</a>
                                </div>
                                <div class="ranking-row-right">
                                    <div class="pts-neon"><span class="points-value" data-current="0" data-target="${Number(e.totalPoints || e.points || 0)}">0</span> pts</div>
                                    ${rankingMeta.hasPrizeZone ? `<div class="ranking-prize-value ${e.prizeEligible ? 'is-paid' : 'is-not-paid'}">${e.prizeEligible ? formatMoney(prize) : '—'}</div>` : ''}
                                </div>
                            </div>
                            ${criteriaHtml}
                        </article>`;
                    }).join('')}
                </div>`;
            attachUserLinkEvents();
            attachMobileCardEvents(entries, mobileRoot);
        } else {
            const criteria = rankingMeta.tieBreakers;
            const header = document.querySelector('.ranking-table thead tr');
            if (header) {
                header.innerHTML = `
                    <th>#</th><th>Participante</th><th>PTS<br><small>TOTAL</small></th>
                    ${criteria.map(key => `<th>${RANKING_CRITERIA_META[key].label.toUpperCase()}</th>`).join('')}
                    ${rankingMeta.hasPrizeZone ? '<th>PRÊMIO</th>' : ''}`;
            }
            const colCount = 3 + criteria.length + (rankingMeta.hasPrizeZone ? 1 : 0);
            body.innerHTML = entries.map(entry => {
                const pos = entry.position;
                const userId = entry.userId || entry.user?._id || entry.user?.id;
                const movement = getMovement(userId, pos, prevRanking);
                const isMe = window.currentUser && (window.currentUser._id === userId || window.currentUser.id === userId);
                return `
                <tr class="${isMe ? 'ranking-me' : ''}" data-move="${movement.move}">
                    <td class="position">${movement.label ? `<span class="ranking-move ${movement.move} ranking-move-hidden">${movement.label}</span>` : ''}${getMedal(pos)}</td>
                    <td><a href="#" class="ranking-user-link" data-user-id="${userId}">${getUserAvatar(entry)} <span>${entry.name || entry.user?.name || '-'}</span></a></td>
                    <td class="points"><span class="points-value" data-current="0" data-target="${entry.totalPoints || entry.points || 0}">0</span></td>
                    ${criteria.map(key => `<td class="criterion-${key}">${getCriterionValue(entry, key) == null ? '—' : getCriterionValue(entry, key)}</td>`).join('')}
                    ${rankingMeta.hasPrizeZone ? `<td class="ranking-table-prize">${entry.prizeEligible ? formatMoney(entry.prizeAmount) : '—'}</td>` : ''}
                </tr>`;
            }).join('');
            attachUserLinkEvents();
        }

        setTimeout(applyAnimations, 400);

    } catch (err) {
        // Uma resposta de uma requisição anterior nunca pode substituir nem
        // gerar mensagens sobre o cenário mais novo. O debounce evita rajadas;
        // esta guarda resolve a condição de corrida entre requests já iniciados.
        if (requestGeneration !== rankingState.strategyRequestGeneration) return;
        console.error(err);

        // 🔒 Tratamento de bloqueio de estatísticas (HTTP 423)
        if (err.status === 423 || err.isStatsLocked) {
            const blockMsg = err.message || 'O Ranking está temporariamente travado para auditoria.';
            const blockHtml = `<div style="text-align:center; padding: 60px 20px; color: rgba(255,255,255,0.6);"><i class="fas fa-lock" style="font-size:2.5rem; margin-bottom:15px; display:block; color: #ffda44;"></i><strong style="display:block; font-size:1.1rem; margin-bottom:8px;">Acesso Restrito</strong>${blockMsg}</div>`;

            if (rankingType === 'strategy') {
                if (mobileRoot && mobile) {
                    mobileRoot.innerHTML = blockHtml;
                } else if (strategyWrapper) {
                    strategyWrapper.innerHTML = blockHtml;
                    strategyWrapper.style.display = 'block';
                }
            } else {
                if (mobile) mobileRoot.innerHTML = blockHtml;
                else body.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:50px; background:rgba(255,255,255,0.02);">${blockHtml}</td></tr>`;
            }
            return;
        }

        // 💰 Tratamento de pagamento pendente (HTTP 402)
        if (err.status === 402 || err.requiresPayment) {
            if (typeof window.showPaywall === 'function') {
                window.showPaywall();
            } else {
                toast('Pagamento pendente. Acesse a área de pagamento.', 'warning');
            }
            return;
        }

        if (typeof toast === 'function') toast('Erro ao carregar ranking', 'error');
    }
}

/* =====================
    ANIMATIONS & EVENTS
===================== */

export function initRanking() {
    const tabs = document.querySelectorAll('.rank-tab');
    const shareBtn = document.querySelector('.btn-share-ranking');
    const prizeSummary = document.getElementById('ranking-prize-summary');
    const tieBreakerSummary = document.getElementById('ranking-tiebreak-summary');

    if (tabs.length) {
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const currentType = tab.dataset.type;
                window.__CURRENT_RANK_TAB__ = currentType;

                if (shareBtn) {
                    shareBtn.style.display = (currentType === 'strategy') ? 'none' : 'flex';
                }

                loadRanking();
            });
        });
    }

    const userSelect = document.getElementById('strategy-user-select');
    if (userSelect) {
        userSelect.addEventListener('change', (e) => {
            clearAllSimulationRequestTimers();
            const selectedId = e.target.value;
            const selectedName = e.target.options[e.target.selectedIndex].text.split(' - ')[1] || "SEU";
            loadRanking(selectedId, selectedName);
        });
    }

    const segmentButtons = document.querySelectorAll('.segment-btn');
    const desc = document.getElementById('toggle-description');
    
    segmentButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            clearAllSimulationRequestTimers();
            rankingState.strategyRequestGeneration++;
            segmentButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            rankingState.strategyMode = this.dataset.mode;
            
            if (rankingState.strategyMode !== 'simulacao') {
                rankingState.simulatedResults = {};
                rankingState.isMiracleActive = false;
            }

            if (desc) {
                if (rankingState.strategyMode === 'official') {
                    desc.innerText = 'Baseado nos resultados validados pela moderação.';
                } else if (rankingState.strategyMode === 'live') {
                    desc.innerText = 'Baseado no andamento de jogos ao vivo de hoje.';
                } else if (rankingState.strategyMode === 'simulacao') {
                    desc.innerText = 'Simule nos cards abaixo e cheque seu Ranking!';
                }
            }

            const select = document.getElementById('strategy-user-select');
            const selectedId = select ? select.value : null;
            const selectedName = select?.options[select.selectedIndex]?.text.split(' - ')[1] || "SEU";
            loadRanking(selectedId, selectedName);
        });
    });

    if (shareBtn && window.__CURRENT_RANK_TAB__ === 'strategy') {
        shareBtn.style.display = 'none';
    }

    loadRanking();
}

export async function preloadRanking() {
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!leagueId) return;
    try {
        const res = await api.get(`/api/bets/leaderboard?type=official&leagueId=${leagueId}`);
        const entries = res?.data || [];
        if (!entries.length) return;
        window.__OFFICIAL_RANKING_CACHE__ = entries;
        window.__RANKING_CACHE__ = entries;
        if (window.renderUserRankingSummary) window.renderUserRankingSummary();
    } catch (err) {
        // Silencia erros de bloqueio/pagamento no preload — serão tratados no load principal
        if (err.status === 423 || err.isStatsLocked || err.status === 402 || err.requiresPayment) {
            return;
        }
        console.warn('Erro preload', err);
    }
}

/* =====================
    📤 COMPARTILHAMENTO
===================== */

// Injeta o controlador no módulo de simulação sem criar dependência circular.
setRankingLoader(loadRanking);
