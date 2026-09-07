// admin/adminPhaseVisibility.js
// Controle de visibilidade/disponibilidade por fase. Extraído sem alterar a API
// pública: os handlers continuam expostos em window para compatibilidade com HTML.

import { api } from '../api.js';
import { toast } from '../ui.js';
import { knockoutDisplayLabel } from './adminUtils.js';
import { R } from './adminRuntime.js';

/* ============================================================
   CONTROLE DE VISIBILIDADE POR FASE (ATUALIZADO PARA MULTI-LIGAS)
   ============================================================ */

async function renderPhaseControls() {
    const container = document.getElementById('admin-phase-controls');
    if (!container) return;

    const leagueId = R.getAdminLeagueId();

    try {
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        const unlocked = res.data.unlockedPhases || [];
        const groupMode = res.data.groupBetAvailabilityMode === 'round' ? 'round' : 'all';
        const pointsRunMode =
            res.data.pointsRunBetAvailabilityMode === 'round' ? 'round' : 'all';
        const unlockedPointsRunRounds =
            (res.data.unlockedPointsRunRounds || []).map(Number);
        const knockoutMode =
            res.data.knockoutBetAvailabilityMode === 'round' ? 'round' : 'all';
        const unlockedKnockoutRounds =
            (res.data.unlockedKnockoutRounds || []).map(Number);
        const unlockedRounds = (res.data.unlockedGroupRounds || []).map(Number);
        const knockoutSelect = document.getElementById('match-group-knockout');

        let groupRounds = [];
        let pointsRunRounds = [];
        let knockoutRounds = [];
        let knockoutRoundLabels = {};
        let allLeagueMatches = [];
        let knockoutMatches = [];
        try {
            const matchesRes = await api.get(`/api/matches?leagueId=${leagueId}`);
            allLeagueMatches = matchesRes.data?.data || matchesRes.data || [];
            groupRounds = [...new Set(
                allLeagueMatches
                    .filter(m => m.phase === 'group' && Number.isInteger(Number(m.roundNumber)) && Number(m.roundNumber) > 0)
                    .map(m => Number(m.roundNumber))
            )].sort((a,b) => a-b);
            pointsRunRounds = [...new Set(
                allLeagueMatches
                    .filter(m => {
                        const phase = String(m.phase || '').toLowerCase();
                        return (
                            (phase === 'pontos_corridos' || phase === 'points_run') &&
                            Number.isInteger(Number(m.roundNumber)) &&
                            Number(m.roundNumber) > 0
                        );
                    })
                    .map(m => Number(m.roundNumber))
            )].sort((a,b) => a-b);
            knockoutMatches = allLeagueMatches
                .filter(m => String(m.phase || '').toLowerCase() === 'knockout');

            knockoutRounds = [...new Set(
                knockoutMatches
                    .map(m => Number(m.roundNumber))
                    .filter(n => Number.isInteger(n) && n > 0)
            )].sort((a,b) => a-b);

            knockoutMatches.forEach(m => {
                const r = Number(m.roundNumber);
                if (Number.isInteger(r) && r > 0 && !knockoutRoundLabels[r]) {
                    knockoutRoundLabels[r] = m.group || m.phaseName || `Rodada ${r}`;
                }
            });
        } catch (e) {
            console.warn('Não foi possível carregar rodadas da fase de grupos:', e);
        }

        // Somente exibir um bloco de disponibilidade quando a liga realmente
        // possuir partidas daquela fase.
        const hasGroupMatches = allLeagueMatches.some(
            m => String(m.phase || '').toLowerCase() === 'group'
        );
        const hasPointsRunMatches = allLeagueMatches.some(m => {
            const phase = String(m.phase || '').toLowerCase();
            return phase === 'pontos_corridos' || phase === 'points_run';
        });
        const hasKnockoutMatches = knockoutMatches.length > 0;

        // Quantidade de partidas realmente cadastradas em cada modo.
        // O contador representa o universo disponível para aquela fase,
        // independentemente de quantas rodadas estejam atualmente liberadas.
        const groupMatchCount = allLeagueMatches.filter(
            m => String(m.phase || '').toLowerCase() === 'group'
        ).length;
        const pointsRunMatchCount = allLeagueMatches.filter(m => {
            const phase = String(m.phase || '').toLowerCase();
            return phase === 'pontos_corridos' || phase === 'points_run';
        }).length;
        const knockoutMatchCount = knockoutMatches.length;

        // ============================================================
        // VISIBILIDADE DOS PALPITES — DINÂMICA
        // Não há mais etapas fixas da Copa aqui. Os controles são criados
        // a partir das partidas realmente cadastradas nesta liga.
        // unlockedPhases controla somente a REVELAÇÃO dos palpites.
        // O bloqueio de salvamento/edição continua nas regras próprias.
        // ============================================================
        const visibilityItems = [];
        const visibilitySeen = new Set();

        const addVisibilityItem = (id, label, meta = '') => {
            const rawId = String(id || '').trim();
            if (!rawId || visibilitySeen.has(rawId)) return;
            visibilitySeen.add(rawId);
            visibilityItems.push({ id: rawId, label: String(label || rawId), meta });
        };

        const genericGroupPhaseNames = new Set([
            'fase de grupos',
            'fase grupos',
            'grupos',
            'group',
            'groups'
        ]);

        // Grupos: quando existem várias rodadas/fases reais, usa o
        // phaseName/rodada como chave; caso contrário mantém "group" para
        // compatibilidade com configurações antigas.
        const groupVisibilityValues = new Map();
        allLeagueMatches
            .filter(m => String(m.phase || '').toLowerCase() === 'group')
            .forEach(m => {
                const phaseName = String(m.phaseName || '').trim();
                const groupName = String(m.group || '').trim();
                let id = phaseName && !genericGroupPhaseNames.has(phaseName.toLowerCase())
                    ? phaseName
                    : groupName || 'group';
                let label = phaseName && !genericGroupPhaseNames.has(phaseName.toLowerCase())
                    ? phaseName
                    : (groupName ? `Grupo ${groupName.replace(/^grupo\s+/i, '')}` : 'Grupos');
                if (id) groupVisibilityValues.set(id, label);
            });

        if (hasGroupMatches) {
            // Se houver phaseName/rodadas, elas são os controles dinâmicos.
            // "Grupos" também fica disponível como chave global compatível.
            addVisibilityItem('group', 'Grupos', 'global');
            groupVisibilityValues.forEach((label, id) => addVisibilityItem(id, label, 'group'));
        }

        // Pontos corridos: cada rodada/fase real vira um controle de
        // visibilidade. Também existe uma chave global "pontos_corridos".
        if (hasPointsRunMatches) {
            addVisibilityItem('pontos_corridos', 'Pontos Corridos', 'global');
            const pointRunVisibility = new Map();
            allLeagueMatches
                .filter(m => {
                    const phase = String(m.phase || '').toLowerCase();
                    return phase === 'pontos_corridos' || phase === 'points_run';
                })
                .forEach(m => {
                    const label = String(m.phaseName || '').trim() ||
                        (Number(m.roundNumber) > 0 ? `Rodada ${Number(m.roundNumber)}` : 'Pontos Corridos');
                    pointRunVisibility.set(label, label);
                });
            pointRunVisibility.forEach(label => addVisibilityItem(label, label, 'points_run'));
        }

        // Mata-mata: somente as etapas realmente presentes no campeonato.
        if (hasKnockoutMatches) {
            addVisibilityItem('knockout', 'Mata-mata', 'global');
            const knockoutVisibility = new Map();
            knockoutMatches.forEach(m => {
                const label = String(m.phaseName || m.group || '').trim() ||
                    (Number(m.roundNumber) > 0 ? `Rodada ${Number(m.roundNumber)}` : 'Mata-mata');
                knockoutVisibility.set(label, label);
            });
            knockoutVisibility.forEach(label => addVisibilityItem(label, label, 'knockout'));
        }

        // Pódio é uma entidade global e não depende das partidas.
        addVisibilityItem('podium', 'Pódio', 'global');

        const roundControls = hasGroupMatches ? `
          <div style="grid-column:1/-1; margin-top:10px; padding:10px; border:1px solid rgba(255,255,255,.08); border-radius:8px;">
            <div class="admin-availability-heading">
              <span>📅 Disponibilidade da fase de grupos</span>
              <span class="admin-availability-count">${groupMatchCount} ${groupMatchCount === 1 ? 'partida' : 'partidas'}</span>
            </div>
            <select id="admin-group-bet-mode" onchange="setGroupBetAvailabilityMode(this.value)"
                    style="width:100%; padding:7px; border-radius:6px;">
              <option value="all" ${groupMode === 'all' ? 'selected' : ''}>Liberar a fase de grupos completa</option>
              <option value="round" ${groupMode === 'round' ? 'selected' : ''}>Liberar rodada por rodada</option>
            </select>
            ${groupMode === 'round' ? `
              <div style="margin-top:8px; display:grid; grid-template-columns:repeat(4,1fr); gap:5px;">
                ${groupRounds.map(round => {
                    const on = unlockedRounds.includes(round);
                    return `<button class="btn ${on ? 'btn-success' : 'btn-outline-secondary'}"
                      onclick="toggleGroupRound(${round}, ${on})"
                      style="font-size:10px; min-height:30px;">Rodada ${round}</button>`;
                }).join('')}
              </div>
              ${groupRounds.length === 0 ? '<small style="color:#999;">Nenhuma rodada encontrada nas partidas importadas.</small>' : ''}
            ` : '<small style="display:block; margin-top:6px; color:#888;">Todas as rodadas da fase de grupos ficam disponíveis.</small>'}
          </div>
        ` : '';

        const pointsRunControls = hasPointsRunMatches ? `
          <div id="points-run-controls" style="grid-column:1/-1; margin-top:10px; padding:10px; border:1px solid rgba(255,255,255,.08); border-radius:8px;">
            <div class="admin-availability-heading">
              <span>🏁 Disponibilidade dos pontos corridos</span>
              <span class="admin-availability-count">${pointsRunMatchCount} ${pointsRunMatchCount === 1 ? 'partida' : 'partidas'}</span>
            </div>
            <select id="admin-points-run-bet-mode" onchange="setPointsRunBetAvailabilityMode(this.value)"
                    style="width:100%; padding:7px; border-radius:6px;">
              <option value="all" ${pointsRunMode === 'all' ? 'selected' : ''}>Liberar o campeonato completo</option>
              <option value="round" ${pointsRunMode === 'round' ? 'selected' : ''}>Liberar rodada por rodada</option>
            </select>
            ${pointsRunMode === 'round' ? `
              <div style="margin-top:8px; display:grid; grid-template-columns:repeat(4,1fr); gap:5px;">
                ${pointsRunRounds.map(round => {
                    const on = unlockedPointsRunRounds.includes(round);
                    return `<button class="btn ${on ? 'btn-success' : 'btn-outline-secondary'}"
                      onclick="togglePointsRunRound(${round}, ${on})"
                      style="font-size:10px; min-height:30px;">Rodada ${round}</button>`;
                }).join('')}
              </div>
              ${pointsRunRounds.length === 0 ? '<small style="color:#999;">Nenhuma rodada de pontos corridos encontrada.</small>' : ''}
            ` : '<small style="display:block; margin-top:6px; color:#888;">Todas as rodadas ficam disponíveis.</small>'}
          </div>
        ` : '';

        const knockoutRoundControls = hasKnockoutMatches ? `
          <div id="knockout-round-controls" style="grid-column:1/-1; margin-top:10px; padding:10px; border:1px solid rgba(255,255,255,.08); border-radius:8px;">
            <div class="admin-availability-heading">
              <span>🥊 Disponibilidade do mata-mata</span>
              <span class="admin-availability-count">${knockoutMatchCount} ${knockoutMatchCount === 1 ? 'partida' : 'partidas'}</span>
            </div>
            <select onchange="setKnockoutBetAvailabilityMode(this.value)"
                    style="width:100%; padding:7px; border-radius:6px;">
              <option value="all" ${knockoutMode === 'all' ? 'selected' : ''}>Liberar o mata-mata completo</option>
              <option value="round" ${knockoutMode === 'round' ? 'selected' : ''}>Liberar por etapa/rodada</option>
            </select>
            ${knockoutMode === 'round' ? `
              <div class="admin-knockout-availability-grid" style="margin-top:8px; display:grid; grid-template-columns:repeat(3,1fr); gap:5px;">
                ${knockoutRounds.map(round => {
                  const on = unlockedKnockoutRounds.includes(round);
                  const label = knockoutRoundLabels[round] || `Rodada ${round}`;
                  const displayLabel = knockoutDisplayLabel(label);
                  return `<button class="btn ${on ? 'btn-success' : 'btn-outline-secondary'}"
                    onclick="toggleKnockoutRound(${round}, ${on})"
                    style="font-size:10px; min-height:32px;">${displayLabel}</button>`;
                }).join('')}
              </div>
              ${knockoutRounds.length === 0 ? '<small style="color:#999;">Nenhuma rodada de mata-mata encontrada nas partidas importadas.</small>' : ''}
            ` : '<small style="display:block; margin-top:6px; color:#888;">Todas as etapas do mata-mata ficam disponíveis.</small>'}
          </div>
        ` : '';


        container.innerHTML = `
            <div class="d-flex flex-wrap gap-2" style="display: grid !important; grid-template-columns: repeat(4, 1fr) !important; gap: 5px !important;">
                ${visibilityItems.map(item => {
                    const isChecked = unlocked.some(v => String(v).trim().toLowerCase() === String(item.id).trim().toLowerCase());
                    const phaseIdJson = JSON.stringify(item.id).replace(/</g, '\u003c');
                    return `
                        <button class="btn ${isChecked ? 'btn-success' : 'btn-outline-secondary'}" 
                                onclick='togglePhaseVisibility(${phaseIdJson}, ${isChecked})'
                                style="font-size: 10px; min-height: 32px; padding: 4px 6px; border-radius: 4px; border: none; font-weight: bold;"
                                title="${item.meta === 'global' ? 'Visibilidade global da fase' : 'Visibilidade dos palpites desta fase/rodada'}">
                            ${item.label}
                        </button>
                    `;
                }).join('')}
                ${roundControls}
                ${pointsRunControls}
                ${knockoutRoundControls}
            </div>
        `;
    } catch (err) {
        console.error("Erro ao carregar travas:", err);
    }
}

