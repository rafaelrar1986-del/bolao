import { api } from './api.js';
import { toast } from './ui.js';
import { initUserProfile } from './userProfile.js?v=1.06';
import { renderTeamMedia } from './matches/matchesUtils.js';

/* =====================
    Helpers & State
===================== */
let strategyMode = 'official'; 
// Guarda as simulações ativas do usuário: { [matchId]: { winner: 'A'|'B'|'Draw', qualifier: 'A'|'B' } }
let simulatedResults = {}; 
// Flag para o Motor do Milagre
let isMiracleActive = false;
window.__LAST_SIMULATED_RANKING__ = []; // Guarda o último ranking calculado 
window.__CRITICAL_MATCHES__ = []; // Guarda a lista de jogos decisivos para o modal
window.__CURRENT_MATCHES__ = []; // Guarda a lista de jogos atual para a transição suave

function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function getMedal(pos) {
    if (pos === 1) return '🥇';
    if (pos === 2) return '🥈';
    return `${pos}º`;
}


const RANKING_CRITERIA_META = {
    exactScorePoints: { label: 'Pl. exato', fullLabel: 'Placar exato', icon: '🎯', tone: 'cyan' },
    podiumPoints: { label: 'Pódio', fullLabel: 'Pódio', icon: '🏆', tone: 'purple' },
    extraPoints: { label: 'Extras', fullLabel: 'Extras', icon: '✨', tone: 'gold' },
    knockoutPoints: { label: 'Mata-mata', fullLabel: 'Mata-mata', icon: '⚔️', tone: 'orange' }
};

function getRankingMeta(response, entries = []) {
    // /leaderboard retorna os participantes em `data`, mas as configurações
    // ficam no nível da resposta: { success, data: [...], rankingRules, prizeZone }.
    const data = response || {};
    const raw = Array.isArray(data?.rankingRules?.tieBreakers)
        ? data.rankingRules.tieBreakers
        : [];

    const tieBreakers = raw.filter(key => RANKING_CRITERIA_META[key]);
    const prizeZone = data?.prizeZone || { positions: 0, totalAmount: 0, distribution: [] };
    const prizePositions = Number(prizeZone?.positions || 0);
    const prizeTotal = Number(prizeZone?.totalAmount || 0);
    const prizeDistribution = Array.isArray(prizeZone?.distribution) ? prizeZone.distribution : [];
    const hasPrizeZone = prizePositions > 0 && prizeTotal > 0 &&
        prizeDistribution.some(item => Number(item?.percentage || 0) > 0);

    return { tieBreakers, prizeZone, hasPrizeZone, entries };
}

function getCriterionValue(entry, key) {
    if (key === 'exactScorePoints') {
        return entry?.exactScorePoints ?? entry?.exactScore ?? null;
    }
    if (key === 'podiumPoints') return entry?.podiumPoints ?? null;
    if (key === 'extraPoints') return entry?.extrasPoints ?? entry?.extraPoints ?? null;
    if (key === 'knockoutPoints') return entry?.knockoutPoints ?? null;
    return null;
}

function formatMoney(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL', minimumFractionDigits: 2
    });
}

function renderRankingFooter(rankingType, response, container) {
    if (!container) return;
    container.hidden = false;
    const lastUpdates = Array.isArray(response?.data)
        ? response.data.map(e => e?.lastUpdate).filter(Boolean).map(v => new Date(v).getTime()).filter(Number.isFinite)
        : [];
    const latest = lastUpdates.length ? new Date(Math.max(...lastUpdates)) : new Date();
    const time = latest.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const isPartial = rankingType === 'partial';
    container.innerHTML = `
        <div class="ranking-footer-note">
            <span class="ranking-footer-note-icon">ⓘ</span>
            <span>${isPartial
                ? 'A classificação parcial considera partidas já iniciadas.'
                : 'A classificação oficial considera apenas partidas finalizadas.'}</span>
        </div>
        <div class="ranking-footer-updated">
            <span>Atualizado em ${time}</span>
            <button type="button" class="ranking-refresh-btn" title="Atualizar classificação" aria-label="Atualizar classificação">
                <i class="fas fa-sync-alt"></i>
            </button>
        </div>`;
    const btn = container.querySelector('.ranking-refresh-btn');
    if (btn) btn.addEventListener('click', () => loadRanking());
}

function getCriterionHeaderLabel(key) {
    return RANKING_CRITERIA_META[key]?.label || key;
}

function renderPrizeSummary(meta, container) {
    if (!container) return;
    if (!meta.hasPrizeZone) {
        container.innerHTML = '';
        container.hidden = true;
        return;
    }

    const zone = meta.prizeZone;
    const distribution = [...zone.distribution]
        .filter(item => Number(item?.position || 0) >= 1 && Number(item?.position || 0) <= Number(zone.positions || 0))
        .sort((a,b) => Number(a.position) - Number(b.position));

    const paidByConfigured = distribution.map(item => ({
        position: Number(item.position),
        percentage: Number(item.percentage || 0),
        amount: Number(zone.totalAmount || 0) * Number(item.percentage || 0) / 100
    }));

    const residualConfigured = Math.max(0, Number(zone.totalAmount || 0) -
        paidByConfigured.reduce((sum, item) => sum + Math.round(item.amount * 100) / 100, 0));

    container.hidden = false;
    container.innerHTML = `
        <div class="ranking-prize-summary">
            <div class="ranking-prize-topline">
                <div class="ranking-prize-stat">
                    <span class="ranking-prize-icon">💰</span>
                    <div><small>PREMIAÇÃO TOTAL</small><strong>${formatMoney(zone.totalAmount)}</strong></div>
                </div>
                <div class="ranking-prize-stat">
                    <span class="ranking-prize-icon">🏆</span>
                    <div><small>ZONA DE PREMIAÇÃO</small><strong>TOP ${zone.positions}</strong></div>
                </div>
                <div class="ranking-prize-stat">
                    <span class="ranking-prize-icon">🎯</span>
                    <div><small>DESEMPATE POR</small><strong>${meta.tieBreakers.length} CRITÉRIO${meta.tieBreakers.length === 1 ? '' : 'S'}</strong></div>
                </div>
            </div>
            <div class="ranking-prize-distribution">
                ${paidByConfigured.map(item => `
                    <div class="ranking-prize-position ranking-prize-pos-${item.position}">
                        <span>${item.position}º LUGAR</span>
                        <strong>${item.percentage.toLocaleString('pt-BR', {maximumFractionDigits: 2})}%</strong>
                        <small>${formatMoney(item.amount)}</small>
                    </div>`).join('')}
            </div>
        </div>`;
}

function renderTieBreakerSummary(meta, container) {
    if (!container) return;
    if (!meta.tieBreakers.length) {
        container.innerHTML = '';
        container.hidden = true;
        return;
    }
    container.hidden = false;
    container.innerHTML = `
        <div class="ranking-tiebreak-summary">
            <span class="ranking-tiebreak-title">Critérios de desempate (em ordem):</span>
            <div class="ranking-tiebreak-list">
                ${meta.tieBreakers.map((key, i) => {
                    const c = RANKING_CRITERIA_META[key];
                    return `<span class="ranking-tiebreak-chip ${c.tone}"><b>${i + 1}º</b> ${c.icon} ${c.fullLabel}</span>`;
                }).join('<span class="ranking-tiebreak-dot">•</span>')}
            </div>
        </div>`;
}

