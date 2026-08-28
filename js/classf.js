import { api } from './api.js';
import { flagEmoji } from './flags.js';

/**
 * Renderiza a midia do time (Prioridade: Logo API > Emoji)
 */
function renderTableMedia(teamName, logoUrl) {
    const bandeiraLocal = flagEmoji(teamName);

    // 1. Prioridade: Se existe a string do Logo
    if (logoUrl && logoUrl.trim() !== "" && logoUrl !== "null") {
        return `
            <div class="table-logo-wrapper" style="display: inline-flex; vertical-align: middle; position: relative; width: 18px; height: 18px; min-width: 18px; max-width: 18px; justify-content: center; align-items: center; margin-right: 8px; overflow: hidden;">
                <img src="${logoUrl}"
                     class="team-logo-api"
                     style="display: block; width: 100%; height: 100%; object-fit: contain; position: absolute; top: 0; left: 0;"
                     onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';">

                <span class="team-emoji" style="display: none; font-size: 14px; line-height: 18px;">
                    ${bandeiraLocal || ''}
                </span>
            </div>
        `;
    }

    // 2. Segunda opcao: Apenas se o logo nao existir no banco
    if (bandeiraLocal) {
        return `<span class="team-emoji" style="margin-right: 8px; font-size: 14px; vertical-align: middle; display: inline-block; width: 18px; text-align: center;">${bandeiraLocal}</span>`;
    }

    // 3. Terceira opcao: Se nao tem nada, nao mostra nada
    return '';
}

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

    toggleInput.addEventListener('change', () => {
        fetchAndRenderStandings(contentDiv, toggleInput.checked, selectedLeagueId);
    });

    fetchAndRenderStandings(contentDiv, false, selectedLeagueId);
}

async function fetchAndRenderStandings(targetElement, isParcial, leagueId) {
    const loadingState = isParcial ? 'Parcial (Live)' : 'Oficial';
    targetElement.innerHTML = `<div class="loading" style="padding: 60px; text-align: center;"><i class="fas fa-circle-notch fa-spin fa-2x"></i><p>Carregando modo ${loadingState}...</p></div>`;

    try {
        // 1. BUSCA OS LOGOS das partidas da liga
        const logoMap = new Map();
        try {
            const matchesRes = await api.listMatches(leagueId);
            if (matchesRes?.success && Array.isArray(matchesRes.data)) {
                matchesRes.data.forEach(m => {
                    if (m.teamA && m.logoA) logoMap.set(m.teamA, m.logoA);
                    if (m.teamB && m.logoB) logoMap.set(m.teamB, m.logoB);
                });
            }
        } catch (e) {
            console.warn('Nao foi possivel carregar logos:', e.message);
        }

        // 2. BUSCA OS DADOS DA TABELA
        const groups = await api.getGroupStandings(leagueId, isParcial);

        if (!groups || typeof groups !== 'object' || Object.keys(groups).length === 0) {
            targetElement.innerHTML = `<p style="text-align:center; padding: 40px; color: #888;">Sem dados para esta liga.</p>`;
            return;
        }

        targetElement.innerHTML = '<div class="classificacao-grid" id="groups-grid"></div>';
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
                                const apiLogo = logoMap.get(team.name);

                                return `
                                    <tr class="${qualifiedClass}">
                                        <td class="pos-cell">${index + 1}o</td>
                                        <td class="text-left team-cell">
                                            <div style="display: flex; align-items: center;">
                                                ${renderTableMedia(team.name, apiLogo)}
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
