// js/allBets.js
// Depende de: api.js, ui.js, config.js

const AB_STATE = {
  filters: {
    search: '',
    matchId: '',
    userId: '',
    group: '',
    sortBy: 'user',
  },
  page: 1,
  pageSize: 5, // usuários por página
  cache: {
    matches: [],
    users: [],
    bets: [], // resposta do backend (já enriquecida)
  },
};

export function initAllBetsTab() {
  bindAllBetsUI();
  preloadFilters();
  // Não buscar automaticamente: o usuário clica "Buscar"
}

function bindAllBetsUI() {
  const $ = (id) => document.getElementById(id);

  const searchInput = $('ab-search');
  const matchSearchInput = $('ab-match-search');
  const matchIdSelect = $('ab-matchId');
  const userIdSelect = $('ab-userId');
  const groupSelect = $('ab-group');
  const sortBySelect = $('ab-sortBy');
  const searchBtn = $('ab-search-btn');
  const clearBtn = $('ab-clear-btn');

  // Atualiza estado ao mudar selects/inputs
  searchInput?.addEventListener('input', (e) => {
    AB_STATE.filters.search = e.target.value.trim();
  });

  matchSearchInput?.addEventListener('input', (e) => {
    // Texto livre de partida; resolvemos para matchId ao clicar "Buscar"
    matchSearchInput.dataset.freeText = e.target.value.trim();
  });

  matchIdSelect?.addEventListener('change', (e) => {
    AB_STATE.filters.matchId = e.target.value;
  });

  userIdSelect?.addEventListener('change', (e) => {
    AB_STATE.filters.userId = e.target.value;
  });

  groupSelect?.addEventListener('change', (e) => {
    AB_STATE.filters.group = e.target.value;
  });

  sortBySelect?.addEventListener('change', (e) => {
    AB_STATE.filters.sortBy = e.target.value || 'user';
  });

  // Buscar
  searchBtn?.addEventListener('click', async () => {
    AB_STATE.page = 1;

    // Se o usuário digitou um texto de partida, tentamos resolver para um matchId
    const freeText = (matchSearchInput?.dataset.freeText || '').toLowerCase();

    if (freeText) {
      const match = resolveMatchByFreeText(freeText);
      AB_STATE.filters.matchId = match ? String(match.matchId) : '';
      // Também seleciona no dropdown, se existir
      if (match && matchIdSelect) {
        matchIdSelect.value = String(match.matchId);
      }
    }

    await fetchAndRenderAllBets();
  });

  // Limpar filtros
  clearBtn?.addEventListener('click', async () => {
    AB_STATE.filters = {
      search: '',
      matchId: '',
      userId: '',
      group: '',
      sortBy: 'user',
    };
    AB_STATE.page = 1;

    if (searchInput) searchInput.value = '';
    if (matchSearchInput) {
      matchSearchInput.value = '';
      matchSearchInput.dataset.freeText = '';
    }
    if (matchIdSelect) matchIdSelect.value = '';
    if (userIdSelect) userIdSelect.value = '';
    if (groupSelect) groupSelect.value = '';
    const sort = $('ab-sortBy');
    if (sort) sort.value = 'user';

    // limpa lista e paginação
    renderAllBets([], 0);
  });
}

function resolveMatchByFreeText(freeText) {
  // Busca na lista de partidas já carregadas (cache.matches)
  // Tenta casar teamA, teamB e "teamA vs teamB" contendo o texto
  let best = null;
  let bestScore = -1;

  AB_STATE.cache.matches.forEach((m) => {
    const a = (m.teamA || '').toLowerCase();
    const b = (m.teamB || '').toLowerCase();
    const name = `${a} vs ${b}`;

    // Scoring simples: contém nos nomes => soma pontos
    let score = 0;
    if (a.includes(freeText)) score += 1;
    if (b.includes(freeText)) score += 1;
    if (name.includes(freeText)) score += 2;

    if (score > bestScore) {
      bestScore = score;
      best = score > 0 ? m : best; // só considera se score positivo
    }
  });

  return best;
}

async function preloadFilters() {
  try {
    // Carrega partidas
    const matchesResp = await apiGet('/api/bets/matches-for-filter', true);
    AB_STATE.cache.matches = matchesResp?.data || [];

    // Preenche select matchId
    fillMatchSelect('ab-matchId', AB_STATE.cache.matches);

    // Carrega usuários
    const usersResp = await apiGet('/api/bets/users-for-filter', true);
    AB_STATE.cache.users = usersResp?.data || [];

    fillUsersSelect('ab-userId', AB_STATE.cache.users);
  } catch (e) {
    console.error('Erro ao pré-carregar filtros:', e);
  }
}

function fillMatchSelect(selectId, matches) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Selecionar partida --</option>';
  matches.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.matchId;
    opt.textContent = `#${m.matchId} • ${m.teamA} vs ${m.teamB} (${m.group || ''})`;
    sel.appendChild(opt);
  });
}

function fillUsersSelect(selectId, users) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Selecionar usuário --</option>';
  users.forEach((u) => {
    const opt = document.createElement('option');
    opt.value = u._id;
    opt.textContent = `${u.name} (${u.email})`;
    sel.appendChild(opt);
  });
}