function getUserAvatar(entry) {
    const avatar = entry?.user?.avatar || entry?.avatar;
    if (avatar) return `<img class="ranking-avatar" src="${avatar}" alt="" loading="lazy">`;
    const name = entry?.name || entry?.user?.name || '?';
    return `<span class="ranking-avatar ranking-avatar-fallback">${name.trim().charAt(0).toUpperCase()}</span>`;
}

function getPreviousRanking() {
    const leagueId = localStorage.getItem('selectedLeagueId');
    try {
        return JSON.parse(localStorage.getItem(`__RANKING_PREV_${leagueId}__`)) || [];
    } catch {
        return [];
    }
}

function saveCurrentRanking(entries) {
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!leagueId) return;
    const simplified = entries.map(e => ({
        userId: e.userId || e.user?._id || e.user?.id,
        position: e.position
    }));
    localStorage.setItem(`__RANKING_PREV_${leagueId}__`, JSON.stringify(simplified));
}

function getMovement(userId, currentPos, prevRanking) {
    const prev = prevRanking.find(p => p.userId === userId);
    if (!prev) return { label: '🆕', move: 'new' };
    const diff = prev.position - currentPos;
    if (diff > 0) return { label: `+${diff} ⬆️`, move: 'up' };
    if (diff < 0) return { label: `${diff} ⬇️`, move: 'down' };
    return { label: '', move: 'same' };
}

// Helper global para converter data e hora das partidas em Timestamp (Usado para ordenação cronológica)
function parseMatchTime(match) {
    if (!match.date) return 0; 
    try {
        const cleanDate = match.date.trim(); 
        if (!cleanDate.includes('/')) return 0;

        const parts = cleanDate.split('/');
        const dia = parseInt(parts[0], 10);
        const mes = parseInt(parts[1], 10) - 1; 
        const ano = parts[2] ? parseInt(parts[2], 10) : new Date().getFullYear();

        let hora = 0, min = 0;
        if (match.time) {
            const timeParts = match.time.trim().split(':');
            hora = parseInt(timeParts[0], 10) || 0;
            min = parseInt(timeParts[1], 10) || 0;
        }

        const timeMs = Date.UTC(ano, mes, dia, hora, min, 0, 0);
        return isNaN(timeMs) ? 0 : timeMs;
    } catch (e) {
        return 0; 
    }
}

/* =====================
    🔢 Contador animado
===================== */
function animateNumber(el, to) {
    if (!el) return;
    const from = Number(el.dataset.current || 0);
    if (from === to) {
        el.textContent = to;
        return;
    }
    const duration = 500;
    const start = performance.now();
    function tick(now) {
        const progress = Math.min((now - start) / duration, 1);
        const value = Math.round(from + (to - from) * progress);
        el.textContent = value;
        if (progress < 1) requestAnimationFrame(tick);
    }
    el.dataset.current = to;
    requestAnimationFrame(tick);
}

window.showMathExplanation = function() {
    const explanation = `
        <div style="text-align: left; font-size: 0.9rem; line-height: 1.4;">
            <p>Este percentual reflete sua <b>Capacidade de Alcance</b> baseada no estado atual do torneio:</p>
            <ul style="padding-left: 20px; margin-bottom: 15px;">
                <li><b>Cenário de Ouro:</b> Simulamos que você acerta 100% dos jogos futuros.</li>
                <li><b>Fator Pódio:</b> Verificamos se seus times de pódio (1º-4º) ainda estão vivos.</li>
                <li><b>Gap vs Potencial:</b> Comparamos a distância para o líder com os pontos que ainda restam.</li>
                <li><b>Fator Kamikaze:</b> Avalia o risco extremo da rota. Se ativo, indica que sua liderança depende ativamente de zebras e de secar diretamente múltiplos rivais.</li>
            </ul>
            <div style="background: #f8f9fa; padding: 10px; border-radius: 8px; border: 1px solid #ddd; font-family: monospace; text-align: center;">
                Probabilidade = (Potencial_Vivo - Gap_Líder) / Potencial_Vivo
            </div>
        </div>
    `;

    if (window.Swal) {
        Swal.fire({
            title: 'Análise Estatística',
            html: explanation,
            icon: 'info',
            confirmButtonText: 'Entendi!',
            confirmButtonColor: '#1a2a6c'
        });
    } else {
        alert("Cálculo baseado em: (Potencial de pontos vivos - distância para o líder) / pontos totais restantes.");
    }
};

