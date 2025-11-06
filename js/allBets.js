// js/allBets.js
import { api } from './api.js';
import { toast } from './ui.js';

const AB_STATE = {
  all: [],
  page: 1,
  pageSize: 5
};

const $container = () => document.getElementById('all-bets-container');
const $pagination = () => document.getElementById('all-bets-pagination');

export async function initAllBets() {
  await preloadFilters();
  bindFilterButtons();
  await fetchAndRender(); // lista inicial
}

function bindFilterButtons() {
  document.getElementById('btn-search')?.addEventListener('click', async () => {
    AB_STATE.page = 1;
    await fetchAndRender();
  });
  document.getElementById('btn-clear')?.addEventListener('click', async () => {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-match').value = '';
    document.getElementById('filter-group').value = '';
    document.getElementById('filter-sort').value = 'user';
    AB_STATE.page = 1;
    await fetchAndRender();
  });
}

async function preloadFilters() {
  try {
    const res = await api.get('/api/bets/matches-for-filter');
    if (res.success) {
      const sel = document.getElementById('filter-match');
      if (sel) {
        sel.innerHTML = '<option value="">Todas</option>';
        (res.data || []).forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.matchId;
          opt.textContent = `${m.matchId} • ${m.teamA} vs ${m.teamB} (${m.group})`;
          sel.appendChild(opt);
        });
      }
    }
  } catch (_) {}
}

async function fetchAndRender() {
  try {
    const search = document.getElementById('filter-search').value.trim();
    const matchId = document.getElementById('filter-match').value;
    const group = document.getElementById('filter-group').value.trim();
    const sortBy = document.getElementById('filter-sort').value;

    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (matchId) qs.set('matchId', matchId);
    if (group) qs.set('group', group);
    if (sortBy) qs.set('sortBy', sortBy);

    const res = await api.get(`/api/bets/all-bets?${qs.toString()}`);
    if (!res.success) throw new Error(res.message || 'Erro');
    AB_STATE.all = res.data || [];
    renderPage();
  } catch (e) {
    console.error(e);
    if ($container()) $container().innerHTML = '<p>Erro ao buscar apostas</p>';
  }
}

function renderPage() {
  const el = $container();
  if (!el) return;

  const start = (AB_STATE.page - 1) * AB_STATE.pageSize;
  const end = start + AB_STATE.pageSize;
  const pageItems = AB_STATE.all.slice(start, end);

  if (!pageItems.length) {
    el.innerHTML = '<p>Nenhum resultado para os filtros aplicados.</p>';
    $pagination().innerHTML = '';
    return;
  }

  el.innerHTML = pageItems.map(userBlock).join('');
  renderPagination();
}

function userBlock(entry) {
  // entry.bets[] tem { matchId, choice(A/B/draw), matchName, teamA, teamB, status, points? }
  const chips = entry.bets.map(b => {
    const label = b.choice === 'A' ? (b.teamA || 'Time A')
                : b.choice === 'B' ? (b.teamB || 'Time B')
                : 'Empate';
    let cls = 'pending';
    if (b.status === 'finished') {
      cls = (b.points || 0) > 0 ? 'win' : 'lose';
    }
    return `<span class="chip ${cls}">${b.matchName || `Jogo ${b.matchId}`} • <strong>${label}</strong></span>`;
  }).join('');

  return `
    <div class="user-bets-compact">
      <div class="user-bets-header">
        <div><strong>${entry.userName}</strong></div>
        <div><strong>${entry.totalPoints || 0}</strong> pts</div>
      </div>
      <div class="chips">${chips}</div>
    </div>
  `;
}

function renderPagination() {
  const el = $pagination();
  if (!el) return;

  const totalPages = Math.ceil(AB_STATE.all.length / AB_STATE.pageSize);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = '';
  for (let p = 1; p <= totalPages; p++) {
    html += `<button class="page-btn ${p === AB_STATE.page ? 'active' : ''}" data-p="${p}">${p}</button>`;
  }
  el.innerHTML = html;

  el.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AB_STATE.page = Number(btn.dataset.p);
      renderPage();
    });
  });
}
