// js/stats.js
import { api } from "./api.js";
import { flagEmoji } from "./flags.js";
import { $, toast } from "./ui.js";
import { renderTeamMedia } from "./matches4.js?v=1.13";

let STATS = {
    matches: [],
    allBets: [],
    unlockedPhases: [], 
    activeTab: "group", 
    expandedGroups: new Set() 
};

/* ======================
    🔒 ESTADOS BLOQUEADOS (MANTIDO)
====================== */
function renderStatsLockedState() {
    const container = $("#stats-container");
    if (!container) return;
    container.innerHTML = `
        <div class="card locked-state" style="text-align:center; padding:32px;">
            <i class="fas fa-lock mb-3" style="font-size:2.5rem; opacity:0.3;"></i>
            <h3>🔒 Estatísticas indisponíveis</h3>
            <p>As estatísticas gerais serão liberadas<br>após o início oficial dos jogos.</p>
        </div>
    `;
}

function renderEmptyState(msg) {
    return `<div class="card" style="text-align:center; padding:40px; background:rgba(0,0,0,0.1); color:#999;">
                <i class="fas fa-eye-slash mb-3" style="font-size:2rem; opacity:0.3;"></i>
                <p>${msg}</p>
            </div>`;
}

function getLogoForTeam(teamName) {
    if (!teamName || teamName === '—') return null;
    const m = STATS.matches.find(match => 
        (match.teamA && match.teamA.trim() === teamName.trim()) || 
        (match.teamB && match.teamB.trim() === teamName.trim())
    );
    if (!m) return null;
    return m.teamA.trim() === teamName.trim() ? m.logoA : m.logoB;
}

/* --- Carregamento de Dados --- */
async function loadData() {
    const leagueId = localStorage.getItem('selectedLeagueId') || '1';
    const [matchesRes, betsRes, settingsRes] = await Promise.all([
        api.get(`/api/matches?leagueId=${leagueId}`),
        api.get(`/api/bets/all-bets?leagueId=${leagueId}`),
        api.get(`/api/settings/global?leagueId=${leagueId}`)
    ]);

    if (matchesRes?.locked || matchesRes?.code === 'STATS_LOCKED') {
        const err = new Error('STATS_LOCKED');
        err.code = 'STATS_LOCKED';
        throw err;
    }

    if (!matchesRes?.success || !betsRes?.success) {
        throw new Error("Erro ao carregar dados das estatísticas");
    }

    STATS.matches = matchesRes.data || [];
    STATS.allBets = betsRes.data || [];
    STATS.unlockedPhases = settingsRes.data?.unlockedPhases || [];
}

/* --- Interação --- */
window.toggleGroup = (groupName) => {
    if (STATS.expandedGroups.has(groupName)) STATS.expandedGroups.delete(groupName);
    else STATS.expandedGroups.add(groupName);
    renderAll();
};

window.switchStatsTab = (tab) => {
    STATS.activeTab = tab;
    STATS.expandedGroups.clear(); 
    renderAll();
};

/* --- Favoritos Dinâmicos --- */
function renderTopPicksForTab(filteredMatches) {
    // 🛡️ Valida por grupo OU por phaseName (Rodada)
    const allowed = filteredMatches.filter(m => 
        STATS.unlockedPhases.includes('group') || 
        STATS.unlockedPhases.includes(m.group) || 
        STATS.unlockedPhases.includes(m.phaseName)
    );

    if (allowed.length === 0) return '';
    
    const statsByGroup = {};
    allowed.forEach(m => {
        // 💡 LÓGICA CORRIGIDA: Prioriza phaseName, a menos que seja "FASE DE GRUPOS"
        const isFaseDeGrupos = m.phaseName && m.phaseName.trim().toUpperCase() === 'FASE DE GRUPOS';
        const groupKey = (!isFaseDeGrupos && m.phaseName) ? m.phaseName : (m.group || m.phaseName);

        if (!statsByGroup[groupKey]) statsByGroup[groupKey] = {};
        const g = statsByGroup[groupKey];

        STATS.allBets.forEach(u => {
            const b = (u.bets || []).find(x => x.matchId === m.matchId);
            if (!b) return;

            // 💡 Lógica Híbrida: Se não houver 'choice' mas houver 'score', calcula o vencedor
            let choice = b.choice;
            if (!choice && b.scoreA !== undefined && b.scoreB !== undefined) {
                if (b.scoreA > b.scoreB) choice = "A";
                else if (b.scoreB > b.scoreA) choice = "B";
            }

            if (choice === "A") g[m.teamA] = (g[m.teamA] || 0) + 1;
            if (choice === "B") g[m.teamB] = (g[m.teamB] || 0) + 1;
        });
    });

    let title = STATS.activeTab === 'group' ? "🌍 Favoritos dos Grupos" : "🔥 Favoritos do Mata-Mata";
    let html = `<div class="stats-section"><h3>${title} (Top 2)</h3><div class="favorites-grid">`;
    
    Object.keys(statsByGroup).sort().forEach(groupName => {
        const sorted = Object.entries(statsByGroup[groupName]).sort((a,b) => b[1] - a[1]).slice(0, 2);
        if (sorted.length === 0) return;
        html += `<div class="card fav-card"><strong>${groupName}</strong>${sorted.map(([name, votes], i) => `
            <div class="fav-item">
                <div class="stats-team-info" style="display:flex; align-items:center; gap:8px;">
                    <span style="font-weight:bold; min-width:25px; opacity:0.8;">${i+1}º</span>
                    <div class="flag-wrapper-stats">${renderTeamMedia(name, getLogoForTeam(name))}</div>
                    <span>${name}</span>
                </div>
                <span class="badge">${votes}</span>
            </div>
        `).join('')}</div>`;
    });
    
    return html + `</div></div><hr style="margin: 20px 0;">`;
}