/* =====================
    🧠 RENDER ESTRATÉGIA / SIMULAÇÃO
===================== */
function renderStrategyView(data, mobileRoot, body, targetName = "SEU") {
    const { summary, matches } = data;
    window.__LAST_SIMULATED_RANKING__ = summary.simulatedRanking || [];
    window.__LAST_LEADERSHIP_MATCHES__ = matches || [];
    
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

    // 🏆 BADGES DE STATUS MATEMÁTICO (Zona de Premiação)
    // A zona é definida por prizeZone.positions e é independente do podiumSize,
    // que pertence exclusivamente ao pódio dos times.
    const prizeZonePositions = Number(summary.prizeZonePositions ?? summary.prizeZone?.positions ?? 0);
    const prizeZoneLabel = prizeZonePositions > 0 ? `Top ${prizeZonePositions}` : 'zona de premiação';
    let statusBadgeHtml = '';
    if (summary.statusBadge === 'GUARANTEED_PRIZE_ZONE' || summary.statusBadge === 'GUARANTEED_PODIUM') {
        statusBadgeHtml = `
            <div style="background: linear-gradient(90deg, rgba(255, 215, 0, 0.15), rgba(46, 204, 113, 0.15)); border: 1px solid #ffda44; padding: 15px; border-radius: 12px; text-align: center; margin-bottom: 25px; box-shadow: 0 0 20px rgba(255, 218, 68, 0.2); animation: pulse-gold 2s infinite;">
                <span style="font-size: 1.2rem; font-weight: 900; color: #ffda44; text-transform: uppercase; display: block; letter-spacing: 1px;"><i class="fas fa-trophy"></i> Pódio Garantido!</span>
                <div style="font-size: 0.85rem; color: rgba(255,255,255,0.9); margin-top: 8px; line-height: 1.4;">Você está matematicamente garantido na zona de premiação${prizeZonePositions > 0 ? ` (${prizeZoneLabel})` : ''}! Mesmo no pior cenário possível, sua posição final permanece dentro da zona.</div>
            </div>
            <style>
                @keyframes pulse-gold { 0% { box-shadow: 0 0 0 0 rgba(255,218,68,0.4); } 70% { box-shadow: 0 0 0 10px rgba(255,218,68,0); } 100% { box-shadow: 0 0 0 0 rgba(255,218,68,0); } }
            </style>
        `;
    } else if (summary.statusBadge === 'ELIMINATED') {
        statusBadgeHtml = `
            <div style="background: linear-gradient(90deg, rgba(231, 76, 60, 0.15), rgba(231, 76, 60, 0.05)); border: 1px solid #e74c3c; padding: 15px; border-radius: 12px; text-align: center; margin-bottom: 25px; box-shadow: 0 0 15px rgba(231, 76, 60, 0.2);">
                <span style="font-size: 1.2rem; font-weight: 900; color: #ff6b6b; text-transform: uppercase; display: block; letter-spacing: 1px;"><i class="fas fa-times-circle"></i> Matematicamente Eliminado</span>
                <div style="font-size: 0.85rem; color: rgba(255,255,255,0.9); margin-top: 8px; line-height: 1.4;">Não há mais pontos suficientes em disputa para você alcançar a zona de premiação${prizeZonePositions > 0 ? ` (${prizeZoneLabel})` : ''}. Mesmo no melhor cenário possível, sua posição final fica fora da zona.</div>
            </div>
        `;
    }

    // Cores Dinâmicas da Barra de Probabilidade
    const probColor = summary.statusBadge === 'ELIMINATED' ? '#ff6b6b' : '#2ecc71';
    const probShadow = summary.statusBadge === 'ELIMINATED' ? 'rgba(255, 107, 107, 0.6)' : 'rgba(46, 204, 113, 0.6)';

    // GERAÇÃO DINÂMICA DO RODAPÉ DO PÓDIO (respeita podiumSize configurado pelo admin)
    const podiumCount = summary.podiumDetails?.length || 0;
    const podiumItemWidth = podiumCount > 0 ? Math.floor(100 / podiumCount) : 25;
    const podiumFooterHtml = podiumCount > 0
        ? `
        <div class="podium-strategy-footer" style="margin-top: 16px; padding: 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; flex-wrap: wrap; box-shadow: inset 0 1px 2px rgba(255,255,255,0.02); width: 100%; box-sizing: border-box;">
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
                }

                const teamMediaHtml = renderTeamMedia(pick.team, pick.logoUrl) || '';

                return `
                    <div style="display: flex; flex-direction: column; align-items: center; width: ${podiumItemWidth}%; min-width: 60px; text-align: center; font-family: system-ui, sans-serif; padding: 4px 2px; box-sizing: border-box;">
                        <div style="font-size: 11px; display: flex; align-items: center; justify-content: center; gap: 4px; margin-bottom: 2px;">
                            <span style="${positionStyle}">${displayPos}</span>
                            ${teamMediaHtml}
                        </div>
                        <span style="font-size: 13px; ${scoreStyle}">
                            ${pointsText}
                        </span>
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
    <div class="strategy-container" style="animation: fadeIn 0.3s ease-in-out; padding: 15px;">
        
        <div class="strategy-glass-card" style="background: rgba(0, 0, 0, 0.3); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 25px; margin-bottom: 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); color: white;">
            
            ${statusBadgeHtml}
            ${miracleAlertHtml}

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; flex-wrap: wrap; gap: 10px;">
                
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

            <div style="text-align: center; margin-bottom: 20px;">
                <span style="display: block; font-size: 0.7rem; font-weight: 800; color: rgba(255,255,255,0.6); letter-spacing: 1px;">POSIÇÃO MÁXIMA ALCANÇÁVEL</span>
                <div style="font-size: 5rem; font-weight: 900; line-height: 1; background: linear-gradient(180deg, #ffffff 40%, rgba(255,255,255,0.1)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 10px 0; letter-spacing: -2px;">${summary.maxPosition}º</div>
            </div>

            <div class="probability-section" style="margin-top: 20px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 800; margin-bottom: 8px;">
                    <span style="opacity: 0.7; text-transform: uppercase;">Chance de Título</span>
                    <span style="color: ${probColor};">${summary.probability}%</span>
                </div>
                <div style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 10px; overflow: hidden;">
                    <div style="width: ${summary.probability}%; height: 100%; background: ${probColor}; box-shadow: 0 0 15px ${probShadow}; transition: width 1s ease-in-out; background-color: ${probColor};"></div>
                </div>
                <div style="font-size: 0.65rem; color: rgba(255,255,255,0.3); text-align: center; margin-top: 12px; cursor: pointer;" onclick="showMathExplanation()">
                    <i class="fas fa-microchip"></i> Ver lógica do cálculo
                </div>
            </div>

            ${podiumFooterHtml}

        </div>

        <div class="secagem-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.05); gap: 10px; flex-wrap: wrap;">
                <h4 style="color: white; font-size: 0.8rem; font-weight: 800; margin: 0; text-transform: uppercase; letter-spacing: 1px; padding-left: 5px; border-left: 3px solid ${strategyMode === 'simulacao' ? '#ff9800' : (isMiracleActive ? '#ffda44' : '#ff6b6b')}; flex: 1; min-width: 150px;">
                    ${strategyMode === 'simulacao' ? '🎮 Laboratório de Simulação' : '🎯 Foco na Secagem'}
                </h4>
                
                <div style="display: flex; gap: 8px;">
                    <button onclick="toggleMiracleMode()" title="Motor do Milagre" style="background: ${isMiracleActive ? 'rgba(255, 218, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)'}; border: 1px solid ${isMiracleActive ? 'rgba(255, 218, 68, 0.5)' : 'rgba(255, 255, 255, 0.1)'}; border-radius: 8px; padding: 6px 10px; cursor: pointer; color: ${isMiracleActive ? '#ffda44' : 'rgba(255,255,255,0.6)'}; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; transition: all 0.2s; display: flex; align-items: center; gap: 5px;">
                        <i class="fas fa-magic"></i> ${isMiracleActive ? 'Liderança ON' : 'Liderança OFF'}
                    </button>

                    <button onclick="showSimulatedRankingModal()" title="Placar Simulado" style="background: rgba(46, 204, 113, 0.15); border: 1px solid rgba(46, 204, 113, 0.4); border-radius: 8px; padding: 6px 10px; cursor: pointer; color: #2ecc71; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; transition: all 0.2s; display: flex; align-items: center; gap: 5px;">
                        <i class="fas fa-list-ol"></i> Ranking Simulado
                    </button>
                    
                    ${(strategyMode === 'simulacao' || isMiracleActive) ? `
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

                        const currentSim = simulatedResults[mId] || {};
                        const winnerFromScore = m.winnerFromScore === true;
                        let chosenWinner = currentSim.winner;
                        let chosenQualifier = currentSim.qualifier;

                        const isMiracleCard = isMiracleActive && m.isMiracleResult;

                        // Se o Milagre estiver ativo, mostramos visualmente os botões do Milagre como "selecionados"
                        if (isMiracleCard && m.miracleChoice) {
                            chosenWinner = m.miracleChoice;
                            if (chosenWinner && chosenWinner.toLowerCase() === 'draw') chosenWinner = 'Draw';
                            chosenQualifier = m.miracleQualifier;
                        }

                        // Lógica de Bordas e Cores
                        const borderStyle = isMiracleCard 
                            ? 'border-left: 4px solid #ffda44; box-shadow: 0 0 15px rgba(255, 218, 68, 0.15); background: rgba(255, 218, 68, 0.05);' 
                            : `border-left: 4px solid ${strategyMode === 'simulacao' ? '#ff9800' : '#ff6b6b'}; background: rgba(255, 255, 255, 0.03);`;

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
                        <div class="secagem-card" style="${borderStyle} border-top: 1px solid rgba(255, 255, 255, 0.05); border-right: 1px solid rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(255, 255, 255, 0.05); border-radius: 15px; padding: 15px; margin-bottom: 10px; transition: all 0.3s ease;">
                            
                            ${(matchDate || matchTime) ? `<div style="font-size: 0.6rem; color: rgba(255,255,255,0.5); margin-bottom: 8px; text-transform: uppercase; font-weight: 700; display: flex; align-items: center; gap: 4px;"><i class="far fa-calendar-alt"></i> ${matchDate} ${matchTime}</div>` : ''}

                            <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 800; color: white; font-size: 0.9rem; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px;">
                                <span>${m.teams}</span>
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

                            ${(strategyMode === 'simulacao' || isMiracleActive) ? `
                                ${!winnerFromScore ? `
                                <div style="margin-bottom: 10px; background: rgba(0,0,0,0.15); padding: 10px; border-radius: 10px; border: 1px solid ${isMiracleCard ? 'rgba(255, 218, 68, 0.3)' : 'rgba(255, 152, 0, 0.15)'};">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: ${isMiracleCard ? '#ffda44' : '#ff9800'}; text-transform: uppercase; display:block; margin-bottom:6px;">Simular Resultado:</span>
                                    <div class="sim-btn-group">
                                        <button class="sim-choice-btn ${btnWinnerA}" onclick="registerSimulation('${mId}', 'winner', 'A')">${teamA}</button>
                                        <button class="sim-choice-btn ${btnWinnerDraw}" onclick="registerSimulation('${mId}', 'winner', 'Draw')">Empate</button>
                                        <button class="sim-choice-btn ${btnWinnerB}" onclick="registerSimulation('${mId}', 'winner', 'B')">${teamB}</button>
                                    </div>
                                </div>
                                ` : ''}

                                        ${(m.scoreScoring?.enabled || winnerFromScore) && strategyMode === 'simulacao' ? `
                                <div style="margin-bottom: 12px; background: rgba(0,0,0,0.15); padding: 10px; border-radius: 10px; border: 1px solid rgba(255, 152, 0, 0.15);">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: #ff9800; text-transform: uppercase; display:block; margin-bottom:6px;">Simular Placar:</span>
                                    <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
                                        <input type="number" min="0" max="99" step="1" inputmode="numeric" aria-label="Gols de ${teamA}" value="${currentSim.scoreA ?? ''}" onchange="updateSimulationScore('${mId}', 'scoreA', this.value)" style="width:64px; text-align:center; padding:8px 6px; border-radius:8px; border:1px solid rgba(255,152,0,0.35); background:rgba(255,255,255,0.06); color:white; font-weight:800; font-size:0.9rem;">
                                        <span style="color:rgba(255,255,255,0.65); font-weight:900;">×</span>
                                        <input type="number" min="0" max="99" step="1" inputmode="numeric" aria-label="Gols de ${teamB}" value="${currentSim.scoreB ?? ''}" onchange="updateSimulationScore('${mId}', 'scoreB', this.value)" style="width:64px; text-align:center; padding:8px 6px; border-radius:8px; border:1px solid rgba(255,152,0,0.35); background:rgba(255,255,255,0.06); color:white; font-weight:800; font-size:0.9rem;">
                                    </div>
                                </div>
                                ` : ''}

                                ${isKnockout ? `
                                <div style="margin-bottom: 12px; background: rgba(0,0,0,0.15); padding: 10px; border-radius: 10px; border: 1px solid ${isMiracleCard ? 'rgba(255, 218, 68, 0.3)' : 'rgba(255, 152, 0, 0.15)'};">
                                    <span style="font-size: 0.55rem; font-weight: 800; color: ${isMiracleCard ? '#ffda44' : '#ff9800'}; text-transform: uppercase; display:block; margin-bottom:6px;">Simular Classificado:</span>
                                    <div class="sim-btn-group">
                                        <button class="sim-choice-btn ${btnQualA}" onclick="registerSimulation('${mId}', 'qualifier', 'A')"> ${teamA}</button>
                                        <button class="sim-choice-btn ${btnQualB}" onclick="registerSimulation('${mId}', 'qualifier', 'B')"> ${teamB}</button>
                                    </div>
                                </div>
                                ` : ''}

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
function getStrategyMatchData(matchId) {
    const id = String(matchId);
    const source = Array.isArray(window.__LAST_LEADERSHIP_MATCHES__)
        ? window.__LAST_LEADERSHIP_MATCHES__
        : [];
    return source.find(item => String(item.matchId || item.id) === id) || null;
}

/**
 * Verifica se o card está COMPLETO antes de consultar o backend.
 * A exigência de cada campo segue exatamente o que o card apresenta:
 * - placar: quando winnerFromScore está ativo ou há pontuação por placar;
 * - vencedor: quando winnerFromScore está desativado;
 * - classificado: em mata-mata, pois é um palpite independente.
 *
 * Importante: esta função NÃO consulta o backend. Ela apenas decide se o
 * estado local da simulação já contém todos os dados necessários.
 */
function isSimulationCardComplete(matchId) {
    const id = String(matchId);
    const m = getStrategyMatchData(id);
    const sim = simulatedResults[id] || {};
    if (!m) return false;

    const isKnockout = m.phase === 'knockout' || m.phase === 'mata-mata';
    const winnerFromScore = m.winnerFromScore === true;
    const requiresScore = winnerFromScore || m.scoreScoring?.enabled === true;
    const requiresWinner = !winnerFromScore;
    const requiresQualifier = isKnockout;

    const scoreComplete = Number.isInteger(sim.scoreA) && sim.scoreA >= 0
        && Number.isInteger(sim.scoreB) && sim.scoreB >= 0;
    const winnerComplete = sim.winner === 'A' || sim.winner === 'B' || sim.winner === 'Draw' || sim.winner === 'draw';
    const qualifierComplete = sim.qualifier === 'A' || sim.qualifier === 'B';

    if (requiresScore && !scoreComplete) return false;
    if (requiresWinner && !winnerComplete) return false;
    if (requiresQualifier && !qualifierComplete) return false;

    return true;
}

function shouldRecalculateSimulationCard(matchId) {
    return isSimulationCardComplete(matchId);
}

window.registerSimulation = function(matchId, field, value) {
    matchId = String(matchId); // Blindagem de Tipo

    // TRANSIÇÃO SUAVE: Se o milagre estiver ativo e o usuário clicar,
    // nós herdamos a rota do milagre para a simulação manual!
    if (isMiracleActive) {
        isMiracleActive = false;
        strategyMode = 'simulacao';
        simulatedResults = {};
        
        if (window.__CURRENT_MATCHES__) {
            window.__CURRENT_MATCHES__.forEach(m => {
                if (m.isMiracleResult && m.miracleChoice) {
                    const mId = String(m.matchId || m.id);
                    let choice = m.miracleChoice;
                    
                    if (choice.toLowerCase() === 'draw') choice = 'Draw';
                    
                    simulatedResults[mId] = { winner: choice };
                    
                    const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';
                    if (isKnockoutPhase && choice !== 'Draw' && m.miracleQualifier) {
                        simulatedResults[mId].qualifier = m.miracleQualifier;
                    }
                }
            });
        }
    }

    if (!simulatedResults[matchId]) {
        simulatedResults[matchId] = {};
    }

    // Toggle: desmarca se clicar de novo
    if (simulatedResults[matchId][field] === value) {
        delete simulatedResults[matchId][field];
        if (Object.keys(simulatedResults[matchId]).length === 0) {
            delete simulatedResults[matchId];
        }
    } else {
        simulatedResults[matchId][field] = value;
    }

    const select = document.getElementById('strategy-user-select');
    const selectedId = select ? select.value : null;
    const selectedName = select?.options[select.selectedIndex]?.text.split(' - ')[1] || "SEU";
    
    // Altera visualmente a aba superior para Simulador
    document.querySelectorAll('.segment-btn').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.mode === 'simulacao') b.classList.add('active');
    });

    // Só consulta o backend quando TODOS os campos exigidos pelo card
    // estiverem preenchidos. Antes disso, a alteração fica somente no estado
    // local e não dispara nenhuma chamada de rede.
    if (shouldRecalculateSimulationCard(matchId)) {
        loadRanking(selectedId, selectedName);
    }
};