async function togglePhaseVisibility(phaseId, isCurrentlyUnlocked) {
    try {
        const leagueId = R.getAdminLeagueId();
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        let list = res.data.unlockedPhases || [];

        if (isCurrentlyUnlocked) {
            list = list.filter(id => id !== phaseId);
        } else {
            if (!list.includes(phaseId)) list.push(phaseId);
        }

        await api.post('/api/settings/global', { 
            leagueId: leagueId,
            unlockedPhases: list 
        });

        toast(`Fase "${phaseId}" ${isCurrentlyUnlocked ? 'Bloqueada' : 'Liberada'} na liga ${leagueId}!`, 'success');
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast("Erro ao salvar visibilidade", "error");
    }
};

async function setGroupBetAvailabilityMode(mode) {
    try {
        const leagueId = R.getAdminLeagueId();
        await api.post('/api/settings/global', {
            leagueId,
            groupBetAvailabilityMode: mode
        });
        toast(
            mode === 'round'
                ? 'Modo rodada por rodada ativado.'
                : 'Fase de grupos completa liberada.',
            'success'
        );
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar modo de disponibilidade das rodadas.', 'error');
    }
};

async function toggleGroupRound(round, isCurrentlyUnlocked) {
    try {
        const leagueId = R.getAdminLeagueId();
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        let unlockedRounds = (res.data.unlockedGroupRounds || []).map(Number);
        let lockedRounds = (res.data.lockedGroupRounds || []).map(Number);

        if (isCurrentlyUnlocked) {
            unlockedRounds = unlockedRounds.filter(r => r !== Number(round));
        } else {
            if (!unlockedRounds.includes(Number(round))) unlockedRounds.push(Number(round));
            lockedRounds = lockedRounds.filter(r => r !== Number(round));
        }

        await api.post('/api/settings/global', {
            leagueId,
            groupBetAvailabilityMode: 'round',
            unlockedGroupRounds: unlockedRounds,
            lockedGroupRounds: lockedRounds
        });

        toast(`Rodada ${round} ${isCurrentlyUnlocked ? 'bloqueada' : 'liberada'}.`, 'success');
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar a rodada.', 'error');
    }
};

