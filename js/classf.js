import { api } from './api.js';
import { renderTeamMedia } from './matches/matchesUtils.js';

/**
 * Pagina de Classificacao
 */
export default async function ClassificacaoPage() {
    const container = document.getElementById('classificacao');
    if (!container) return;

    const selectedLeagueId = localStorage.getItem('selectedLeagueId') || 'default';

    container.innerHTML = `
        <div class="filter-container-tabela">
            <div class="toggle-wrapper">
                <span class="toggle-text">Oficial</span>
                <label class="switch-antenna">
                    <input type="checkbox" id="toggle-tabela-parcial">
                    <span class="slider-antenna">
                        <i class="fa-solid fa-tower-broadcast antenna-icon"></i>
                    </span>
                </label>
                <span class="toggle-text text-live">Parcial</span>
            </div>
        </div>
        <div id="classificacao-content">
            <div class="loading" style="padding: 60px; text-align: center; color: rgba(255,255,255,0.6);">
                <i class="fas fa-spinner fa-spin fa-2x"></i>
                <p style="margin-top: 15px;">Carregando classificacao...</p>
            </div>
        </div>
    `;

    const contentDiv = document.getElementById('classificacao-content');
    const toggleInput = document.getElementById('toggle-tabela-parcial');

    let refreshTimer = null;
    let refreshInFlight = false;

    const refresh = async () => {
        if (refreshInFlight) return;
        refreshInFlight = true;
        try {
            await fetchAndRenderStandings(contentDiv, toggleInput.checked, selectedLeagueId);
        } finally {
            refreshInFlight = false;
        }
    };

    const restartLiveRefresh = () => {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        if (toggleInput.checked) {
            refreshTimer = setInterval(refresh, 15000);
        }
    };

    toggleInput.addEventListener('change', async () => {
        await refresh();
        restartLiveRefresh();
    });

    await refresh();
    restartLiveRefresh();

    window.addEventListener('beforeunload', () => {
        if (refreshTimer) clearInterval(refreshTimer);
    }, { once: true });
}

