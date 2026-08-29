// js/allBets.js — adaptado para nova versão do backend
import { api } from './api.js';
import { $, toast } from './ui.js';
import { calculateMatchPoints as calculateScoringMatchPoints, getScoringRules as getFrontendScoringRules } from './frontendScoring.js';

const AB_STATE = {
    search: '',
    matchId: '',
    group: '',
    page: 1,
    pageSize: 5,
    allBets: [],
    matchesById: {},
    unlockedPhases: [],
    scoringRules: null,
};

/* ======================
    HELPERS
   ====================== */
function resultWinnerFromScore(scoreA, scoreB) {
    if (scoreA == null || scoreB == null) return null;
    if (scoreA > scoreB) return 'A';
    if (scoreB > scoreA) return 'B';
    return 'draw';
}

function getScoringRules() {
    return getFrontendScoringRules({
        scoringRules: (typeof window !== 'undefined' && window.STATE?.scoringRules) || AB_STATE.scoringRules
    });
}

function calculateMatchPoints(bet, match) {
    const result = calculateScoringMatchPoints(
        {
            scoreA: bet.scoreA,
            scoreB: bet.scoreB,
            winner: bet.choice || bet.winner,
            qualifier: bet.qualifier
        },
        match,
        {
            scoringRules: getScoringRules()
        },
        false
    );

    return {
        points: result.points,
        hitWinner: result.breakdown.winner > 0,
        hitExact: result.breakdown.exactScore > 0,
        hitScoreA: result.breakdown.scoreTeamA > 0,
        hitScoreB: result.breakdown.scoreTeamB > 0,
        hitQualified: result.breakdown.qualifier > 0
    };
}

/** Pódio vem como array do backend: [1o, 2o, 3o, 4o] ou null */
function renderPodium(podiumArr) {
    if (!Array.isArray(podiumArr) || podiumArr.length === 0) return '';
    const emojis = ['🥇', '🥈', '🥉', '⭐'];
    const items = podiumArr
        .map((team, idx) => team && team !== '🔒' ? `${emojis[idx] || '⭐'} ${team}` : '')
        .filter(Boolean)
        .join(' • ');
    if (!items) return '';
    return `<span class="podium-inline" style="font-size:.9rem; opacity:.9; margin-left:10px;">${items}</span>`;
}

/* ======================
    RENDERIZACAO UI
   ====================== */
function renderPagination(totalUsers) {
    const totalPages = Math.max(1, Math.ceil(totalUsers / AB_STATE.pageSize));
    const $p = $('#all-bets-pagination');
    if (!$p) return;
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="page-btn ${i === AB_STATE.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    $p.innerHTML = html;
    $p.querySelectorAll('.page-btn').forEach(btn => {
        btn.onclick = () => {
            AB_STATE.page = Number(btn.dataset.page);
            drawAllBets();
            $('#all-bets-container')?.scrollIntoView({ behavior: 'smooth' });
        };
    });
}