/* --- Lista de Jogos (Barras de Progresso) --- */
function renderMatchList(filteredMatches) {
    const allowedMatches = filteredMatches.filter(m => 
        STATS.unlockedPhases.includes('group') || 
        STATS.unlockedPhases.includes(m.group) || 
        STATS.unlockedPhases.includes(m.phaseName)
    );

    if (allowedMatches.length === 0) return renderEmptyState("Estatísticas bloqueadas.");

    const groups = {};
    allowedMatches.forEach(m => { 
        // 💡 LÓGICA CORRIGIDA: Prioriza phaseName, a menos que seja "FASE DE GRUPOS"
        const isFaseDeGrupos = m.phaseName && m.phaseName.trim().toUpperCase() === 'FASE DE GRUPOS';
        const groupKey = (!isFaseDeGrupos && m.phaseName) ? m.phaseName : (m.group || m.phaseName);
        
        (groups[groupKey] ||= []).push(m); 
    });

    let html = `<div class="matches-container">`;
    Object.keys(groups).sort().forEach(groupName => {
        const isExpanded = STATS.expandedGroups.has(groupName);
        html += `
        <div class="group-accordion ${isExpanded ? 'active' : ''}">
            <div class="accordion-header" onclick="window.toggleGroup('${groupName}')">
                <span>${groupName} <small style="opacity:0.7;">(${groups[groupName].length} jogos)</small></span>
                <i class="fas fa-chevron-${isExpanded ? 'up' : 'down'}"></i>
            </div>
            <div class="accordion-content" style="display:${isExpanded ? 'grid' : 'none'}; gap:12px; padding:10px;">`;

        groups[groupName].forEach(m => {
            let A = 0, B = 0, D = 0;
            STATS.allBets.forEach(u => {
                const b = (u.bets || []).find(x => x.matchId === m.matchId);
                if (!b) return;

                let choice = b.choice;
                if (!choice && b.scoreA !== undefined && b.scoreB !== undefined) {
                    if (Number(b.scoreA) > Number(b.scoreB)) choice = "A";
                    else if (Number(b.scoreB) > Number(b.scoreA)) choice = "B";
                    else choice = "draw";
                }
                
                if (choice === "A") A++; else if (choice === "B") B++; else if (choice === "draw") D++;
            });
            const total = A + B + D || 1;
            const realRes = m.status === 'finished' ? (m.scoreA > m.scoreB ? 'A' : m.scoreB > m.scoreA ? 'B' : 'draw') : null;

html += `
    <div class="modern-match-card">

        <div class="match-layout">

            <div class="match-info">

                <div class="stat-row team-a-row">

                    <div class="stat-team">

                        <div class="flag-wrapper-stats">
                            ${renderTeamMedia(m.teamA, getLogoForTeam(m.teamA))}
                        </div>

                        <span style="${realRes === 'A'
                            ? 'font-weight:900; color:#ffe45f;'
                            : ''}">
                            ${m.teamA}
                        </span>

                    </div>

                    <strong>
                        ${(A/total*100).toFixed(0)}%
                    </strong>

                </div>

                <div class="stat-row draw-row">

                    <div class="stat-team">
                        <span class="draw-label">
                            Empate
                        </span>
                    </div>

                    <strong>
                        ${(D/total*100).toFixed(0)}%
                    </strong>

                </div>

                <div class="stat-row team-b-row">

                    <div class="stat-team">

                        <div class="flag-wrapper-stats">
                            ${renderTeamMedia(m.teamB, getLogoForTeam(m.teamB))}
                        </div>

                        <span style="${realRes === 'B'
                            ? 'font-weight:900; color:#ffe45f;'
                            : ''}">
                            ${m.teamB}
                        </span>

                    </div>

                    <strong>
                        ${(B/total*100).toFixed(0)}%
                    </strong>

                </div>

            </div>

            <div class="match-donut-wrapper">

                <svg class="match-donut" viewBox="0 0 42 42">

                    <circle
                        cx="21"
                        cy="21"
                        r="15.915"
                        fill="transparent"
                        stroke="rgba(255,255,255,.10)"
                        stroke-width="5"
                    />

                    <circle
                        cx="21"
                        cy="21"
                        r="15.915"
                        fill="transparent"
                        stroke="#63ff8a"
                        stroke-width="5"
                        stroke-dasharray="${(A/total*100)} ${100 - (A/total*100)}"
                        stroke-dashoffset="25"
                    />

                    <circle
                        cx="21"
                        cy="21"
                        r="15.915"
                        fill="transparent"
                        stroke="#ffd54a"
                        stroke-width="5"
                        stroke-dasharray="${(D/total*100)} ${100 - (D/total*100)}"
                        stroke-dashoffset="${25 - (A/total*100)}"
                    />

                    <circle
                        cx="21"
                        cy="21"
                        r="15.915"
                        fill="transparent"
                        stroke="#6ea8ff"
                        stroke-width="5"
                        stroke-dasharray="${(B/total*100)} ${100 - (B/total*100)}"
                        stroke-dashoffset="${25 - (A/total*100) - (D/total*100)}"
                    />

                </svg>

            </div>

        </div>

    </div>
`;
        });
        html += `</div></div>`;
    });
    return html + `</div>`;
}