window.updateSimulationScore = function(matchId, field, rawValue) {
    matchId = String(matchId);
    if (field !== 'scoreA' && field !== 'scoreB') return;

    const raw = String(rawValue ?? '').trim();
    if (!simulatedResults[matchId]) simulatedResults[matchId] = {};

    if (raw === '') {
        delete simulatedResults[matchId][field];
    } else {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 0 || value > 99) return;
        simulatedResults[matchId][field] = value;
    }

    // O vencedor só é derivado do placar quando a regra da liga determina
    // winnerFromScore=true. Nessa configuração não existe escolha manual de vencedor.
    const sim = simulatedResults[matchId];
    const matchData = Array.isArray(window.__LAST_LEADERSHIP_MATCHES__)
        ? window.__LAST_LEADERSHIP_MATCHES__.find(item => String(item.matchId) === matchId)
        : null;
    if (matchData?.winnerFromScore === true && Number.isInteger(sim.scoreA) && Number.isInteger(sim.scoreB)) {
        sim.winner = sim.scoreA > sim.scoreB ? 'A' : (sim.scoreB > sim.scoreA ? 'B' : 'Draw');
    }

    if (Object.keys(sim).length === 0) delete simulatedResults[matchId];

    const select = document.getElementById('strategy-user-select');
    const selectedId = select ? select.value : null;
    const selectedName = select?.options[select.selectedIndex]?.text.split(' - ')[1] || 'SEU';

    document.querySelectorAll('.segment-btn').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.mode === 'simulacao') b.classList.add('active');
    });

    // O placar pode ser digitado em duas etapas (A e B). Não consulte o
    // backend enquanto o card estiver incompleto; a consulta acontece apenas
    // quando placar + vencedor/classificado exigidos pelo card estiverem
    // todos preenchidos.
    if (shouldRecalculateSimulationCard(matchId)) {
        loadRanking(selectedId, selectedName);
    }
};

