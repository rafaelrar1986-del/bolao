
// allBets.js (module)
import { getAllBets, getMatchesForFilter, getUsersForFilter } from './api.js';
import { html, qs, qsa, paginate, escapeHtml } from './utils.js';

let viewMode = 'detailed';
let currentPage = 1;
let currentLimit = 20;
let currentSearch = '';
let currentMatchId = '';
let currentUserId = '';
let currentSort = 'user';

export function setupAllBetsUI() {
  qs('#view-detailed').addEventListener('click', ()=>toggleView('detailed'));
  qs('#view-compact').addEventListener('click', ()=>toggleView('compact'));

  qs('#apply-filters').addEventListener('click', ()=>{
    currentSearch = qs('#filter-search').value.trim();
    currentMatchId = qs('#filter-match').value;
    currentUserId = qs('#filter-user').value;
    currentLimit = Number(qs('#filter-limit').value || 20);
    currentSort = qs('#filter-sort').value || 'user';
    currentPage = 1;
    loadAllBets();
  });
  qs('#clear-filters').addEventListener('click', ()=>{
    qs('#filter-search').value = '';
    qs('#filter-match').value = '';
    qs('#filter-user').value = '';
    qs('#filter-limit').value = '20';
    qs('#filter-sort').value = 'user';
    currentSearch = ''; currentMatchId=''; currentUserId=''; currentLimit=20; currentSort='user'; currentPage=1;
    loadAllBets();
  });

  preloadFilters();
  loadAllBets();
}

function toggleView(mode) {
  viewMode = mode;
  qs('#view-detailed').classList.toggle('active', mode==='detailed');
  qs('#view-compact').classList.toggle('active', mode==='compact');
  loadAllBets();
}

async function preloadFilters() {
  try {
    const [matchesRes, usersRes] = await Promise.all([getMatchesForFilter(), getUsersForFilter()]);
    const matchSel = qs('#filter-match');
    const userSel = qs('#filter-user');
    if (matchesRes.data?.length) {
      matchSel.innerHTML = '<option value="">Todas</option>' + matchesRes.data.map(m=>`<option value="${m.matchId}">${escapeHtml(m.teamA)} vs ${escapeHtml(m.teamB)} (${escapeHtml(m.group)})</option>`).join('');
    }
    if (usersRes.data?.length) {
      userSel.innerHTML = '<option value="">Todos</option>' + usersRes.data.map(u=>`<option value="${u._id}">${escapeHtml(u.name)}</option>`).join('');
    }
  } catch (e) { /* ignore */ }
}

export async function loadAllBets(page = currentPage) {
  currentPage = page;
  const container = qs('#all-bets-container');
  const summary = qs('#all-bets-summary');
  try {
    html(container, '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>');
    const params = {
      page: currentPage,
      limit: currentLimit,
      sortBy: currentSort
    };
    if (currentSearch) params.search = currentSearch;
    if (currentMatchId) params.matchId = currentMatchId;
    if (currentUserId) params.userId = currentUserId;

    const res = await getAllBets(params);
    const list = res.data || [];
    const stats = res.stats || { totalBets: 0, totalUsers: 0, totalMatches: 0 };
    const total = res.total || list.length;
    const pageCount = Math.max(1, Math.ceil(total / currentLimit));

    html(summary, `Exibindo <strong>${list.length}</strong> itens nesta página • Participantes: <strong>${stats.totalUsers||0}</strong> • Partidas distintas: <strong>${stats.totalMatches||0}</strong>`);

    if (!list.length) {
      html(container, '<p class="muted">Nenhum resultado encontrado.</p>');
    } else {
      html(container, viewMode==='compact' ? renderCompact(list) : renderDetailed(list));
    }

    paginate({
      page: currentPage,
      pages: pageCount,
      onPage: (p)=> loadAllBets(p)
    });

  } catch (e) {
    html(container, `<p>Erro ao carregar: ${e.message}</p>`);
  }
}

function renderDetailed(list) {
  return list.map(b=>{
    const user = b.userName || (b.user?.name) || 'Usuário';
    let h = `<div class="card"><h3>${escapeHtml(user)} <span class="muted">— ${b.totalPoints||0} pts</span></h3>`;
    h += `<div class="muted mt-1"><strong>Pódio:</strong> ${escapeHtml(b.podium?.first||'-')} • ${escapeHtml(b.podium?.second||'-')} • ${escapeHtml(b.podium?.third||'-')}</div>`;
    if (b.groupMatches?.length) {
      h += `<div class="spaced">`;
      b.groupMatches.forEach(m=>{
        h += `<div class="bet-item">
          <div class="bet-header"><span>${escapeHtml(m.matchName||`Jogo ${m.matchId}`)}</span><span class="muted">${escapeHtml(m.group||'')}</span></div>
          <p><strong>Palpite:</strong> ${escapeHtml(m.bet||'')}</p>
          <p><strong>Status:</strong> ${escapeHtml(m.status||'scheduled')}</p>
        </div>`;
      });
      h += `</div>`;
    }
    h += `</div>`;
    return h;
  }).join('');
}

function renderCompact(list) {
  return list.map(b=>{
    const user = b.userName || (b.user?.name) || 'Usuário';
    const total = b.groupMatches?.length || 0;
    const preview = (b.groupMatches||[]).slice(0, 5).map(m=>`${escapeHtml(m.matchName||('Jogo '+m.matchId))}: <strong>${escapeHtml(m.bet||'')}</strong>`).join(' • ');
    return `<div class="card">
      <div class="flex-between">
        <h3>${escapeHtml(user)}</h3>
        <div class="muted">Total de palpites: ${total}</div>
      </div>
      <div class="mt-1">${preview}${total>5?` • … (${total-5} mais)`:''}</div>
      <div class="muted mt-1"><strong>Pontos:</strong> ${b.totalPoints||0} • <strong>Grupos:</strong> ${b.groupPoints||0} • <strong>Pódio:</strong> ${b.podiumPoints||0}</div>
    </div>`;
  }).join('');
}
