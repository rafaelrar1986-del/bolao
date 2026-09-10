import { rankingState, getRankingLoader } from './state.js';

export function enterManualSimulationFromMiracle() {
    if (!rankingState.isMiracleActive) return;

    rankingState.isMiracleActive = false;
    rankingState.strategyMode = 'simulacao';
    rankingState.simulatedResults = {};

    if (window.__CURRENT_MATCHES__) {
        window.__CURRENT_MATCHES__.forEach(m => {
            if (!m.isMiracleResult || !m.miracleChoice) return;
            const mId = String(m.matchId || m.id);
            let choice = m.miracleChoice;
            if (String(choice).toLowerCase() === 'draw') choice = 'Draw';

            const sim = { winner: choice };
            if (Number.isInteger(m.miracleScoreA)) sim.scoreA = m.miracleScoreA;
            if (Number.isInteger(m.miracleScoreB)) sim.scoreB = m.miracleScoreB;

            const isKnockoutPhase = m.phase === 'knockout';
            const req = window.__getSimulationCardRequirements?.(mId);
            if (isKnockoutPhase && req?.requiresQualifier && choice !== 'Draw' && m.miracleQualifier) {
                sim.qualifier = m.miracleQualifier;
            }
            rankingState.simulatedResults[mId] = sim;
        });
    }

    document.querySelectorAll('.segment-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === 'simulacao');
    });
}

window.registerSimulation = function(matchId, field, value) {
    matchId = String(matchId); // Blindagem de Tipo

    // Qualquer edição manual da rota do Milagre entra na simulação manual
    // preservando a rota encontrada antes de alterar o campo clicado.
    enterManualSimulationFromMiracle();

    if (!rankingState.simulatedResults[matchId]) {
        rankingState.simulatedResults[matchId] = {};
    }

    // Toggle: desmarca se clicar de novo
    if (rankingState.simulatedResults[matchId][field] === value) {
        delete rankingState.simulatedResults[matchId][field];
        if (Object.keys(rankingState.simulatedResults[matchId]).length === 0) {
            delete rankingState.simulatedResults[matchId];
        }
    } else {
        rankingState.simulatedResults[matchId][field] = value;
    }

    const select = document.getElementById('strategy-user-select');
    const selectedId = select ? select.value : null;
    const selectedName = select?.options[select.selectedIndex]?.text.split(' - ')[1] || "SEU";

    // Altera visualmente a aba superior para Simulador
    document.querySelectorAll('.segment-btn').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.mode === 'simulacao') b.classList.add('active');
    });

    // IMPORTANTE: não consulta o backend enquanto o card estiver incompleto.
    // A consulta só acontece quando TODOS os dados exigidos por este card
    // estiverem preenchidos.
    if (window.__isSimulationCardComplete(matchId)) {
        scheduleSimulationRanking(matchId, selectedId, selectedName);
    } else {
        clearSimulationRequestTimer(matchId);
        window.__refreshSimulationControls?.(matchId);
    }
};

/**
 * Retorna as exigências reais de um card de simulação.
 * Regra: nenhum request ao backend enquanto faltar qualquer dado obrigatório.
 */
window.__getSimulationCardRequirements = function(matchId) {
    const id = String(matchId);
    const matches = Array.isArray(window.__LAST_LEADERSHIP_MATCHES__)
        ? window.__LAST_LEADERSHIP_MATCHES__
        : [];
    const match = matches.find(item => String(item.matchId || item.id) === id);
    if (!match) return null;

    const isKnockout = match.phase === 'knockout';
    const winnerFromScore = match.winnerFromScore === true;
    const scoreRequired = winnerFromScore || match.scoreScoring?.enabled === true;

    // Em ida/volta, o classificado é decidido pelo confronto, não pela perna
    // individual. O frontend de apostas já usa a mesma regra: a perna de volta
    // não recebe um campo de classificado.
    const stageFormat = isStrategyHomeAwayMatch(match) ? 'home_away' : 'single';
    const knockoutLeg = Number(match.knockoutLeg || 0);
    const isReturnLeg = isKnockout && stageFormat === 'home_away' && knockoutLeg === 2;
    const requiresQualifier = isKnockout && !isReturnLeg;

    return {
        match,
        isKnockout,
        winnerFromScore,
        scoreRequired,
        requiresWinner: !winnerFromScore,
        requiresQualifier,
        stageFormat,
        knockoutLeg,
        isReturnLeg,
    };
};

window.__isSimulationCardComplete = function(matchId) {
    const req = window.__getSimulationCardRequirements(matchId);
    if (!req) return false;

    const sim = rankingState.simulatedResults[String(matchId)] || {};
    const hasWinner = sim.winner === 'A' || sim.winner === 'B' || sim.winner === 'Draw';
    const hasQualifier = sim.qualifier === 'A' || sim.qualifier === 'B';
    const hasScoreA = Number.isInteger(sim.scoreA) && sim.scoreA >= 0;
    const hasScoreB = Number.isInteger(sim.scoreB) && sim.scoreB >= 0;

    if (req.scoreRequired && (!hasScoreA || !hasScoreB)) return false;
    if (req.requiresWinner && !hasWinner) return false;
    if (req.requiresQualifier && !hasQualifier) return false;

    if (req.winnerFromScore && !hasWinner) return false;

    return true;
};

