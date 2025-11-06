// js/myBets.js
import { api } from './api.js';

const $container = () => document.getElementById('user-bets-container');

export async function initMyBets() {
  await loadMyBets();
}

export async function loadMyBets() {
  try {
    const res = await api.get('/api/bets/my-bets');
    if (!res.success) throw new Error(res.message || 'Erro');
    renderMyBets(res.data);
  } catch (e) {
    console.error(e);
    if ($container()) $container().innerHTML = '<p>Erro ao carregar seus palpites.</p>';
  }
}

function renderMyBets(bet) {
  const el = $container();
  if (!el) return;

  if (!bet) {
    el.innerHTML = '<p>Você ainda não enviou seus palpites.</p>';
    return;
  }

  let html = `
    <div class="bet-card">
      <h3><i class="fas fa-user"></i> Informações dos Palpites</h3>
      <p><strong>Status:</strong> ${bet.hasSubmitted ? '✅ Enviados' : '⏳ Pendentes'}</p>
      ${bet.firstSubmission ? `<p><strong>Enviado em:</strong> ${new Date(bet.firstSubmission).toLocaleString('pt-BR')}</p>` : ''}
      <p><strong>Pontuação Total:</strong> <span style="color: var(--primary); font-weight: bold;">${bet.totalPoints || 0} pontos</span></p>
      <p><strong>Pontos dos Jogos:</strong> ${bet.groupPoints || 0} pontos</p>
      <p><strong>Pontos do Pódio:</strong> ${bet.podiumPoints || 0} pontos</p>
    </div>
  `;

  // jogos (mostrar nome do time escolhido ou "Empate")
  if (Array.isArray(bet.groupMatches) && bet.groupMatches.length) {
    html += `
      <div class="bet-card">
        <h3><i class="fas fa-futbol"></i> Palpites - Fase de Grupos</h3>
    `;

    // ordenar por group/matchId se vier info
    const items = [...bet.groupMatches];

    items.forEach(item => {
      const chosenLabel = item.winner === 'A' ? (item.teamA || 'Time A')
                         : item.winner === 'B' ? (item.teamB || 'Time B')
                         : 'Empate';

      // status finalizado => pinta win/lose
      let pointsHTML = '';
      let chipClass = 'pending';
      if (item.status === 'finished') {
        if ((item.points || 0) > 0) { chipClass = 'win'; pointsHTML = `<span style="color: var(--success); font-weight: 700;">+1 ponto</span>`; }
        else { chipClass = 'lose'; pointsHTML = `<span style="color: var(--danger); font-weight: 700;">0 ponto</span>`; }
      }

      html += `
        <div class="bet-item">
          <div class="bet-header">
            <span><strong>${item.matchName || `Jogo ${item.matchId}`}</strong></span>
            <span>${item.status === 'finished' ? '✓ Finalizado' : '⏰ Pendente'}</span>
          </div>
          <p><strong>Seu palpite:</strong> <span class="chip ${chipClass}">${chosenLabel}</span></p>
          ${item.status === 'finished' ? `<p><strong>Pontuação:</strong> ${pointsHTML}</p>` : ``}
        </div>
      `;
    });

    html += `</div>`;
  }

  // pódio
  if (bet.podium) {
    html += `
      <div class="bet-card">
        <h3><i class="fas fa-trophy"></i> Pódio</h3>
        <div class="chips">
          <span class="chip">🥇 ${bet.podium.first || '-'}</span>
          <span class="chip">🥈 ${bet.podium.second || '-'}</span>
          <span class="chip">🥉 ${bet.podium.third || '-'}</span>
        </div>
      </div>
    `;
  }

  el.innerHTML = html;
}
