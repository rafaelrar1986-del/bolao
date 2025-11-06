// js/myBets.js
import { api } from './api.js';
import { toast } from './ui.js';

const $container = () => document.getElementById('user-bets-container');

function computeWinnerFromScore(a, b) {
  const A = Number(a), B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B)) return null;
  if (A > B) return 'A';
  if (B > A) return 'B';
  return 'draw';
}

function winnerLabel(match, winnerCode) {
  if (!winnerCode) return '-';
  if (winnerCode === 'draw') return 'Empate';
  if (winnerCode === 'A') return match?.teamA || 'Time A';
  if (winnerCode === 'B') return match?.teamB || 'Time B';
  return '-';
}

export async function loadMyBets() {
  if (!$container()) return;
  $container().innerHTML = `<div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>`;

  try {
    const res = await api.get('/api/bets/my-bets');
    if (!res.success) throw new Error(res.message || 'Erro');

    if (!res.data) {
      $container().innerHTML = `<p>Você ainda não enviou seus palpites.</p>`;
      return;
    }

    const bets = res.data.groupMatches || [];
    if (!bets.length) {
      $container().innerHTML = `<p>Nenhum palpite encontrado.</p>`;
      return;
    }

    // render
    let html = '';
    bets
      .sort((a, b) => a.matchId - b.matchId)
      .forEach(b => {
        // b: { matchId, winner, points, matchName, teamA, teamB, status, scoreA?, scoreB? (pode vir se você povoar no backend) }
        const match = {
          teamA: b.teamA,
          teamB: b.teamB,
          status: b.status,
          scoreA: b.scoreA,
          scoreB: b.scoreB,
          matchName: b.matchName
        };

        const userChoice = b.winner;                   // 'A' | 'B' | 'draw'
        const userChoiceLabel = winnerLabel(match, userChoice);

        let chipClass = 'pending';
        let resultLabel = 'Aguardando';
        if (match.status === 'finished' && b.scoreA !== undefined && b.scoreB !== undefined) {
          const resultWinner = computeWinnerFromScore(b.scoreA, b.scoreB);
          resultLabel = winnerLabel(match, resultWinner);
          chipClass = resultWinner === userChoice ? 'win' : 'lose';
        } else if (match.status === 'finished' && (b.scoreA === undefined || b.scoreB === undefined)) {
          // caso backend não inclua o placar no enrich; apenas marca como finished, sem calcular acerto/erro
          chipClass = (b.points === 1) ? 'win' : 'lose';
          resultLabel = (b.points === 1) ? 'Acertou' : 'Errou';
        }

        html += `
          <div class="bet-item">
            <div class="bet-header">
              <span>${match.matchName || `Jogo ${b.matchId}`}</span>
              <span>Palpite: <strong>${userChoiceLabel}</strong></span>
            </div>
            <div class="chips">
              <span class="chip ${chipClass}">
                ${match.status === 'finished' ? `Resultado: ${resultLabel}` : 'Pendente'}
              </span>
              <span class="chip">Pontos: ${Number(b.points || 0)}</span>
            </div>
          </div>
        `;
      });

    $container().innerHTML = `<div class="bet-card">${html}</div>`;
  } catch (err) {
    console.error(err);
    $container().innerHTML = `<p>Erro ao carregar seus palpites.</p>`;
    toast('Erro ao carregar Meus Palpites', 'error');
  }
}