export function drawAllBets() {
    const $container = $('#all-bets-container');
    if (!$container) return;

    const searchTerm = (AB_STATE.search || '').toLowerCase();

    const filteredBets = AB_STATE.allBets.filter(u => {
        const matchesUserName = u.userName.toLowerCase().includes(searchTerm);
        const matchesTeams = u.bets.some(b => {
            const m = AB_STATE.matchesById[b.matchId];
            return m && (m.teamA.toLowerCase().includes(searchTerm) || m.teamB.toLowerCase().includes(searchTerm));
        });
        return matchesUserName || matchesTeams;
    });

    const start = (AB_STATE.page - 1) * AB_STATE.pageSize;
    const pageItems = filteredBets.slice(start, start + AB_STATE.pageSize);

    if (!pageItems.length) {
        $container.innerHTML = `<div class="user-bets-compact card glass-card" style="text-align:center; padding:30px;"><p>Nenhum palpite encontrado.</p></div>`;
        renderPagination(0);
        return;
    }

    let html = '';
    for (const u of pageItems) {
        let chips = '';

        // Ordena palpites decrescente por matchId
        const sortedBets = (u.bets || []).slice().sort((a, b) => Number(b.matchId) - Number(a.matchId));

        for (const b of sortedBets) {
            const m = AB_STATE.matchesById[b.matchId];
            if (!m) continue;

            const isLocked = b.choice === '🔒';
            const isMataMata = !!b.qualifier;

            let statusClass = 'pending';
            let matchPoints = 0;
            let palpiteConteudoHtml = "";

            if (!isLocked) {
                const vencedorNormal = b.choiceLabel || (b.choice === 'A' ? m.teamA : b.choice === 'B' ? m.teamB : 'EMPATE');
                const timeClassificado = b.qualifier ? (b.qualifier === 'A' ? m.teamA : m.teamB) : null;

                // Placar apostado pelo usuario (se houver)
                const hasBetScore = b.scoreA != null && b.scoreB != null && b.scoreA !== '' && b.scoreB !== '';
                const betScoreHtml = hasBetScore
                    ? `<div style="font-size:0.7rem;color:#aaa;margin-top:3px;">Palpite: <strong style="color:#fff;">${b.scoreA} x ${b.scoreB}</strong></div>`
                    : '';

                if (timeClassificado) {
                    palpiteConteudoHtml = `
                        <div class="bet-info-split">
                            <div class="bet-sub-item">
                                <small>120 MIN</small>
                                <strong>${vencedorNormal}</strong>
                                ${betScoreHtml}
                            </div>
                            <div class="bet-sub-item">
                                <small>CLASSIFICADO</small>
                                <strong class="team-glow-qualified">${timeClassificado}</strong>
                            </div>
                        </div>`;
                } else {
                    palpiteConteudoHtml = `
                        <small>VENCEDOR</small>
                        <strong>${vencedorNormal}</strong>
                        ${betScoreHtml}`;
                }

                // Calcula pontos dinamicamente conforme regras do admin
                if (m.status === 'finished') {
                    const calc = calculateMatchPoints(b, m);
                    matchPoints = calc.points;

                    if (isMataMata) {
                        const acertos = (calc.hitWinner ? 1 : 0) + (calc.hitQualified ? 1 : 0);
                        if (acertos === 2) statusClass = 'win';
                        else if (acertos === 1) statusClass = 'partial';
                        else statusClass = 'lose';
                    } else {
                        statusClass = matchPoints > 0 ? 'win' : 'lose';
                    }
                }
            }

            const statusBadge = isLocked
                ? `<span class="status-badge locked"><i class="fas fa-lock"></i> Oculto</span>`
                : (m.status === 'finished'
                    ? `<span class="status-badge ${statusClass}">
                        ${matchPoints > 0 ? `+${matchPoints} PT${matchPoints > 1 ? 'S' : ''}` : '0 PONTOS'}
                       </span>`
                    : `<span class="status-badge pending">AGUARDANDO</span>`);

            // Placar real da partida (se finalizada)
            const realScoreHtml = (m.status === 'finished')
                ? `<div style="font-size:0.75rem;color:#00ff88;margin-top:2px;font-weight:600;">Real: ${m.scoreA} x ${m.scoreB}</div>`
                : '';

            chips += `
                <div class="bet-item-row ${isLocked ? 'is-locked' : ''}">
                    <div class="match-teams">
                        <small>${m.phaseName || m.group || 'Partida'}</small>
                        <strong>${m.teamA} vs ${m.teamB}</strong>
                        ${realScoreHtml}
                    </div>
                    <div class="bet-info">
                        ${isLocked ? '<small>---</small><strong>🔒</strong>' : palpiteConteudoHtml}
                    </div>
                    <div class="status-info">${statusBadge}</div>
                </div>`;
        }

        html += `
            <div class="user-bets-compact card glass-card">
                <div class="user-bets-header">
                    <div class="user-main-info">
                        <i class="fas fa-user-circle"></i>
                        <strong>${u.userName}</strong>
                        ${renderPodium(u.podium)}
                    </div>
                    <div class="user-points-badge">Total: <strong>${u.totalPoints ?? 0}</strong></div>
                </div>
                <div class="user-bets-list">
                    ${chips || '<div class="bet-item-row"><div class="match-teams">Sem palpites registrados</div></div>'}
                </div>
            </div>`;
    }
    $container.innerHTML = html;
    renderPagination(filteredBets.length);
}

/* ======================
    EXPORTACAO EXCEL
   ====================== */
function exportAllBetsCSV() {
    try {
        if (typeof XLSX === 'undefined') return toast('Biblioteca Excel nao carregada', 'error');
        if (!AB_STATE.allBets.length) return toast('Sem dados para exportar', 'warning');

        const wb = XLSX.utils.book_new();

        for (const user of AB_STATE.allBets) {
            const p = Array.isArray(user.podium) ? user.podium : [];
            const podiumLabels = ['1o', '2o', '3o', '4o'];
            const podiumRow = p.length > 0
                ? p.map((team, i) => `${podiumLabels[i] || (i + 1) + 'o'}: ${team || '-'}`)
                : ['Nenhum podio registrado'];

            const rows = [
                ['Usuario:', user.userName, 'Total Pontos:', user.totalPoints ?? 0],
                ['Podio Escolhido:'].concat(podiumRow),
                [],
                ['ID Jogo', 'Grupo/Rodada', 'Time A', 'Time B', 'Tempo Normal', 'Classificado', 'Resultado Real', 'Pontos Jogo']
            ];

            for (const b of (user.bets || [])) {
                const m = AB_STATE.matchesById[b.matchId];
                if (!m) continue;

                const isLocked = b.choice === '🔒';
                let pts = 0;

                if (!isLocked && m.status === 'finished') {
                    const calc = calculateMatchPoints(b, m);
                    pts = calc.points;
                }

                let palpiteNormal = isLocked ? '🔒' : (b.choiceLabel || '-');
                let classificadoCSV = (!isLocked && b.qualifier) ? (b.qualifier === 'A' ? m.teamA : m.teamB) : '-';

                rows.push([
                    b.matchId,
                    m.phaseName || m.group || '-',
                    m.teamA, m.teamB,
                    palpiteNormal,
                    classificadoCSV,
                    m.status === 'finished' ? `${m.scoreA} x ${m.scoreB}` : 'Nao jogado',
                    pts
                ]);
            }
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, user.userName.substring(0, 31));
        }
        XLSX.writeFile(wb, `relatorio_geral.xlsx`);
        toast('Excel gerado!');
    } catch (err) {
        console.error(err);
        toast('Erro ao exportar', 'error');
    }
}