async function setPointsRunBetAvailabilityMode(mode) {
    try {
        const leagueId = R.getAdminLeagueId();
        await api.post('/api/settings/global', {
            leagueId,
            pointsRunBetAvailabilityMode: mode
        });
        toast(
            mode === 'round'
                ? 'Pontos corridos: rodada por rodada ativado.'
                : 'Pontos corridos: campeonato completo liberado.',
            'success'
        );
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar disponibilidade dos pontos corridos.', 'error');
    }
};

async function togglePointsRunRound(round, isCurrentlyUnlocked) {
    try {
        const leagueId = R.getAdminLeagueId();
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        let unlockedRounds = (res.data.unlockedPointsRunRounds || []).map(Number);
        let lockedRounds = (res.data.lockedPointsRunRounds || []).map(Number);

        if (isCurrentlyUnlocked) {
            unlockedRounds = unlockedRounds.filter(r => r !== Number(round));
        } else {
            if (!unlockedRounds.includes(Number(round))) unlockedRounds.push(Number(round));
            lockedRounds = lockedRounds.filter(r => r !== Number(round));
        }

        await api.post('/api/settings/global', {
            leagueId,
            pointsRunBetAvailabilityMode: 'round',
            unlockedPointsRunRounds: unlockedRounds,
            lockedPointsRunRounds: lockedRounds
        });

        toast(`Rodada ${round} ${isCurrentlyUnlocked ? 'bloqueada' : 'liberada'}.`, 'success');
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar a rodada dos pontos corridos.', 'error');
    }
};

