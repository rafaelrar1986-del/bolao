// js/LeagueSelection.js — adaptado para vanilla JS + API nova
import { api } from './api.js';
import { getLeagueLogoUrl } from './leagueLogo.js';

function getTimeRemaining(dateString) {
  if (!dateString) return "Indefinido";
  const total = Date.parse(dateString) - Date.parse(new Date());
  if (total <= 0) return "Fechado";
  const minutes = Math.floor((total / 1000 / 60) % 60);
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Renderiza a tela de selecao de campeonatos.
 * Pode ser chamada diretamente ou usada como modulo.
 */
export async function showLeagueSelection() {
  const $loginSection = document.getElementById('login-section');
  const $appSection = document.getElementById('app-section');
  const $leagueSection = document.getElementById('league-selection-section');

  if ($loginSection) $loginSection.hidden = true;
  if ($appSection) $appSection.hidden = true;
  if ($leagueSection) $leagueSection.hidden = false;

  try {
    const res = await api.get('/api/matches/leagues');
    const container = document.getElementById('leagues-container');
    if (!container) return;
    container.innerHTML = '';

    const leagues = res?.success ? res.data : res;
    if (!Array.isArray(leagues)) {
      console.error("Resposta invalida de /api/matches/leagues:", res);
      return;
    }

    leagues.forEach(league => {
      const leagueLogoUrl = getLeagueLogoUrl(league);

      const timeDisplay = getTimeRemaining(league.nextMatchDate);
      const hasNoMatches = Number(league.totalMatches || 0) === 0;
      const isClosed = !hasNoMatches && league.count === 0;

      const statusText = hasNoMatches
        ? `<span style="color: #ffc107; font-weight: bold;">Nenhuma partida cadastrada</span>`
        : isClosed
          ? `<span style="color: #ffc107; font-weight: bold;">Rodada Finalizada</span>`
          : `${league.count} partidas disponiveis`;

      const nextMatchInfo = hasNoMatches
        ? 'Campeonato criado — aguardando partidas.'
        : isClosed
          ? 'Confira os resultados e o ranking!'
          : (league.nextMatchTeams ? `Proximo: <strong>${league.nextMatchTeams}</strong>` : 'Rodada aberta');

      const footerLabel = hasNoMatches
        ? `<i class="fas fa-plus-circle"></i> <span>Campeonato disponível</span>`
        : isClosed
          ? `<i class="fas fa-trophy"></i> <span>Ranking Atualizado</span>`
          : `<i class="fas fa-clock"></i> <span>Fecha em: <strong>${timeDisplay}</strong></span>`;

      const card = document.createElement('div');
      card.className = 'league-card-modern';
      card.innerHTML = `
        <div class="league-card-glass ${isClosed ? 'league-readonly' : ''}">
          <div class="league-logo-container">
            <img src="${leagueLogoUrl}"
                 class="league-logo-img"
                 alt="${league.name}"
                 onerror="this.onerror=null; this.src='https://via.placeholder.com/60?text=🏆';"
                 loading="lazy">
          </div>
          <div class="league-info">
            <h3 class="league-title">${league.name}</h3>
            <p class="league-info-text">${statusText}</p>
            <p class="league-info-text">${nextMatchInfo}</p>
          </div>
          <div class="league-actions">
            <button class="btn-modern-primary">${isClosed ? 'Ver Resultados' : 'Entrar'}</button>
            <span class="ver-mais-link">Ver Ranking</span>
          </div>
          <div class="league-footer-info">
            ${footerLabel}
          </div>
        </div>
      `;
      card.onclick = () => selectLeague(league.id, league.name);
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Erro ao carregar torneios:", err);
  }
}

export function selectLeague(id, name) {
  const leagueId = String(id ?? '').trim();
  if (!leagueId) return;

  // O app4 centraliza o registro do pedido quando a seleção é concluída.
  localStorage.setItem('selectedLeagueId', leagueId);
  localStorage.setItem('selectedLeagueName', name || '');
  window.dispatchEvent(new CustomEvent('league-selected', { detail: { id: leagueId, name: name || '' } }));
}