/* ======================
    INIT E FILTROS
   ====================== */
function fillMatchFilterSelect(matches) {
    const $select = $('#filter-match');
    if (!$select) return;
    let html = `<option value="">Todas as Partidas</option>`;
    matches.forEach(m => {
        html += `<option value="${m.matchId}">${m.teamA} vs ${m.teamB} (${m.phaseName || m.group || m.phase || '-'})</option>`;
    });
    $select.innerHTML = html;
}

async function fetchAllBets() {
    const leagueId = localStorage.getItem('selectedLeagueId') || 'default';
    const params = new URLSearchParams({
        search: AB_STATE.search,
        matchId: AB_STATE.matchId,
        group: AB_STATE.group,
        leagueId: leagueId
    });

    try {
        const betsRes = await api.get(`/api/bets/all-bets?${params.toString()}`);
        if (betsRes?.success) AB_STATE.allBets = betsRes.data;
    } catch (err) {
        if (err.status === 423) {
            // Stats bloqueados pelo middleware blockStatsIfLocked
            AB_STATE.allBets = [];
        } else {
            throw err;
        }
    }
}

function wireFilters() {
    $('#btn-toggle-filters')?.addEventListener('click', () => $('#filter-content')?.classList.toggle('show'));

    $('#btn-search')?.addEventListener('click', async () => {
        AB_STATE.search = $('#filter-search')?.value.trim() || '';
        AB_STATE.matchId = $('#filter-match')?.value || '';
        AB_STATE.group = $('#filter-group')?.value || '';
        AB_STATE.page = 1;
        await fetchAllBets();
        drawAllBets();
    });

    $('#btn-clear')?.addEventListener('click', async () => {
        if ($('#filter-search')) $('#filter-search').value = '';
        if ($('#filter-match')) $('#filter-match').value = '';
        if ($('#filter-group')) $('#filter-group').value = '';
        AB_STATE.search = '';
        AB_STATE.matchId = '';
        AB_STATE.group = '';
        AB_STATE.page = 1;
        await fetchAllBets();
        drawAllBets();
    });
}

function renderLockedState() {
    const $container = $('#all-bets-container');
    if ($container) {
        $container.innerHTML = `<div class="card glass-card" style="text-align:center; padding:32px;"><h3>🔒 Palpites Ocultos</h3><p>Aguarde o inicio das partidas para visualizar os palpites de outros jogadores.</p></div>`;
    }
}

function fillGroupFilterSelect(matches) {
    const $select = $('#filter-group');
    if (!$select) return;
    const groups = [...new Set(matches.map(m => m.group || m.phaseName).filter(Boolean))];
    let html = `<option value="">Todos os Grupos/Fases</option>`;
    groups.forEach(g => {
        html += `<option value="${g}">${g}</option>`;
    });
    $select.innerHTML = html;
}

export async function initAllBets() {
    try {
        const leagueId = localStorage.getItem('selectedLeagueId');

        if (!leagueId) {
            console.warn('⚠️ Nenhum leagueId selecionado para carregar Todos os Palpites.');
            return;
        }

        // 1. Busca partidas para complementar dados (resultados reais, nomes de times, etc.)
        const matchesRes = await api.get(`/api/matches?leagueId=${leagueId}`);
        if (matchesRes?.success) {
            matchesRes.data.forEach(m => { AB_STATE.matchesById[m.matchId] = m; });
            fillMatchFilterSelect(matchesRes.data);
            fillGroupFilterSelect(matchesRes.data);
        }

        // 2. Busca scoringRules da liga para calcular pontos corretamente
        try {
            const settingsRes = await api.get(`/api/settings/global?leagueId=${leagueId}`);
            if (settingsRes?.success && settingsRes.data?.scoringRules) {
                AB_STATE.scoringRules = settingsRes.data.scoringRules;
            }
        } catch (e) {
            console.warn('Nao foi possivel carregar scoringRules:', e.message);
        }

        await fetchAllBets();
        drawAllBets();
        wireFilters();
        document.getElementById('btn-export')?.addEventListener('click', exportAllBetsCSV);
    } catch (err) {
        console.error('initAllBets error:', err);
        if (err.status === 423) {
            renderLockedState();
        } else {
            toast('Erro ao carregar palpites gerais', 'error');
        }
    }
}