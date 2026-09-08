/**
 * Estado compartilhado do módulo de ranking.
 * Mantém compatibilidade com os objetos globais usados pelo restante do frontend,
 * mas concentra o estado mutável em um único lugar.
 */
export const rankingState = {
    strategyMode: 'official',
    simulatedResults: {},
    simulationRequestTimers: new Map(),
    strategyRequestGeneration: 0,
    isMiracleActive: false,
    rankingLoader: null,
};

export function setRankingLoader(loader) {
    rankingState.rankingLoader = typeof loader === 'function' ? loader : null;
}

export function getRankingLoader() {
    return rankingState.rankingLoader;
}

export function resetSimulationState() {
    rankingState.simulatedResults = {};
    rankingState.isMiracleActive = false;
}

// Contrato legado/global consumido por outros módulos e pelo HTML.
window.__LAST_SIMULATED_RANKING__ = [];
window.__CRITICAL_MATCHES__ = [];
window.__CURRENT_MATCHES__ = [];