/* --- Renderização Geral --- */
function renderAll() {
    const container = $("#stats-container");
    if (!container) return;

    const isPodiumUnlocked = STATS.unlockedPhases.includes('podium');
    const filteredMatches = STATS.matches.filter(m => STATS.activeTab === 'group' ? m.phase !== 'knockout' : m.phase === 'knockout');

    const championsCounts = {};
    STATS.allBets.forEach(u => { if (u.podium?.first) championsCounts[u.podium.first] = (championsCounts[u.podium.first] || 0) + 1; });
    const topChampions = Object.entries(championsCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);

    container.innerHTML = `
        <div class="stats-wrapper">
            <div class="stats-section">
                <h3>🏆 Favoritos ao Título</h3>
                ${isPodiumUnlocked ? `
                    <div class="card chart-card" style="display:flex; align-items:center; gap:15px; padding:15px;">
                        <div style="flex:1; height:180px;"><canvas id="chartChampions"></canvas></div>
                        <div class="chart-side-logos" style="display:flex; flex-direction:column; gap:8px; border-left:1px solid rgba(255,255,255,0.1); padding-left:15px; min-height:160px; justify-content: space-around;">
                            ${topChampions.map(([name]) => `
                                <div style="display:flex; align-items:center; justify-content:center;" title="${name}">
                                    <div class="flag-wrapper-stats" style="width:24px; height:24px;">${renderTeamMedia(name, getLogoForTeam(name))}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : `<div class="card" style="text-align:center; padding:20px; color:#888;">Palpites de pódio bloqueados.</div>`}
            </div>
            <div class="stats-tabs">
                <button class="tab-btn ${STATS.activeTab === 'group' ? 'active' : ''}" onclick="window.switchStatsTab('group')">Grupos/Rodadas</button>
                <button class="tab-btn ${STATS.activeTab === 'knockout' ? 'active' : ''}" onclick="window.switchStatsTab('knockout')">Mata-Mata</button>
            </div>
            ${renderTopPicksForTab(filteredMatches)}
            ${renderMatchList(filteredMatches)}
        </div>
    `;

    if (isPodiumUnlocked) setTimeout(initCharts, 50);
}

export async function initStats() {
    const container = $("#stats-container");
    if (!container) return;
    container.innerHTML = `<div class="loading" style="text-align:center; padding:40px;"><i class="fas fa-spinner fa-spin"></i> Sincronizando...</div>`;
    try {
        await loadData();
        renderAll();
    } catch (err) {
        if (err?.code === 'STATS_LOCKED') renderStatsLockedState();
        else toast("Erro nas estatísticas", "error");
    }
}

function initCharts() {
    const counts = {};
    STATS.allBets.forEach(u => { if (u.podium?.first) counts[u.podium.first] = (counts[u.podium.first] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const ctx = document.getElementById('chartChampions');
    if (!ctx || !window.Chart) return;
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(d => d[0]),
            datasets: [{ data: sorted.map(d => d[1]), backgroundColor: '#fed100', borderRadius: 4 }]
        },
        options: { 
            indexAxis: 'y', 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: false },
            scales: {
                x: { display: false },
                y: { ticks: { color: '#fff', font: { size: 11 } }, grid: { display: false } }
            }
        }
    });
}
