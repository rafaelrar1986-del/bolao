// js/allBets.js
import { api } from './api.js';
import { toast } from './ui.js';

const $container = () => document.getElementById('all-bets-container');
const $pagination = () => document.getElementById('all-bets-pagination');

const AB_STATE = {
  list: [],
  page: 1,
  pageSize: 5,
  search: '',
  matchId: '',
  group: '',
  sortBy: 'user'
};

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

export async function initAllBets() {
  // filtros
  document.getElementById('btn-search')?.addEventListener('click', () => {
    AB_STATE.search = document.getElementById('filter-search').value.trim();
    AB_STATE.matchId = document.getElementById('filter-match').value;
    AB_STATE.group = document.getElementById('filter-group').value.trim();
    AB_STATE.sortBy = document.getElementById('filter-sort').value;
    AB_STATE.page = 1;
    loadAllBets();
  });
  document.getElementById('btn-clear')?.addEventListener('click', () => {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-match').value = '';
    document.getElementById('filter-group').value = '';
    document.getElementById('filter-sort').value = 'user';
    AB_STATE.search = '';
    AB_STATE.matchId = '';
    AB_STATE.group = '';
    AB_STATE.sortBy = 'user';
    AB_STATE.page = 1;
    loadAllBets();
  });

  // combos de partida/usuário (seus endpoints já existem)
  try {
    const [matchesRes] = await Promise.all([
      api.get('/api/bets/matches-for-filter'),
    ]);

    const matchSel = document.getElementById('filter-match');
    matchSel.innerHTML = `<option value="">Todas</option>`;
    (matchesRes?.data || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.matchId;
      opt.textContent = `${m.matchId} - ${m.teamA} vs ${m.teamB}`;
      matchSel.appendChild(opt);
    });
  } catch (e) {
    console.warn('Falha ao preencher filtros auxiliares', e);
  }

  loadAllBets();
}

export async function loadAllBets() {
  if ($container()) {
    $container().innerHTML = `<div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>`;
  }

  try {
    const params = new URLSearchParams();
    if (AB_STATE.search) params.set('search', AB_STATE.search);
    if (AB_STATE.matchId) params.set('matchId', AB_STATE.matchId);
    if (AB_STATE.group) params.set('group', AB_STATE.group);
    if (AB_STATE.sortBy) params.set('sortBy', AB_STATE.sortBy);

    const res = await api.get(`/api/bets/all-bets?${params.toString()}`);
    if (!res.success) throw new Error(res.message || 'Erro');

    // Espera-se data: [{ userName, podium, totalPoints, groupMatches:[ {matchId, teamA, teamB, status, scoreA?, scoreB?, winner, points } ] }]
    const raw = res.data || [];

    // Se matchId foi usado, manter SOMENTE o palpite dessa partida por usuário (UX pedido).
    let list = raw.map(u => {
      const arr = (u.groupMatches || u.bets || u.group_matches || u.matches || []);
      let filtered = arr;
      if (AB_STATE.matchId) {
        filtered = arr.filter(g => String(g.matchId) === String(AB_STATE.matchId));
      }
      return {
        userName: u.userName,
        totalPoints: u.totalPoints || 0,
        groupMatches: filtered
      };
    });

    // paginação
    AB_STATE.list = list;
    renderAllBets();
  } catch (err) {
    console.error(err);
    if ($container()) $container().innerHTML = `<p>Erro ao carregar palpites.</p>`;
    toast('Erro ao carregar "Todos os Palpites"', 'error');
  }
}

function renderAllBets() {
  const root = $container();
  if (!root) return;

  const total = AB_STATE.list.length;
  const pages = Math.max(1, Math.ceil(total / AB_STATE.pageSize));
  AB_STATE.page = Math.min(AB_STATE.page, pages);

  const start = (AB_STATE.page - 1) * AB_STATE.pageSize;
  const end = start + AB_STATE.pageSize;
  const slice = AB_STATE.list.slice(start, end);

  if (!slice.length) {
    root.innerHTML = `<p>Nenhum palpite encontrado.</p>`;
    $pagination().innerHTML = '';
    return;
  }

  let html = '';
  slice.forEach(u => {
    const chips = (u.groupMatches || []).map(g => {
      const userChoice = g.winner || g.choice; // backend pode retornar winner
      const label = winnerLabel(g, userChoice);

      let cls = 'pending';
      let resultText = 'Pendente';
      if (g.status === 'finished') {
        if (g.scoreA !== undefined && g.scoreB !== undefined) {
          const resW = computeWinnerFromScore(g.scoreA, g.scoreB);
          cls = (resW === userChoice) ? 'win' : 'lose';
          resultText = (resW === userChoice) ? 'Acertou' : 'Errou';
        } else {
          // fallback caso sem placar enriquecido
          cls = (g.points === 1) ? 'win' : 'lose';
          resultText = (g.points === 1) ? 'Acertou' : 'Errou';
        }
      }

      return `
        <span class="chip ${cls}">
          ${g.matchName || `${g.teamA} vs ${g.teamB}`} • Seu palpite: <strong>${label}</strong> • ${resultText}
        </span>
      `;
    }).join('');

    html += `
      <div class="user-bets-compact">
        <div class="user-bets-header">
          <div>
            <strong>${u.userName}</strong>
          </div>
          <div>Pontos: <strong>${u.totalPoints || 0}</strong></div>
        </div>
        <div class="chips">
          ${chips || '<span class="chip pending">Sem palpites para este filtro</span>'}
        </div>
      </div>
    `;
  });

  root.innerHTML = html;

  // paginação
  const pagesCount = Math.max(1, Math.ceil(total / AB_STATE.pageSize));
  let pHtml = '';
  for (let i = 1; i <= pagesCount; i++) {
    pHtml += `<button class="page-btn ${i === AB_STATE.page ? 'active' : ''}" data-p="${i}">${i}</button>`;
  }
  $pagination().innerHTML = pHtml;
  $pagination().querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      AB_STATE.page = Number(btn.dataset.p);
      renderAllBets();
    });
  });
}