/* =====================
    LOAD RANKING
===================== */
export async function loadRanking(targetUserId = null, targetUserName = "SEU") {
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
            
            let endpoint = `/api/bets/leadership-path?leagueId=${leagueId}${idParaConsulta ? `&userId=${idParaConsulta}` : ''}&mode=${strategyMode}`;
            
            if (strategyMode === 'simulacao') {
                endpoint += `&simulations=${encodeURIComponent(JSON.stringify(simulatedResults))}`;
            }
            
            if (isMiracleActive) {
                endpoint += `&miracle=true`;
            }

            let res = await api.get(endpoint);

            /* ========================================================
               🔄 PRESERVAR DADOS DO MILAGRE NO RECÁLCULO
            ======================================================== */
            if (isMiracleActive && res.data?.summary?.miracleAchieved && res.data?.matches) {
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
                        
                        const isKnockoutPhase = m.phase === 'knockout' || m.phase === 'mata-mata';
                        if (isKnockoutPhase && choice !== 'Draw') {
                            tempSimulations[mId].qualifier = m.miracleQualifier || choice;
                        }
                    }
                });

                let recalculateEndpoint = `/api/bets/leadership-path?leagueId=${leagueId}${idParaConsulta ? `&userId=${idParaConsulta}` : ''}&mode=simulacao`;
                recalculateEndpoint += `&simulations=${encodeURIComponent(JSON.stringify(tempSimulations))}`;
                
                const resRecalculated = await api.get(recalculateEndpoint);

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
        renderRankingFooter(rankingType, res, rankingFooter);

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
function applyAnimations() {
    document.querySelectorAll('.is-me').forEach(el => el.classList.add('ranking-me-glow'));
    document.querySelectorAll('.ranking-move.up, .ranking-move.down').forEach(el => {
        el.classList.remove('ranking-move-hidden');
        el.classList.add('ranking-move-animate');
    });
    document.querySelectorAll('.points-value').forEach((el, i) => {
        const target = Number(el.dataset.target);
        if (i < 40) animateNumber(el, target);
        else el.textContent = target;
    });
}