async function setKnockoutBetAvailabilityMode(mode) {
    try {
        const leagueId = R.getAdminLeagueId();
        await api.post('/api/settings/global', {
            leagueId,
            knockoutBetAvailabilityMode: mode
        });
        toast(
          mode === 'round'
            ? 'Mata-mata: liberação por etapa/rodada ativada.'
            : 'Mata-mata: todas as etapas liberadas.',
          'success'
        );
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar disponibilidade do mata-mata.', 'error');
    }
};

async function toggleKnockoutRound(round, isCurrentlyUnlocked) {
    try {
        const leagueId = R.getAdminLeagueId();
        const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
        let unlocked = (res.data.unlockedKnockoutRounds || []).map(Number);
        let locked = (res.data.lockedKnockoutRounds || []).map(Number);

        if (isCurrentlyUnlocked) {
            unlocked = unlocked.filter(r => r !== Number(round));
        } else {
            if (!unlocked.includes(Number(round))) unlocked.push(Number(round));
            locked = locked.filter(r => r !== Number(round));
        }

        await api.post('/api/settings/global', {
            leagueId,
            knockoutBetAvailabilityMode: 'round',
            unlockedKnockoutRounds: unlocked,
            lockedKnockoutRounds: locked
        });

        toast(`Rodada/etapa ${round} ${isCurrentlyUnlocked ? 'bloqueada' : 'liberada'}.`, 'success');
        renderPhaseControls();
    } catch (err) {
        console.error(err);
        toast('Erro ao alterar etapa do mata-mata.', 'error');
    }
};


// Compatibilidade com os onclick inline existentes.
window.togglePhaseVisibility = togglePhaseVisibility;
window.setGroupBetAvailabilityMode = setGroupBetAvailabilityMode;
window.toggleGroupRound = toggleGroupRound;
window.setPointsRunBetAvailabilityMode = setPointsRunBetAvailabilityMode;
window.togglePointsRunRound = togglePointsRunRound;
window.setKnockoutBetAvailabilityMode = setKnockoutBetAvailabilityMode;
window.toggleKnockoutRound = toggleKnockoutRound;

export { renderPhaseControls };