async function fetchAndRenderStandings(targetElement, isParcial, leagueId) {
    const loadingState = isParcial ? 'Parcial (Live)' : 'Oficial';
    targetElement.innerHTML = `<div class="loading" style="padding: 60px; text-align: center;"><i class="fas fa-circle-notch fa-spin fa-2x"></i><p>Carregando modo ${loadingState}...</p></div>`;

    try {
        // 1. BUSCA OS LOGOS das partidas da liga
        const logoMap = new Map();
        let leagueMatches = [];
        const normalizeTeamKey = (name) => String(name || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
        try {
            const matchesRes = await api.listMatches(leagueId);
            if (matchesRes?.success && Array.isArray(matchesRes.data)) {
                leagueMatches = matchesRes.data;
                matchesRes.data.forEach(m => {
                    if (m.teamA && m.logoA) logoMap.set(normalizeTeamKey(m.teamA), m.logoA);
                    if (m.teamB && m.logoB) logoMap.set(normalizeTeamKey(m.teamB), m.logoB);
                });
            }
        } catch (e) {
            console.warn('Nao foi possivel carregar logos:', e.message);
        }

        // 2. IDENTIFICA A FASE REAL DA CLASSIFICAÇÃO PELAS PARTIDAS DA LIGA.
        // Não podemos assumir 'group': uma liga de pontos corridos pode ter
        // partidas criadas antes de qualquer resultado ser finalizado.
        const hasPointsRunMatches = (() => {
            try {
                // Reutiliza a mesma consulta feita acima sem depender de regras
                // de campeonato, que podem estar desatualizadas.
                return leagueMatches.some(m => {
                    const phase = String(m?.phase || '').trim().toLowerCase();
                    return phase === 'pontos_corridos' || phase === 'points_run';
                });
            } catch (_) {
                return false;
            }
        })();

        const classificationPhase = hasPointsRunMatches ? 'pontos_corridos' : 'group';

        // 3. BUSCA OS DADOS DA TABELA usando a fase correta.
        const groups = await api.getGroupStandings(leagueId, isParcial, classificationPhase);

        if (!groups || typeof groups !== 'object' || Object.keys(groups).length === 0) {
            targetElement.innerHTML = `<p style="text-align:center; padding: 40px; color: #888;">Sem dados para esta liga.</p>`;
            return;
        }

        const pointsRunLayout = hasPointsRunMatches;
        targetElement.innerHTML = pointsRunLayout
            ? '<div class="classification-layout points-run-layout" id="classification-layout"><div class="classification-standings-panel"><div class="classificacao-grid" id="groups-grid"></div></div></div>'
            : '<div class="classificacao-grid" id="groups-grid"></div>';
        const grid = document.getElementById('groups-grid');
        let fullHtml = '';

        Object.keys(groups).sort().forEach(groupName => {
            const teams = groups[groupName];
            if (!Array.isArray(teams)) return;

            fullHtml += `
                <div class="group-container">
                    <div class="group-header"> ${groupName.toUpperCase()}</div>
                    <table class="standings-table">
                        <thead>
                            <tr>
                                <th style="width: 35px;">Pos</th>
                                <th class="text-left">Selecao</th>
                                <th>PTS</th>
                                <th>PJ</th>
                                <th>SG</th>
                                <th>GP</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${teams.map((team, index) => {
                                const sg = parseInt(team.sg) || 0;
                                const sgClass = sg > 0 ? 'sg-positive' : (sg < 0 ? 'sg-negative' : 'sg-neutral');
                                const qualifiedClass = team.qualified ? 'qualified-row' : '';
                                const apiLogo = logoMap.get(normalizeTeamKey(team.name)) || '';
                                const teamMedia = renderTeamMedia(team.name, apiLogo);

                                return `
                                    <tr class="${qualifiedClass}">
                                        <td class="pos-cell">${index + 1}o</td>
                                        <td class="text-left team-cell">
                                            <div style="display: flex; align-items: center;">
                                                ${teamMedia}
                                                <span class="team-name-table">${team.name}</span>
                                            </div>
                                        </td>
                                        <td class="pts-column">${team.pts}</td>
                                        <td>${team.pj}</td>
                                        <td class="${sgClass}">${sg > 0 ? `+${sg}` : sg}</td>
                                        <td style="font-weight: bold; color: #eee;">${team.gp || 0}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });

        grid.innerHTML = fullHtml;

        // ================================================================
        // ARTILHEIROS — dados reais do backend (goalsDetail)
        // A mídia da seleção passa exclusivamente por renderTeamMedia().
        // ================================================================
        const scorersSection = document.createElement('section');
        scorersSection.className = 'top-scorers-section';
        scorersSection.innerHTML = `
            <div class="top-scorers-title">Artilheiros</div>
            <div class="top-scorers-table-wrap">
                <table class="top-scorers-table">
                    <thead>
                        <tr>
                            <th style="width: 42px;">Pos</th>
                            <th class="text-left">Jogador</th>
                            <th class="text-left">Seleção</th>
                            <th>Gols</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td colspan="4" class="top-scorers-loading">
                            <i class="fas fa-circle-notch fa-spin"></i> Carregando...
                        </td></tr>
                    </tbody>
                </table>
            </div>
        `;
        if (pointsRunLayout) {
            document.getElementById('classification-layout').appendChild(scorersSection);
        } else {
            targetElement.appendChild(scorersSection);
        }

        try {
            const scorers = await api.getTopScorers(leagueId, isParcial ? 'live' : 'official');
            const topFour = Array.isArray(scorers?.data) ? scorers.data.slice(0, 4) : [];
            const tbody = scorersSection.querySelector('tbody');

            if (!topFour.length) {
                tbody.innerHTML = '<tr><td colspan="4" class="top-scorers-empty">Nenhum gol registrado.</td></tr>';
            } else {
                tbody.innerHTML = topFour.map((scorer, index) => {
                    const position = scorer.position || index + 1;
                    const player = scorer.player || scorer.name || 'Desconhecido';
                    const team = scorer.team || '-';
                    const logoUrl = scorer.logoUrl || '';
                    const media = renderTeamMedia(team, logoUrl);

                    return `
                        <tr>
                            <td class="scorer-position">${position}º</td>
                            <td class="text-left scorer-player">${player}</td>
                            <td class="text-left scorer-team">
                                <div class="scorer-team-media">${media}<span>${team}</span></div>
                            </td>
                            <td class="scorer-goals">${Number(scorer.goals) || 0}</td>
                        </tr>
                    `;
                }).join('');
            }
        } catch (scorerError) {
            console.error('Erro ao carregar artilheiros:', scorerError);
            const tbody = scorersSection.querySelector('tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="top-scorers-empty">Não foi possível carregar os artilheiros.</td></tr>';
            }
        }

        // Rodape
        const footer = document.createElement('div');
        footer.className = 'table-footer';
        footer.style.cssText = "margin-top: 20px; padding: 10px; border-top: 1px solid rgba(255,255,255,0.05)";
        footer.innerHTML = `
            <div class="footer-legend" style="display: flex; align-items: center; gap: 10px; font-size: 0.85rem; color: rgba(255,255,255,0.7);">
                <div class="indicator-green" style="width: 12px; height: 12px; background: #28a745; border-radius: 2px;"></div>
                <span>Zona de classificacao</span>
            </div>
            ${isParcial ? `<div class="live-update-notice" style="margin-top: 10px; color: #00ff88; font-size: 0.8rem; font-weight: bold;"><i class="fas fa-tower-broadcast fa-fade"></i> CALCULO PARCIAL ATIVO</div>` : ''}
        `;
        targetElement.appendChild(footer);

    } catch (error) {
        console.error('Erro na classificacao:', error);
        targetElement.innerHTML = `<div class="error-state" style="padding: 40px; text-align: center;">Erro ao carregar dados.</div>`;
    }
}