function attachMobileCardEvents(entries, mobileRoot) {
    mobileRoot.querySelectorAll('.pts-neon').forEach((el, idx) => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();

            const item = el.closest('.ranking-item');
            const existing = item.querySelector('.user-score-card');

            if (existing) {
                existing.remove();
                return;
            }

            mobileRoot.querySelectorAll('.user-score-card').forEach(c => c.remove());

            const entry = entries[idx];
            const n = (v) => Number(v || 0);

            // Classificação dos grupos: soma por grupo a partir do breakdown
            // real calculado pelo backend. Não usa extrasPoints.
            const qualificationByGroup = new Map();
            (Array.isArray(entry.groupQualificationBreakdown)
                ? entry.groupQualificationBreakdown
                : []
            ).forEach(row => {
                const group = String(row.group || '').trim();
                if (!group) return;
                qualificationByGroup.set(
                    group,
                    n(qualificationByGroup.get(group)) + n(row.points)
                );
            });

            const groupDetails = [
                { label: 'Partidas', points: n(entry.groupMatchPoints) },
                { label: 'Classificação', points: n(entry.groupQualificationPoints), key: 'qualification' }
            ];

            const knockoutDetails = [
                { label: 'Partidas', points: n(entry.knockoutMatchPoints) },
                { label: 'Classificados', points: n(entry.knockoutQualifierPoints) }
            ];

            const podiumDetails = Array.isArray(entry.podiumBreakdown)
                ? entry.podiumBreakdown.map((value, index) => ({
                    label: `${index + 1}º lugar`,
                    points: n(value)
                }))
                : [];

            const extrasDetails = [
                { label: 'Artilheiro', points: n(entry.topScorerPoints) },
                { label: 'Melhor Ataque', points: n(entry.bestAttackPoints) },
                { label: 'Pior Defesa', points: n(entry.worstDefensePoints) },
                { label: 'Zebra', points: n(entry.upsetPoints) }
            ].filter(detail => detail.points > 0);

            const categories = [
                {
                    key: 'groups',
                    label: 'Grupos',
                    points: n(entry.groupPhasePoints),
                    details: groupDetails
                },
                {
                    key: 'knockout',
                    label: 'Mata-mata',
                    points: n(entry.knockoutPoints),
                    details: knockoutDetails
                },
                {
                    key: 'podium',
                    label: 'Pódio',
                    points: n(entry.podiumPoints),
                    details: podiumDetails
                },
                ...(n(entry.extrasPoints) > 0 ? [{
                    key: 'extras',
                    label: 'Extras',
                    points: n(entry.extrasPoints),
                    details: extrasDetails
                }] : [])
            ].filter(category => category.points > 0);

            const rankingMeta = getRankingMeta(
                window.__RANKING_LAST_RESPONSE__ || {},
                entries
            );
            const tieBreakers = Array.isArray(rankingMeta?.tieBreakers)
                ? rankingMeta.tieBreakers
                : [];

            const tieBreakdown = tieBreakers.length ? `
                <div class="user-score-tiebreak-section">
                    <div class="user-score-tiebreak-title">Desempate</div>
                    <div class="user-score-tiebreak-grid">
                        ${tieBreakers.map((key, index) => {
                            const meta = RANKING_CRITERIA_META[key] || {
                                label: key,
                                icon: '•',
                                tone: 'cyan'
                            };
                            const value = getCriterionValue(entry, key);
                            return `
                                <div class="user-score-tiebreak-item ${meta.tone}">
                                    <span>${meta.icon}</span>
                                    <div>
                                        <small>${index + 1}º ${meta.label}</small>
                                        <strong>${value == null ? '0' : value} pts</strong>
                                    </div>
                                </div>`;
                        }).join('')}
                    </div>
                </div>` : '';

            const renderSubdetails = (category) => {
                const details = category.details || [];
                if (!details.length) return '';

                return `
                    <div class="user-score-subdetails" data-parent="${category.key}" hidden>
                        ${details.map((detail, detailIndex) => {
                            const hasChildren =
                                category.key === 'groups' &&
                                detail.key === 'qualification' &&
                                qualificationByGroup.size > 0;

                            return `
                                <div class="user-score-detail-row ${hasChildren ? 'has-children' : ''}"
                                     data-detail="${category.key}-${detailIndex}">
                                    <button type="button"
                                            class="user-score-detail-toggle"
                                            ${hasChildren ? '' : 'disabled'}>
                                        <span>${detail.label}</span>
                                        <strong>${detail.points}</strong>
                                        ${hasChildren ? '<span class="user-score-chevron">›</span>' : ''}
                                    </button>
                                    ${hasChildren ? `
                                        <div class="user-score-group-details" hidden>
                                            ${[...qualificationByGroup.entries()].map(([group, points]) => `
                                                <div class="user-score-group-row">
                                                    <span>${group}</span>
                                                    <strong>${points}</strong>
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </div>`;
                        }).join('')}
                    </div>`;
            };

            const card = document.createElement('div');
            card.className = 'user-score-card';
            card.innerHTML = `
                ${tieBreakdown}
                <div class="user-score-breakdown">
                    ${categories.map((category, categoryIndex) => `
                        <div class="user-score-category" data-category="${category.key}">
                            <button type="button" class="user-score-category-toggle">
                                <span class="user-score-category-main">
                                    <strong>${category.points}</strong>
                                    <span>${category.label}</span>
                                </span>
                                <span class="user-score-chevron">›</span>
                            </button>
                            ${renderSubdetails(category)}
                        </div>
                    `).join('')}
                </div>
            `;

            // Primeiro nível: Grupos / Mata-mata / Pódio / Extras.
            card.querySelectorAll('.user-score-category-toggle').forEach(button => {
                button.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const category = button.closest('.user-score-category');
                    const details = category?.querySelector('.user-score-subdetails');
                    if (!details) return;

                    const opening = details.hidden;
                    details.hidden = !opening;
                    category.classList.toggle('is-open', opening);
                });
            });

            // Segundo nível: Classificação dos grupos.
            card.querySelectorAll('.user-score-detail-toggle').forEach(button => {
                if (button.disabled) return;
                button.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const row = button.closest('.user-score-detail-row');
                    const groups = row?.querySelector('.user-score-group-details');
                    if (!groups) return;

                    const opening = groups.hidden;
                    groups.hidden = !opening;
                    row.classList.toggle('is-open', opening);
                });
            });

            item.appendChild(card);
        });
    });
}
function attachUserLinkEvents() {
    document.querySelectorAll('.ranking-user-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const userId = link.dataset.userId;
            if (!userId) return;
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            const tab = document.getElementById('user-profile');
            if (tab) {
                tab.classList.add('active');
                requestAnimationFrame(() => initUserProfile(userId));
            }
        });
    });
}

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
            const selectedId = e.target.value;
            const selectedName = e.target.options[e.target.selectedIndex].text.split(' - ')[1] || "SEU";
            loadRanking(selectedId, selectedName);
        });
    }

    const segmentButtons = document.querySelectorAll('.segment-btn');
    const desc = document.getElementById('toggle-description');
    
    segmentButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            segmentButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            strategyMode = this.dataset.mode;
            
            if (strategyMode !== 'simulacao') {
                simulatedResults = {};
                isMiracleActive = false;
            }

            if (desc) {
                if (strategyMode === 'official') {
                    desc.innerText = 'Baseado nos resultados validados pela moderação.';
                } else if (strategyMode === 'live') {
                    desc.innerText = 'Baseado no andamento de jogos ao vivo de hoje.';
                } else if (strategyMode === 'simulacao') {
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
window.handleShareRanking = async function() {
    const type = window.__CURRENT_RANK_TAB__ || 'official';
    const entries = window.__RANKING_CACHE__ || [];
    
    if (!entries || entries.length === 0) {
        if (typeof toast === 'function') toast("Aguarde o carregamento do ranking...", "info");
        return;
    }

    const titles = {
        official: "🏆 *RANKING OFICIAL*",
        partial: "⏳ *RANKING PARCIAL (LIVE)*",
        strategy: "💡 *PROJEÇÃO DE ESTRATÉGIA*"
    };

    const leagueName = document.querySelector('.league-title')?.innerText || "Bolão 2026";
    let shareText = `*${leagueName.toUpperCase()}*\n${titles[type]}\n\n`;

    entries.slice(0, 5).forEach((e, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▪️';
        const name = e.name || e.user?.name || '---';
        const pts = e.totalPoints || e.points || 0;
        shareText += `${medal} ${name}: ${pts} pts\n`;
    });

    shareText += `\nVeja a classificação completa:\n${window.location.origin}`;

    try {
        if (navigator.share) {
            await navigator.share({
                title: leagueName,
                text: shareText
            });
        } else {
            await navigator.clipboard.writeText(shareText);
            if (typeof toast === 'function') toast("Ranking copiado! ✅", "success");
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error("Erro ao compartilhar:", err);
        }
    }
};

window.getUserRankingSummary = function (userId) {
    const cache = window.__OFFICIAL_RANKING_CACHE__ || window.__RANKING_CACHE__;
    if (!cache) return null;
    const idx = cache.findIndex(r => (r.userId || r._id || r.user?._id || r.user?.id) === userId);
    if (idx === -1) return null;
    return { position: cache[idx].position, points: cache[idx].totalPoints || cache[idx].points || 0 };
};


/* =====================
    🏆 MODAL DO RANKING SIMULADO
===================== */
window.showSimulatedRankingModal = function() {
    let ranking = window.__LAST_SIMULATED_RANKING__;
    let isPureSimulation = true;

    if (!ranking || ranking.length === 0) {
        ranking = window.__OFFICIAL_RANKING_CACHE__ || window.__RANKING_CACHE__ || [];
        isPureSimulation = false;
    }
    
    if (!ranking || ranking.length === 0) {
        const msg = 'Nenhum dado de ranking ativo ou disponível no momento.';
        if (window.Swal) Swal.fire('Aviso', msg, 'info');
        else alert(msg);
        return;
    }

    const select = document.getElementById('strategy-user-select');
    let activeUserId = select ? select.value : null;
    const currentLoggedId = window.currentUser ? (window.currentUser._id || window.currentUser.id) : null;
    
    if (!activeUserId) {
        activeUserId = currentLoggedId;
    }

    const mobile = isMobile();

    if (mobile && window.Swal && !document.getElementById('swal-fullscreen-fix')) {
        const style = document.createElement('style');
        style.id = 'swal-fullscreen-fix';
        style.innerHTML = `
            @media (max-width: 768px) {
                .swal2-popup.swal2-fullscreen {
                    background: #1a1a2e !important;
                    border-radius: 0 !important;
                    padding: 20px 15px !important;
                    display: flex !important;
                    flex-direction: column !important;
                }
                .swal2-title { padding-top: 5px !important; margin: 0 !important; }
                .swal2-html-container {
                    flex: 1 !important;
                    display: flex !important;
                    flex-direction: column !important;
                    margin: 10px 0 5px 0 !important;
                    overflow: hidden !important;
                    width: 100% !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    const listHtml = ranking.map(user => {
        const uId = user.userId || user.id || user._id || user.user?._id || user.user?.id;
        const isMe = currentLoggedId && uId === currentLoggedId;
        const isTarget = uId === activeUserId;
        
        let bg = 'rgba(255,255,255,0.03)';
        let border = '1px solid rgba(255,255,255,0.05)';
        let shadow = 'none';
        let nameColor = 'white';
        let weight = '600';
        let badgeHtml = '';
        let scale = '1';

        if (isMe) {
            bg = 'linear-gradient(90deg, rgba(0, 255, 255, 0.15), rgba(0, 255, 255, 0.03))';
            border = '1px solid rgba(0, 255, 255, 0.4)';
            shadow = '0 0 15px rgba(0, 255, 255, 0.25)';
            nameColor = '#00ffff';
            weight = '800';
            scale = mobile ? '1' : '1.02';
            badgeHtml = `<span style="background: #00ffff; color: #1a1a2e; font-size: 0.55rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; margin-left: 8px; letter-spacing: 0.5px; box-shadow: 0 0 8px #00ffff;">VOCÊ</span>`;
        } else if (isTarget) {
            bg = 'rgba(46, 204, 113, 0.12)';
            border = '1px solid rgba(46, 204, 113, 0.4)';
            shadow = '0 0 12px rgba(46, 204, 113, 0.15)';
            nameColor = '#2ecc71';
            weight = '800';
            scale = mobile ? '1' : '1.01';
            badgeHtml = `<span style="background: rgba(46, 204, 113, 0.2); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.4); font-size: 0.55rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; margin-left: 8px;">ALVO</span>`;
        }

        const pos = user.position || user.rank || '?';
        const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `<span style="opacity: 0.5;">${pos}º</span>`;
        const name = user.name || user.user?.name || '---';
        const pts = user.points !== undefined ? user.points : (user.totalPoints !== undefined ? user.totalPoints : 0);
        
        return `
        <div style="display: flex; justify-content: space-between; padding: 12px; background: ${bg}; border: ${border}; box-shadow: ${shadow}; border-radius: 10px; margin-bottom: 8px; font-size: 0.85rem; align-items: center; transform: scale(${scale});">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="min-width: 25px; text-align: center; font-weight: bold; font-size: 1.1rem;">${medal}</div>
                <div style="display: flex; align-items: center;">
                    <div style="font-weight: ${weight}; color: ${nameColor};">${name}</div>
                    ${badgeHtml}
                </div>
            </div>
            <div style="font-weight: 900; color: #00ffff; font-family: monospace; font-size: 1rem;">${pts} <span style="font-size: 0.6rem; color: rgba(255,255,255,0.4);">pts</span></div>
        </div>
        `;
    }).join('');

    const subTitle = isPureSimulation 
        ? 'Ranking projetado com os cenários simulados aplicados.' 
        : 'Exibindo classificação atual estável (nenhuma alteração simulada computada).';

    if (window.Swal) {
        Swal.fire({
            title: '📊 Ranking Projetado',
            html: `
                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.6); margin-bottom: 12px;">
                    ${subTitle}
                </div>
                <div style="max-height: ${mobile ? 'calc(100vh - 170px)' : '50vh'}; overflow-y: auto; text-align: left; padding-right: 5px; margin-bottom: 10px; flex: 1;" class="custom-scrollbar">
                    ${listHtml}
                </div>
            `,
            background: '#1a1a2e',
            color: 'white',
            confirmButtonColor: '#2ecc71',
            confirmButtonText: 'Fechar Simulação',
            grow: mobile ? 'fullscreen' : false
        });
    } else {
        let fallbackModal = document.getElementById('fallback-simulated-modal');
        if (!fallbackModal) {
            fallbackModal = document.createElement('div');
            fallbackModal.id = 'fallback-simulated-modal';
            fallbackModal.style = mobile
                ? 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:#1a1a2e; z-index:99999; display:flex; flex-direction:column; padding:20px 15px; box-sizing:border-box; color:white; font-family:system-ui,-apple-system,sans-serif;'
                : 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; color:white; font-family:system-ui,-apple-system,sans-serif;';
            document.body.appendChild(fallbackModal);
        }

        const innerContainerStyle = mobile
            ? 'display:flex; flex-direction:column; height:100%; width:100%; box-sizing:border-box; overflow:hidden;'
            : 'background:#1a1a2e; border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:25px; max-width:480px; width:100%; box-shadow:0 10px 30px rgba(0,0,0,0.5); box-sizing:border-box;';

        const listStyle = mobile
            ? 'flex: 1; overflow-y: auto; margin-bottom: 15px; padding-right: 2px;'
            : 'max-height:40vh; overflow-y:auto; margin-bottom:20px; padding-right:4px;';

        fallbackModal.innerHTML = `
            <div style="${innerContainerStyle}">
                <h3 style="margin-top:0; color:#2ecc71; text-align:center; font-size:1.3rem;">📊 Ranking Projetado</h3>
                <p style="font-size:0.8rem; color:rgba(255,255,255,0.6); text-align:center; margin-bottom:18px;">${subTitle}</p>
                <div style="${listStyle}">
                    ${listHtml}
                </div>
                <button onclick="document.getElementById('fallback-simulated-modal').remove()" style="width:100%; background:#2ecc71; color:white; border:none; padding:14px; border-radius:8px; font-weight:800; cursor:pointer; text-transform:uppercase; margin-top:auto;">Fechar Simulação</button>
            </div>
        `;
        fallbackModal.style.display = 'flex';
    }
};

/* =====================
    🎯 MODAL DE JOGOS DECISIVOS (SECAGEM DO MILAGRE)
===================== */
window.showCriticalMatchesModal = function() {
    
    // Ordem de Dia e Hora 100% Crescente (00:00 -> 23:59) herdando o Helper Global
    const matches = (window.__CRITICAL_MATCHES__ || []).slice().sort((a, b) => {
        const tA = parseMatchTime(a);
        const tB = parseMatchTime(b);
        if (tA > 0 && tB > 0) {
            if (tA !== tB) return tA - tB; 
        }
        const idA = a.matchId || a.id || 0;
        const idB = b.matchId || b.id || 0;
        return idA - idB;
    });
    
    if (matches.length === 0) {
        const msg = 'Não há jogos com secagem direta encontrados no momento.';
        if (window.Swal) Swal.fire('Aviso', msg, 'info');
        else alert(msg);
        return;
    }

    const mobile = isMobile();

    const listHtml = matches.map(m => {
        const teamsArray = m.teams ? m.teams.split(/ x | X | vs | VS /) : [];
        const teamA = teamsArray[0]?.trim() || 'Time A';
        const teamB = teamsArray[1]?.trim() || 'Time B';

        let choiceName = 'Empate';
        if (m.miracleChoice?.toLowerCase() === 'a') choiceName = teamA;
        if (m.miracleChoice?.toLowerCase() === 'b') choiceName = teamB;

        // 🚀 Extração Segura da Secagem no Modal (suporta string ou objeto)
        const rivals = m.opponentsToWatch && m.opponentsToWatch.length > 0 
            ? m.opponentsToWatch.map(op => typeof op === 'string' ? op : (op.name || 'Desconhecido')).join(', ') 
            : 'Ninguém';

        const matchDate = m.date || '';
        const matchTime = m.time ? `às ${m.time}` : '';

        return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,218,68,0.2); border-left: 4px solid #ffda44; border-radius: 8px; padding: 12px; margin-bottom: 10px; text-align: left;">
            <div style="font-size: 0.65rem; color: rgba(255,255,255,0.5); margin-bottom: 6px; text-transform: uppercase; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                <i class="far fa-calendar-alt"></i> ${matchDate} ${matchTime}
            </div>
            <div style="font-weight: 800; color: white; font-size: 0.9rem; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px;">${m.teams}</div>
            <div style="font-size: 0.75rem; color: #00ffff; margin-bottom: 4px; display: flex; align-items: center; gap: 5px;">
                <i class="fas fa-check-circle"></i> Precisamos que dê: <strong style="color: #ffda44; text-transform: uppercase;">${choiceName}</strong>
            </div>
            <div style="font-size: 0.7rem; color: #ff6b6b; display: flex; align-items: start; gap: 5px; margin-top: 6px;">
                <i class="fas fa-skull-crossbones" style="margin-top: 2px;"></i> 
                <span>Secando: <strong style="color: white;">${rivals}</strong></span>
            </div>
        </div>
        `;
    }).join('');

    if (window.Swal) {
        Swal.fire({
            title: '⚡ Alvos de Secagem',
            html: `
                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.7); margin-bottom: 15px; text-align: center;">
                    Estes são os confrontos onde você vai tirar a diferença direta contra os seus rivais.
                </div>
                <div style="max-height: ${mobile ? 'calc(100vh - 180px)' : '45vh'}; overflow-y: auto; padding-right: 5px;" class="custom-scrollbar">
                    ${listHtml}
                </div>
            `,
            background: '#1a1a2e',
            color: 'white',
            confirmButtonColor: '#ffda44',
            confirmButtonText: 'Bora secar!',
            grow: mobile ? 'fullscreen' : false
        });
    } else {
        let fallbackModal = document.getElementById('fallback-critical-modal');
        if (!fallbackModal) {
            fallbackModal = document.createElement('div');
            fallbackModal.id = 'fallback-critical-modal';
            fallbackModal.style = mobile
                ? 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:#1a1a2e; z-index:99999; display:flex; flex-direction:column; padding:20px 15px; box-sizing:border-box; color:white; font-family:system-ui,-apple-system,sans-serif;'
                : 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; color:white; font-family:system-ui,-apple-system,sans-serif;';
            document.body.appendChild(fallbackModal);
        }

        const innerContainerStyle = mobile
            ? 'display:flex; flex-direction:column; height:100%; width:100%; box-sizing:border-box; overflow:hidden;'
            : 'background:#1a1a2e; border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:25px; max-width:480px; width:100%; box-shadow:0 10px 30px rgba(0,0,0,0.5); box-sizing:border-box;';

        const listStyle = mobile
            ? 'flex: 1; overflow-y: auto; margin-bottom: 15px; padding-right: 2px;'
            : 'max-height:40vh; overflow-y:auto; margin-bottom:20px; padding-right:4px;';

        fallbackModal.innerHTML = `
            <div style="${innerContainerStyle}">
                <h3 style="margin-top:0; color:#ffda44; text-align:center; font-size:1.3rem;">⚡ Alvos de Secagem</h3>
                <p style="font-size:0.8rem; color:rgba(255,255,255,0.6); text-align:center; margin-bottom:18px;">Estes são os confrontos onde você vai tirar a diferença.</p>
                <div style="${listStyle}" class="custom-scrollbar">
                    ${listHtml}
                </div>
                <button onclick="document.getElementById('fallback-critical-modal').remove()" style="width:100%; background:#ffda44; color:#1a1a2e; border:none; padding:14px; border-radius:8px; font-weight:900; cursor:pointer; text-transform:uppercase; margin-top:auto;">Bora Secar!</button>
            </div>
        `;
        fallbackModal.style.display = 'flex';
    }
};