window.__refreshSimulationControls = function(matchId) {
    const id = String(matchId);
    const sim = rankingState.simulatedResults[id] || {};
    const cards = document.querySelectorAll('.secagem-card[data-simulation-match-id]');
    cards.forEach(card => {
        if (String(card.dataset.simulationMatchId) !== id) return;
        card.querySelectorAll('[data-sim-field=\"winner\"]').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.simValue === sim.winner);
        });
        card.querySelectorAll('[data-sim-field=\"qualifier\"]').forEach(btn => {
            btn.classList.toggle('selected-qualifier', btn.dataset.simValue === sim.qualifier);
        });
    });
};

export function isStrategyHomeAwayMatch(match) {
    if (!match || !(match.phase === 'knockout')) return false;
    if (match.stageFormat === 'home_away') return true;
    if (match.stageFormat === 'single') return false;
    return match.knockoutFormat === 'home_away' && !match.isFinalSingle;
}

export function clearAllSimulationRequestTimers() {
    rankingState.simulationRequestTimers.forEach(timer => clearTimeout(timer));
    rankingState.simulationRequestTimers.clear();
}

export function clearSimulationRequestTimer(matchId) {
    const id = String(matchId);
    const timer = rankingState.simulationRequestTimers.get(id);
    if (timer) {
        clearTimeout(timer);
        rankingState.simulationRequestTimers.delete(id);
    }
}

export function scheduleSimulationRanking(matchId, selectedId, selectedName) {
    const id = String(matchId);
    clearSimulationRequestTimer(id);
    if (!window.__isSimulationCardComplete(id)) return;

    // O card já está completo. Um pequeno debounce evita rajadas de requests
    // quando o usuário troca rapidamente um valor por outro.
    const timer = setTimeout(() => {
        rankingState.simulationRequestTimers.delete(id);
        if (window.__isSimulationCardComplete(id)) {
            const loadRanking = getRankingLoader();
            if (loadRanking) loadRanking(selectedId, selectedName);
        }
    }, 300);
    rankingState.simulationRequestTimers.set(id, timer);
}

window.updateSimulationScore = function(matchId, field, rawValue) {
    if (field !== 'scoreA' && field !== 'scoreB') return;
    enterManualSimulationFromMiracle();
    matchId = String(matchId);

    const raw = String(rawValue ?? '').trim();
    if (!rankingState.simulatedResults[matchId]) rankingState.simulatedResults[matchId] = {};

    if (raw === '') {
        delete rankingState.simulatedResults[matchId][field];
    } else {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 0 || value > 99) return;
        rankingState.simulatedResults[matchId][field] = value;
    }

    const sim = rankingState.simulatedResults[matchId];
    const matchData = Array.isArray(window.__LAST_LEADERSHIP_MATCHES__)
        ? window.__LAST_LEADERSHIP_MATCHES__.find(item => String(item.matchId) === matchId)
        : null;

    // Quando a liga usa winnerFromScore, o placar é a fonte única do resultado.
    // Em mata-mata de jogo único, um vencedor não-empatado também determina
    // automaticamente o classificado. Em ida/volta isso NÃO é feito por uma
    // perna isolada, pois o classificado só pode ser decidido pelo confronto.
    if (matchData?.winnerFromScore === true && Number.isInteger(sim.scoreA) && Number.isInteger(sim.scoreB)) {
        sim.winner = sim.scoreA > sim.scoreB ? 'A' : (sim.scoreB > sim.scoreA ? 'B' : 'Draw');

        const isKnockout = matchData.phase === 'knockout';
        const isSingleLeg = isKnockout && !isStrategyHomeAwayMatch(matchData);
        if (isSingleLeg && sim.winner !== 'Draw') {
            sim.qualifier = sim.winner;
            sim.__autoQualifier = true;
        } else if (!isSingleLeg && sim.__autoQualifier) {
            delete sim.qualifier;
            delete sim.__autoQualifier;
        }
    }

    if (Object.keys(sim).length === 0) delete rankingState.simulatedResults[matchId];

    const select = document.getElementById('strategy-user-select');
    const selectedId = select ? select.value : null;
    const selectedName = select?.options[select.selectedIndex]?.text.split(' - ')[1] || 'SEU';

    document.querySelectorAll('.segment-btn').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.mode === 'simulacao') b.classList.add('active');
    });

    // Não dispara request para estado parcial do card.
    if (window.__isSimulationCardComplete(matchId)) {
        scheduleSimulationRanking(matchId, selectedId, selectedName);
    } else {
        clearSimulationRequestTimer(matchId);
        window.__refreshSimulationControls?.(matchId);
    }
};

export function getSimulationPayload() {
    const payload = {};
    Object.entries(rankingState.simulatedResults).forEach(([id, sim]) => {
        if (!sim || typeof sim !== 'object') return;
        // Nunca envie ao backend um card parcialmente preenchido. Isso é
        // importante quando um card A está incompleto e um card B completo
        // dispara a consulta: o estado local de A continua, mas A não pode
        // entrar no cenário enviado.
        if (typeof window.__isSimulationCardComplete === 'function' &&
            !window.__isSimulationCardComplete(id)) return;
        const clean = { ...sim };
        delete clean.__autoQualifier;
        if (Object.keys(clean).length > 0) payload[id] = clean;
    });
    return payload;
}

/* =====================
    LOAD RANKING
===================== */