async function fetchAndRenderAllBets() {
  try {
    const { search, matchId, userId, group, sortBy } = AB_STATE.filters;

    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (matchId) params.set('matchId', matchId);
    if (userId) params.set('userId', userId);
    if (group) params.set('group', group);
    if (sortBy) params.set('sortBy', sortBy);

    const url = `/api/bets/all-bets?${params.toString()}`;
    const resp = await apiGet(url, true);

    // bets = [{ user, userName, userEmail, groupMatches: [...], podium, totalPoints, ... }]
    const bets = resp?.data || [];
    AB_STATE.cache.bets = bets;

    // Se há filtro de partida, vamos exibir somente esse jogo por usuário:
    const filteredForMatch = applyClientSideMatchFilter(bets, matchId);

    // paginação por usuário (cada item é um usuário)
    const totalUsers = filteredForMatch.length;
    const { page, pageSize } = AB_STATE;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    const pageItems = filteredForMatch.slice(start, end);

    renderAllBets(pageItems, totalUsers);
    renderPagination(totalUsers);
  } catch (e) {
    console.error('Erro ao buscar todos os palpites:', e);
    renderAllBets([], 0, 'Erro ao buscar palpites.');
  }
}

function applyClientSideMatchFilter(bets, matchId) {
  if (!matchId) return bets;

  const id = parseInt(matchId, 10);
  // Para cada usuário, mantém só o palpite da partida solicitada.
  // Se o usuário não tem palpite para esse jogo, removemos da lista.
  const result = [];

  for (const b of bets) {
    const onlyThatMatch = (b.groupMatches || []).filter((gm) => gm.matchId === id);
    if (onlyThatMatch.length > 0) {
      result.push({
        ...b,
        groupMatches: onlyThatMatch,
      });
    }
  }

  return result;
}

function renderAllBets(userItems, total, errorMsg) {
  const list = document.getElementById('ab-list');
  if (!list) return;

  if (errorMsg) {
    list.innerHTML = `<div class="message error">${errorMsg}</div>`;
    return;
  }

  if (!total || userItems.length === 0) {
    list.innerHTML = `<div class="message info">Nenhum resultado para os filtros atuais.</div>`;
    return;
  }

  // Layout compacto por usuário
  const html = userItems
    .map((u) => {
      const betsChips = (u.groupMatches || [])
        .map((m) => {
          const status =
            m.status === 'finished'
              ? `<span class="ab-chip ab-chip--success">Finalizado</span>`
              : `<span class="ab-chip">Agendado</span>`;

          const result =
            m.status === 'finished'
              ? `<span class="ab-chip ab-chip--neutral">Resultado: ${m.scoreA ?? '-'}-${m.scoreB ?? '-'}</span>`
              : '';

          return `
            <div class="ab-match-chip">
              <div class="ab-match-chip__title">${m.matchName || `${m.teamA} vs ${m.teamB}`}</div>
              <div class="ab-match-chip__meta">
                <span class="ab-chip ab-chip--group">${m.group || ''}</span>
                ${status}
                ${result}
              </div>
              <div class="ab-match-chip__bet">
                <strong>Palpite:</strong> ${m.bet || `${m.scoreA ?? 0}-${m.scoreB ?? 0}`}
                ${m.points > 0 ? `<span class="ab-chip ab-chip--points">+${m.points}pt</span>` : ''}
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <div class="ab-user-card">
          <div class="ab-user-card__header">
            <div>
              <div class="ab-user-card__name">${u.userName || (u.user && u.user.name) || '—'}</div>
              <div class="ab-user-card__email">${u.userEmail || (u.user && u.user.email) || ''}</div>
            </div>
            <div class="ab-user-card__score">
              <div class="ab-user-card__score-total">${u.totalPoints ?? 0}</div>
              <div class="ab-user-card__score-label">pontos</div>
            </div>
          </div>
          <div class="ab-user-card__bets">
            ${betsChips || '<div class="message warning">Sem palpite para a partida escolhida.</div>'}
          </div>
        </div>
      `;
    })
    .join('');

  list.innerHTML = html;
}

function renderPagination(totalUsers) {
  const el = document.getElementById('ab-pagination');
  if (!el) return;

  if (totalUsers <= AB_STATE.pageSize) {
    el.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(totalUsers / AB_STATE.pageSize);
  const cur = AB_STATE.page;

  const btn = (p, label, disabled = false, active = false) => `
    <button class="btn btn-small ${active ? 'btn-info' : ''}" ${disabled ? 'disabled' : ''} data-page="${p}">
      ${label}
    </button>
  `;

  let html = '';
  html += btn(Math.max(1, cur - 1), '« Anterior', cur === 1);

  // páginas (máximo 5 botões visíveis)
  const windowSize = 5;
  const start = Math.max(1, cur - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  for (let p = start; p <= end; p++) {
    html += btn(p, String(p), false, p === cur);
  }

  html += btn(Math.min(totalPages, cur + 1), 'Próxima »', cur === totalPages);

  el.innerHTML = html;

  el.querySelectorAll('button[data-page]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      const p = parseInt(e.currentTarget.dataset.page, 10);
      if (!isNaN(p) && p !== AB_STATE.page) {
        AB_STATE.page = p;
        await fetchAndRenderAllBets();
      }
    });
  });
}