/* =====================
    🔄 RESET DA SIMULAÇÃO E TOGGLE DO MILAGRE
===================== */
window.resetSimulations = function() {
    simulatedResults = {};
    isMiracleActive = false; 

    if (typeof toast === 'function') {
        toast('Simulação reiniciada!', 'info');
    }

    const select = document.getElementById('strategy-user-select');
    const selectedId = select ? select.value : null;
    const selectedName = select?.options[select.selectedIndex]?.text.split(' - ')[1] || "SEU";
    
    loadRanking(selectedId, selectedName);
};

window.toggleMiracleMode = function() {
    isMiracleActive = !isMiracleActive;
    
    if (isMiracleActive) {
        strategyMode = 'simulacao';
        document.querySelectorAll('.segment-btn').forEach(b => {
            b.classList.remove('active');
            if (b.dataset.mode === 'simulacao') b.classList.add('active');
        });
        const desc = document.getElementById('toggle-description');
        if (desc) desc.innerText = 'Simule nos cards abaixo e cheque seu Ranking!';
    } else {
        simulatedResults = {};
    }

    if (typeof toast === 'function') {
        toast(isMiracleActive ? 'Calculando a Rota de Ouro... ✨' : 'Motor do Milagre Desativado.', isMiracleActive ? 'success' : 'info');
    }

    const select = document.getElementById('strategy-user-select');
    const selectedId = select ? select.value : null;
    const selectedName = select?.options[select.selectedIndex]?.text.split(' - ')[1] || "SEU";
    
    loadRanking(selectedId, selectedName);
};
