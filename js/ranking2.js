/**
 * Facade do ranking.
 *
 * A implementação foi dividida por responsabilidade para reduzir o acoplamento
 * e facilitar manutenção/testes, mantendo este arquivo como ponto de entrada
 * compatível com app4.js.
 */
import { loadRanking, initRanking, preloadRanking } from './ranking/controller.js';
import './ranking/simulation.js';
import './ranking/helpers.js';
import './ranking/uiActions.js';

export { loadRanking, initRanking, preloadRanking };
