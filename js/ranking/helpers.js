import { parseMatchDate } from '../matches/matchesUtils.js';

export function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
}

// A Estratégia nunca renderiza uma bandeira própria. Este helper apenas
// resolve a URL da mídia existente nas partidas para que a apresentação
// continue sendo feita exclusivamente por renderTeamMedia().
export function normalizeStrategyTeamName(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

export function resolveStrategyTeamLogo(teamName, explicitLogoUrl = null, sourceMatches = []) {
    if (explicitLogoUrl) return explicitLogoUrl;

    const wanted = normalizeStrategyTeamName(teamName);
    if (!wanted) return null;

    const matches = Array.isArray(sourceMatches) ? sourceMatches : [];

    // Nunca usamos emoji para resolver mídia. Procuramos a primeira URL válida
    // da própria API, inclusive quando a primeira partida da equipe está sem
    // logo e uma partida posterior possui a mídia preenchida.
    const exact = matches.find(m =>
        normalizeStrategyTeamName(m?.team) === wanted && m?.logoUrl
    );
    if (exact?.logoUrl) return exact.logoUrl;

    const matchWithLogo = matches.find(m =>
        normalizeStrategyTeamName(m?.teamA) === wanted && m?.logoA
    );
    if (matchWithLogo?.logoA) return matchWithLogo.logoA;

    const matchWithLogoB = matches.find(m =>
        normalizeStrategyTeamName(m?.teamB) === wanted && m?.logoB
    );
    if (matchWithLogoB?.logoB) return matchWithLogoB.logoB;

    // Equivalências de nomes não criam bandeira: apenas permitem localizar a
    // URL real que já existe no catálogo da API.
    const aliases = {
        brazil: 'brasil', brasil: 'brasil',
        germany: 'alemanha', alemanha: 'alemanha',
        spain: 'espanha', espanha: 'espanha',
        france: 'franca', franca: 'franca',
        england: 'inglaterra', inglaterra: 'inglaterra'
    };
    const canonical = aliases[wanted] || wanted;
    const aliasRef = matches.find(m => {
        const a = aliases[normalizeStrategyTeamName(m?.teamA)] || normalizeStrategyTeamName(m?.teamA);
        const b = aliases[normalizeStrategyTeamName(m?.teamB)] || normalizeStrategyTeamName(m?.teamB);
        return (a === canonical && m?.logoA) || (b === canonical && m?.logoB);
    });
    if (aliasRef) {
        const a = aliases[normalizeStrategyTeamName(aliasRef.teamA)] || normalizeStrategyTeamName(aliasRef.teamA);
        if (a === canonical && aliasRef.logoA) return aliasRef.logoA;
        const b = aliases[normalizeStrategyTeamName(aliasRef.teamB)] || normalizeStrategyTeamName(aliasRef.teamB);
        if (b === canonical && aliasRef.logoB) return aliasRef.logoB;
    }

    return null;
}

export function getMedal(pos) {
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

export function getRankingMeta(response, entries = []) {
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

export function getCriterionValue(entry, key) {
    if (key === 'exactScorePoints') {
        return entry?.exactScorePoints ?? entry?.exactScore ?? null;
    }
    if (key === 'podiumPoints') return entry?.podiumPoints ?? null;
    if (key === 'extraPoints') return entry?.extrasPoints ?? entry?.extraPoints ?? null;
    if (key === 'knockoutPoints') return entry?.knockoutPoints ?? null;
    return null;
}

export function formatMoney(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL', minimumFractionDigits: 2
    });
}

export function renderRankingFooter(rankingType, response, container, onRefresh = null) {
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
    if (btn) btn.addEventListener('click', () => {
        if (typeof onRefresh === 'function') onRefresh();
    });
}

export function getCriterionHeaderLabel(key) {
    return RANKING_CRITERIA_META[key]?.label || key;
}

export function renderPrizeSummary(meta, container) {
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

export function renderTieBreakerSummary(meta, container) {
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

export function getUserAvatar(entry) {
    const avatar = entry?.user?.avatar || entry?.avatar;
    if (avatar) return `<img class="ranking-avatar" src="${avatar}" alt="" loading="lazy">`;
    const name = entry?.name || entry?.user?.name || '?';
    return `<span class="ranking-avatar ranking-avatar-fallback">${name.trim().charAt(0).toUpperCase()}</span>`;
}

export function getPreviousRanking() {
    const leagueId = localStorage.getItem('selectedLeagueId');
    try {
        return JSON.parse(localStorage.getItem(`__RANKING_PREV_${leagueId}__`)) || [];
    } catch {
        return [];
    }
}

export function saveCurrentRanking(entries) {
    const leagueId = localStorage.getItem('selectedLeagueId');
    if (!leagueId) return;
    const simplified = entries.map(e => ({
        userId: e.userId || e.user?._id || e.user?.id,
        position: e.position
    }));
    localStorage.setItem(`__RANKING_PREV_${leagueId}__`, JSON.stringify(simplified));
}

export function getMovement(userId, currentPos, prevRanking) {
    const prev = prevRanking.find(p => p.userId === userId);
    if (!prev) return { label: '🆕', move: 'new' };
    const diff = prev.position - currentPos;
    if (diff > 0) return { label: `+${diff} ⬆️`, move: 'up' };
    if (diff < 0) return { label: `${diff} ⬇️`, move: 'down' };
    return { label: '', move: 'same' };
}

// Helper global para converter data e hora das partidas em Timestamp (Usado para ordenação cronológica)
export function parseMatchTime(match) {
    const d = parseMatchDate(match);
    return d && Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

/* =====================
    🔢 Contador animado
===================== */
export function animateNumber(el, to) {
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
            <p>Este percentual é um <b>índice heurístico de alcance</b> baseado no estado atual do torneio; não representa uma probabilidade estatística de resultados:</p>
            <ul style="padding-left: 20px; margin-bottom: 15px;">
                <li><b>Cenário de Ouro:</b> Simulamos que você acerta 100% dos jogos futuros.</li>
                <li><b>Fator Pódio:</b> Verificamos se seus times de pódio (1º-4º) ainda estão vivos.</li>
                <li><b>Gap vs Potencial:</b> Comparamos a distância para o líder com os pontos que ainda restam.</li>
                <li><b>Fator Kamikaze:</b> Avalia o risco extremo da rota. Se ativo, indica que sua liderança depende ativamente de zebras e de secar diretamente múltiplos rivais.</li>
            </ul>
            <div style="background: #f8f9fa; padding: 10px; border-radius: 8px; border: 1px solid #ddd; font-family: monospace; text-align: center;">
                Índice = combinação de potencial, gap e fatores de alcance
            </div>
        </div>
    `;

    if (window.Swal) {
        Swal.fire({
            title: 'Lógica do Índice de Alcance',
            html: `${explanation}<p style="margin-top:12px; font-size:0.82rem; opacity:0.8;"><strong>Importante:</strong> este percentual é um indicador heurístico de alcance, não uma probabilidade estatística de título.</p>`,
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
