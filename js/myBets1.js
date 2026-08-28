// js/myBets1.js — Versão Definitiva Alinhada e Blindada
import { api } from './api.js';
import { toast } from './ui.js';
import { flagEmoji } from './flags.js';
import { calculateMatchPoints as calculateScoringMatchPoints, getScoringRules as getFrontendScoringRules } from './frontendScoring.js';

let renderTeamMedia = (teamName, logoUrl) => {
  const emoji = flagEmoji(teamName) || '';
  if (logoUrl && logoUrl.trim() !== '' && logoUrl !== 'null') {
    return `<img src="${logoUrl}" class="team-logo" style="width:20px;height:20px;object-fit:contain;" onerror="this.style.display='none'" alt="${teamName}">`;
  }
  return `<span class="team-emoji">${emoji}</span>`;
};

// My Bets é independente de matches4.js.
// Não importar matches4.js no topo: isso impediria o módulo inteiro de
// carregar caso a tela de partidas tivesse qualquer erro de inicialização.

const MyBetsState = {
  selectedUserId: 'me',
  isLockedView: false,
  bets: null,
  matches: [],
  scoringRules: null,
  championshipRules: null,
  groupPredictionPoints: new Map(),
  activeTab: 'group',
  openAccordions: {},
  openSections: {}
};

const KNOCKOUT_ORDER = [
  '16-avos de final',
  'Oitavas de final',
  'Quartas de final',
  'Semifinal',
  '3o lugar',
  'Final'
];

/* =====================
    HELPERS E REGRAS DE CÁLCULO LOCAL
===================== */
function winnerFromScore(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

function getScoringRules() {
  return getFrontendScoringRules({
    scoringRules: MyBetsState.scoringRules
  });
}

function calculateMatchPoints(bet, match) {
  const result = calculateScoringMatchPoints(
    {
      scoreA: bet.betScoreA ?? bet.scoreA,
      scoreB: bet.betScoreB ?? bet.scoreB,
      winner: bet.winner,
      qualifier: bet.qualifier
    },
    match,
    { scoringRules: getScoringRules() },
    false
  );

  return {
    points: result.points,
    hitWinner: result.breakdown.winner > 0,
    hitQualified: result.breakdown.qualifier > 0
  };
}

function getUserNameFromCache(userId) {
  const cache = window.__OFFICIAL_RANKING_CACHE__ || window.__RANKING_CACHE__ || [];
  const entry = cache.find(e => {
    const id = e.user?._id || e.user?.id || e.userId;
    return id === userId;
  });
  return entry ? (entry.user?.name || entry.name) : null;
}

function getSelectedUserName() {
  if (MyBetsState.selectedUserId === 'me') return 'SEU';
  const select = document.getElementById('palpites-user-select');
  if (select && select.selectedIndex > 0) return select.options[select.selectedIndex].text.split(' - ')[1] || 'USUARIO';
  return '';
}

/* =====================
    CARD DE PARTIDA
===================== */
function renderMatch(b) {
  const finished = b.status === 'finished';
  const matchData = MyBetsState.matches.find(m => Number(m.matchId) === Number(b.matchId));
  
  const logoA = matchData?.logoA || null;
  const logoB = matchData?.logoB || null;

  const mediaA = renderTeamMedia(b.teamA, logoA);
  const mediaB = renderTeamMedia(b.teamB, logoB);

  const isMatchLocked = b.isLocked || b.winner === '🔒' || b.qualifier === '🔒';

  // Calcula os pontos localmente utilizando as regras dinâmicas do Admin
  const calc = calculateMatchPoints(b, matchData);
  const pts = calc.points;
  const hitWinner = calc.hitWinner;
  const hitQualified = calc.hitQualified;

  let chipClass = 'pending';

  if (finished && !isMatchLocked) {
    if (isGroupPhase(b.phase) || isPointsRunPhase(b.phase)) {
      chipClass = pts > 0 ? 'win' : 'loss';
    } else {
      const acertos = (hitWinner ? 1 : 0) + (hitQualified ? 1 : 0);
      if (acertos === 2) chipClass = 'win';
      else if (acertos === 1) chipClass = 'partial';
      else chipClass = 'loss';
    }
  }

  let teamAClass = 'team-left';
  let teamBClass = 'team-left';

  if (isKnockoutPhase(b.phase) && b.qualifier && !isMatchLocked) {
    const qualifiedA = b.qualifier === 'A';
    const qualifiedB = b.qualifier === 'B';

    if (qualifiedA) teamAClass += ' qualified';
    if (qualifiedB) teamBClass += ' qualified';

    if (finished && matchData?.qualifiedSide) {
      const hit = b.qualifier === matchData.qualifiedSide;
      if (qualifiedA) teamAClass += hit ? ' hit' : ' miss';
      if (qualifiedB) teamBClass += hit ? ' hit' : ' miss';
    }
  }

  const hasBetScore = b.betScoreA != null && b.betScoreB != null && b.betScoreA !== '' && b.betScoreB !== '';
  const betScoreHTML = hasBetScore && !isMatchLocked
      ? `<div class="bet-score" style="font-size:0.75rem;color:#aaa;margin-top:4px;">Palpite: <strong style="color:#fff;">${b.betScoreA} x ${b.betScoreB}</strong></div>`
      : '';

  let pickHTML = '';
  if (isMatchLocked) {
    pickHTML = `<span class="pick-value" style="color:#ff6b6b;font-weight:700;font-size:0.85rem;" title="Palpite oculto ate liberacao">🔒 Oculto</span>`;
  } else {
    pickHTML = b.winner
      ? (b.winner === 'draw'
            ? `<span class="pick-value pick-draw">Empate</span>${betScoreHTML}`
            : `<div class="flag-wrapper-list-small">${renderTeamMedia(b.winner === 'A' ? b.teamA : b.teamB, b.winner === 'A' ? logoA : logoB)}</div>${betScoreHTML}`
        )
      : `<span class="pick-value">—</span>`;
  }

  return `
    <div class="modern-match-card ${chipClass}">
      <div class="match-left">
        <div class="${teamAClass}">
          <div class="flag-wrapper-list">${mediaA}</div>
          <span class="team-name">${b.teamA}</span>
        </div>
        <div class="match-divider"></div>
        <div class="${teamBClass}">
          <div class="flag-wrapper-list">${mediaB}</div>
          <span class="team-name">${b.teamB}</span>
        </div>
      </div>
      <div class="match-center">
        <span class="score">${finished ? `${matchData?.scoreA} - ${matchData?.scoreB}` : '–'}</span>
      </div>
      <div class="match-right">
        <div class="pick-box-modern">
          <span>Palpite</span>
          ${pickHTML}
        </div>
        ${pts > 0 ? `<div class="points-modern">+${pts}</div>` : ''}
      </div>
    </div>
  `;
}

/* =====================
    UI COMPONENTS
===================== */
function renderUserDropdown() {
  const cache = window.__OFFICIAL_RANKING_CACHE__ || window.__RANKING_CACHE__ || [];
  let optionsHtml = `<option value="me" ${MyBetsState.selectedUserId === 'me' ? 'selected' : ''}>Meus Palpites</option>`;

  cache.forEach(entry => {
    const id = entry.user?._id || entry.user?.id || entry.userId;
    const isCurrentUser = window.currentUser && (id === window.currentUser.id || id === window.currentUser._id);
    
    if (isCurrentUser) return;

    const isSelected = MyBetsState.selectedUserId === id ? 'selected' : '';
    optionsHtml += `<option value="${id}" ${isSelected}>${entry.position}o - ${entry.user?.name || entry.name || 'Usuario'}</option>`;
  });

  return `
    <div id="palpites-header" style="margin-bottom:20px;">
      <select id="palpites-user-select" class="form-select strategy-select" onchange="window.handleMyBetsUserChange(this.value)"
        style="width:100%;background:rgba(0,0,0,0.5);color:white;border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:10px;font-weight:600;outline:none;">
        ${optionsHtml}
      </select>
    </div>
  `;
}

function renderLockedScreen() {
  return `
    <div style="animation:fadeIn 0.3s ease-in-out;padding:15px;text-align:center;">
      <div style="background:rgba(0,0,0,0.4);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:50px 20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);color:white;">
        <div style="font-size:3rem;color:#ff6b6b;margin-bottom:20px;opacity:0.8;">🔒</div>
        <h3 style="font-size:1.2rem;font-weight:800;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;">Palpites Ocultos</h3>
        <p style="font-size:0.85rem;color:rgba(255,255,255,0.6);max-width:80%;margin:0 auto;line-height:1.5;">A trava de visibilidade esta ativa. Os palpites dos seus adversarios so serao liberados de acordo com a regra da liga.</p>
      </div>
    </div>
  `;
}

function getChampionshipRules() {
  return MyBetsState.championshipRules || {};
}

function getChampionshipMode() {
  const rules = getChampionshipRules();

  // The project has three independent modalities:
  // group phase, knockout phase and points-running.
  if (rules.hasGroupPhase === true && rules.hasKnockoutPhase === true) return 'group+knockout';
  if (rules.hasGroupPhase === true) return 'group';
  if (rules.hasKnockoutPhase === true) return 'knockout';
  return 'pontos_corridos';
}

function isGroupPhase(phase) {
  return String(phase || '').toLowerCase() === 'group';
}

function isPointsRunPhase(phase) {
  const p = String(phase || '').toLowerCase();
  return p === 'pontos_corridos' || p === 'points_run';
}

function isKnockoutPhase(phase) {
  const p = String(phase || '').toLowerCase().trim();
  // Fase desconhecida não pode ser classificada como mata-mata.
  if (!p) return false;
  return p !== 'group' && !isPointsRunPhase(p);
}

function getBetPhase(bet, matchMap) {
  const ownPhase = String(bet?.phase || '').trim();
  if (ownPhase) return ownPhase;
  const match = matchMap?.get(Number(bet?.matchId));
  return String(match?.phase || '').trim();
}

function hasGroupPhase() {
  return getChampionshipMode() === 'group' || getChampionshipMode() === 'group+knockout';
}

function hasKnockoutPhase() {
  return getChampionshipMode() === 'knockout' || getChampionshipMode() === 'group+knockout';
}

function isPointsRunChampionship() {
  return getChampionshipMode() === 'pontos_corridos';
}

function getPodiumSize() {
  const n = Number(getChampionshipRules().podiumSize);
  return Number.isFinite(n) && n > 0 ? Math.min(4, Math.floor(n)) : 0;
}

function hasPodiumFeature() {
  return getPodiumSize() > 0;
}

function hasExtrasFeature() {
  const r = getScoringRules();
  return ['topScorer','bestAttack','worstDefense','upset']
    .some(k => Number(r?.[k] || 0) > 0);
}


function renderMyBetsSection(key, title, icon, content, subtitle = '') {
  const open = MyBetsState.openSections?.[key] === true;
  return `
    <section class="mybets-section-accordion ${open ? 'active' : ''}" data-section-key="${key}" style="margin:16px 0;">
      <button type="button"
        class="mybets-section-accordion-header"
        onclick="window.toggleMyBetsSection('${key}')"
        aria-expanded="${open ? 'true' : 'false'}"
        style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:rgba(255,255,255,.035);color:inherit;cursor:pointer;text-align:left;">
        <span style="display:flex;align-items:center;gap:10px;min-width:0;">
          <span style="font-size:1.15rem;">${icon}</span>
          <span style="min-width:0;">
            <strong style="display:block;font-size:1rem;">${title}</strong>
            ${subtitle ? `<small style="display:block;opacity:.6;margin-top:2px;">${subtitle}</small>` : ''}
          </span>
        </span>
        <span class="mybets-section-accordion-arrow" style="font-size:1rem;opacity:.7;transition:transform .2s;transform:rotate(${open ? '180deg' : '0deg'});">▼</span>
      </button>
      <div class="mybets-section-accordion-content" style="display:${open ? 'block' : 'none'};padding-top:4px;">
        ${content}
      </div>
    </section>
  `;
}

function renderPodium() {
  if (!hasPodiumFeature()) return '';
  const p = MyBetsState.bets?.podium;
  if (!p || !Array.isArray(p) || p.length === 0) return '';

  const userName = getSelectedUserName();
  const titleLabel = userName === 'SEU' ? 'SEU PALPITE DE PODIO' : `PODIO: ${userName.toUpperCase()}`;

  const rows = [
    { idx: 0, label: 'CAMPEAO', badge: '1o', color: 'gold' },
    { idx: 1, label: 'VICE-CAMPEAO', badge: '2o', color: 'silver' },
    { idx: 2, label: '3o COLOCADO', badge: '3o', color: 'green' },
    { idx: 3, label: '4o COLOCADO', badge: '4o', color: 'purple' }
  ].filter(r => r.idx < getPodiumSize() && r.idx < p.length);

  return `
    <div class="modern-podium">
      <div class="modern-podium-header">
        <div><h2>🏆 ${titleLabel}</h2><p>Ranking dos favoritos</p></div>
        <div class="trophy-glow">🏆</div>
      </div>
      <div class="modern-podium-list">
        ${rows.map(r => {
          const teamName = p[r.idx] || '—';
          const mLogo = MyBetsState.matches.find(m => m.teamA === teamName || m.teamB === teamName);
          const logoUrl = mLogo ? (mLogo.teamA === teamName ? mLogo.logoA : mLogo.logoB) : null;

          return `
            <div class="modern-rank-card ${r.color}">
              <div class="rank-badge-modern">${r.badge}</div>
              <div class="team-visual"><div class="flag-wrapper-podium">${renderTeamMedia(teamName, logoUrl)}</div></div>
              <div class="rank-content">
                <span class="rank-label-modern">${r.label}</span>
                <span class="rank-team-modern">${teamName}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function loadOfficialGroupPredictionPoints() {
  const leagueId = localStorage.getItem('selectedLeagueId');
  const predictions = MyBetsState.bets?.groupPredictions;
  if (!leagueId || !Array.isArray(predictions) || !predictions.length) return;

  try {
    const response = await api.post(
      `/api/groups/prediction-points?leagueId=${encodeURIComponent(leagueId)}&live=false`,
      { groupPredictions: predictions }
    );
    const data = response?.data || response || {};

    MyBetsState.groupPredictionPoints.clear();
    (data.breakdown || []).forEach(item => {
      const group = String(item.group || '').trim();
      const team = String(item.team || '').trim();
      if (!group || !team) return;
      if (!MyBetsState.groupPredictionPoints.has(group)) {
        MyBetsState.groupPredictionPoints.set(group, new Map());
      }
      MyBetsState.groupPredictionPoints.get(group).set(team, item);
    });
  } catch (err) {
    console.warn('[MyBets] Não foi possível carregar pontuação oficial das classificações:', err);
  }
}

function renderGroupPredictions() {
  if (!hasGroupPhase()) return '';
  const predictions = MyBetsState.bets?.groupPredictions;
  if (!Array.isArray(predictions) || !predictions.length) return '';

  const cards = [...predictions]
    .sort((a,b) => String(a.group || '').localeCompare(String(b.group || ''), 'pt-BR', {numeric:true}))
    .map(pred => {
      const positions = Array.isArray(pred.positions) ? [...pred.positions]
        .sort((a,b) => Number(a.position || 0) - Number(b.position || 0)) : [];
      const additional = Array.isArray(pred.additionalQualifiedTeams)
        ? pred.additionalQualifiedTeams.filter(Boolean) : [];
      if (!positions.length && !additional.length) return '';

      const rows = positions.map(pos => {
        const team = pos.team || '—';
        const m = MyBetsState.matches.find(x => x.teamA === team || x.teamB === team);
        const logo = m ? (m.teamA === team ? m.logoA : m.logoB) : null;
        const item = MyBetsState.groupPredictionPoints.get(String(pred.group || ''))?.get(team);
        const pts = Number(item?.points || 0);
        const hasOfficialResult = item?.actualPosition != null;
        const pointsHtml = hasOfficialResult
          ? `<span class="mybets-group-prediction-points" style="margin-left:auto;min-width:48px;text-align:right;font-size:.72rem;font-weight:900;color:${pts > 0 ? '#6ee7b7' : '#f87171'};">${pts > 0 ? `✓ +${pts}` : '✗ 0'}</span>`
          : `<span class="mybets-group-prediction-points" style="margin-left:auto;min-width:48px;text-align:right;font-size:.72rem;font-weight:900;color:#999;">—</span>`;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);">
           <span style="min-width:28px;font-weight:800;opacity:.7;">${Number(pos.position) || '—'}º</span>
           <span>${renderTeamMedia(team, logo)}</span><span style="font-weight:700;">${team}</span>${pointsHtml}
         </div>`;
      }).join('');

      const extra = additional.length ? `<div style="margin-top:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,.03);">
        <div style="font-size:.75rem;font-weight:800;opacity:.65;margin-bottom:7px;">CLASSIFICADOS ADICIONAIS</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">${additional.map(team => {
          const m = MyBetsState.matches.find(x => x.teamA === team || x.teamB === team);
          const logo = m ? (m.teamA === team ? m.logoA : m.logoB) : null;
          return `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border-radius:8px;background:rgba(255,255,255,.04);">${renderTeamMedia(team, logo)}<span>${team}</span></span>`;
        }).join('')}</div>
      </div>` : '';

      return `<div class="modern-podium" style="margin-bottom:0;">
        <div class="modern-podium-header"><div><h2>📊 GRUPO ${pred.group || '—'}</h2><p>Classificação do seu palpite</p></div><div class="trophy-glow">📊</div></div>
        <div style="padding:4px 0;">${rows}${extra}<div class="mybets-group-prediction-total" style="margin-top:9px;text-align:right;font-size:.78rem;font-weight:900;color:#67e8f9;">Pontuação oficial: ${[...((MyBetsState.groupPredictionPoints.get(String(pred.group || '')) || new Map()).values())].reduce((sum,item)=>sum+Number(item.points||0),0)} pts</div></div>
      </div>`;
    }).join('');

  return cards.trim() ? `<div id="mybets-group-predictions-inner">
    <div style="margin-bottom:14px;"><p style="margin:5px 0 0;opacity:.6;font-size:.85rem;">Tabelas previstas no seu palpite</p></div>
    <div class="mybets-group-predictions-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start;">${cards}</div>
  </div>` : '';
}

function renderExtras() {
  if (!hasExtrasFeature()) return '';
  const extras = MyBetsState.bets?.extras || {};
  const bd = MyBetsState.bets?.extrasBreakdown || {
    topScorer: 0,
    bestAttack: 0,
    worstDefense: 0,
    upset: 0
  };
  const totalExtrasPts = Number(MyBetsState.bets?.extrasPoints || 0);

  const hasAnyExtra = extras.topScorer || extras.bestAttack || extras.worstDefense || extras.upset;
  if (!hasAnyExtra) return '';

  function renderExtraTeam(teamName) {
    if (!teamName) return '';
    const match = MyBetsState.matches.find(m => m.teamA === teamName || m.teamB === teamName);
    const logoUrl = match ? (match.teamA === teamName ? match.logoA : match.logoB) : null;
    return `<div class="mybets-extra-team" title="${teamName.replace(/"/g, '&quot;')}">${renderTeamMedia(teamName, logoUrl)}<span>${teamName}</span></div>`;
  }

  function renderPoints(points) {
    const pts = Number(points || 0);
    return `<span class="mybets-extra-points ${pts > 0 ? 'is-positive' : 'is-zero'}">${pts > 0 ? `+${pts}` : '0'} pts</span>`;
  }

  function renderExtraCard(icon, label, value, points) {
    return `
      <div class="mybets-extra-card">
        <div class="mybets-extra-icon" aria-hidden="true">${icon}</div>
        <div class="mybets-extra-info">
          <div class="mybets-extra-label">${label}</div>
          <div class="mybets-extra-value">${value}</div>
        </div>
        ${renderPoints(points)}
      </div>
    `;
  }

  const rows = [];
  if (extras.topScorer) rows.push(renderExtraCard('⚽', 'ARTILHEIRO', `<span>${extras.topScorer}</span>`, bd.topScorer));
  if (extras.bestAttack) rows.push(renderExtraCard('🚀', 'MELHOR ATAQUE', renderExtraTeam(extras.bestAttack), bd.bestAttack));
  if (extras.worstDefense) rows.push(renderExtraCard('🛡️', 'PIOR DEFESA', renderExtraTeam(extras.worstDefense), bd.worstDefense));
  if (extras.upset) rows.push(renderExtraCard('🦓', 'ZEBRA', renderExtraTeam(extras.upset), bd.upset));

  return `
    <div class="modern-extras" style="margin:8px 0;">
      <div class="mybets-extras-grid">
        ${rows.join('')}
      </div>
      <div class="mybets-extras-total">
        <span>🏆 TOTAL EXTRAS</span>
        <strong>+${totalExtrasPts} pts</strong>
      </div>
    </div>
  `;
}

function renderPills(matchMap) {
  const raw = MyBetsState.bets?.groupMatches || MyBetsState.bets?.matches || [];
  const groupCount = raw.filter(b => isGroupPhase(getBetPhase(b, matchMap))).length;
  const knockoutCount = raw.filter(b => isKnockoutPhase(getBetPhase(b, matchMap))).length;

  const group = hasGroupPhase() && groupCount > 0;
  const knockout = hasKnockoutPhase() && knockoutCount > 0;

  // Points-running championships have a single match list, never a
  // "Grupos" tab and never a "Mata-mata" tab.
  if (isPointsRunChampionship()) return '';

  if (!group && !knockout) return '';

  if (!group && knockout) MyBetsState.activeTab = 'knockout';
  if (group && !knockout) MyBetsState.activeTab = 'group';
  if (MyBetsState.activeTab === 'group' && !group) MyBetsState.activeTab = 'knockout';
  if (MyBetsState.activeTab === 'knockout' && !knockout) MyBetsState.activeTab = 'group';

  const isKnockout = MyBetsState.activeTab === 'knockout';
  const buttons = [];
  if (group) buttons.push(`<button class="modern-tab ${!isKnockout ? 'active' : ''}" onclick="window.switchMyBetsTab('group')">👥 Grupos</button>`);
  if (knockout) buttons.push(`<button class="modern-tab ${isKnockout ? 'active' : ''}" onclick="window.switchMyBetsTab('knockout')">⚔ Mata-mata</button>`);

  return `
    <div class="modern-tabs">
      ${group && knockout ? `<div class="modern-tab-slider ${isKnockout ? 'right' : ''}"></div>` : ''}
      ${buttons.join('')}
    </div>
  `;
}

function renderAccordion(key, title, items) {
  const open = MyBetsState.openAccordions[key];
  let finished = 0;
  let points = 0;

  items.forEach(b => {
    if (b.status !== 'finished') return;
    finished++;
    if (b.isLocked || b.winner === '🔒' || b.qualifier === '🔒') return;

    const matchData = MyBetsState.matches.find(m => Number(m.matchId) === Number(b.matchId));
    points += calculateMatchPoints(b, matchData).points;
  });

  const progress = items.length ? Math.round((finished / items.length) * 100) : 0;

  return `
    <div class="accordion-item ${open ? 'active' : ''}">
      <div class="accordion-header" onclick="window.toggleMyBetsAccordion('${key}')">
        <span>${title}</span>
        <span class="accordion-pts">+${points} pts</span>
      </div>
      <div class="phase-progress">
        <div class="progress-bar"><div class="progress-fill games" style="width:${progress}%"></div></div>
        <div class="progress-text">${finished} / ${items.length} jogos</div>
      </div>
      <div class="accordion-content" style="display:${open ? 'block' : 'none'};">
        ${items.map(renderMatch).join('')}
      </div>
    </div>
  `;
}

/* =====================
    WINDOW EXPOSURE
===================== */
window.toggleMyBetsSection = key => {
  MyBetsState.openSections ||= {};
  MyBetsState.openSections[key] = !MyBetsState.openSections[key];

  const section = document.querySelector(`.mybets-section-accordion[data-section-key="${key}"]`);
  if (!section) {
    renderMyBets();
    return;
  }

  const content = section.querySelector('.mybets-section-accordion-content');
  const arrow = section.querySelector('.mybets-section-accordion-arrow');
  const header = section.querySelector('.mybets-section-accordion-header');
  const open = MyBetsState.openSections[key];

  section.classList.toggle('active', open);
  if (content) content.style.display = open ? 'block' : 'none';
  if (arrow) arrow.style.transform = `rotate(${open ? '180deg' : '0deg'})`;
  if (header) header.setAttribute('aria-expanded', open ? 'true' : 'false');
};

window.switchMyBetsTab = tab => {
  MyBetsState.activeTab = tab;
  MyBetsState.openAccordions = {};
  renderMyBetsListOnly();
};

window.toggleMyBetsAccordion = key => {
  MyBetsState.openAccordions[key] = !MyBetsState.openAccordions[key];
  const header = event.currentTarget;
  const accordionItem = header.closest('.accordion-item');
  const content = accordionItem.querySelector('.accordion-content');

  if (MyBetsState.openAccordions[key]) {
    accordionItem.classList.add('active');
    content.style.display = 'block';
  } else {
    accordionItem.classList.remove('active');
    content.style.display = 'none';
  }
};

window.handleMyBetsUserChange = async userId => {
  MyBetsState.selectedUserId = userId;
  await loadSelectedUserBets();
};

/* =====================
    CORE LOGIC
===================== */
async function loadSelectedUserBets() {
  const container = document.getElementById('mybets-content-root');
  if (container) {
    container.innerHTML = `<div class="loading" style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin"></i> Carregando palpites...</div>`;
  }

  const leagueId = localStorage.getItem('selectedLeagueId');
  const userId = MyBetsState.selectedUserId;
  const isMe = userId === 'me';

  try {
    let res;

    if (isMe) {
      res = await api.get(`/api/bets/my-bets?leagueId=${leagueId}`);
    } else {
      const allRes = await api.get(`/api/bets/all-bets?leagueId=${leagueId}`);
      
      const targetName = getUserNameFromCache(userId);
      const userBets = allRes?.data?.find(u => u.userName === targetName);

      if (userBets) {
        res = {
          data: {
            groupMatches: userBets.bets || [],
            groupPredictions: userBets.groupPredictions || [],
            podium: userBets.podium || [],
            extras: userBets.extras || {},
            extrasBreakdown: userBets.extrasBreakdown || {
              topScorer: 0,
              bestAttack: 0,
              worstDefense: 0,
              upset: 0
            },
            extrasPoints: Number(userBets.extrasPoints || 0),
            totalPoints: Number(userBets.totalPoints || 0)
          }
        };
      } else {
        res = { data: null };
      }
    }

    MyBetsState.isLockedView = false;
    MyBetsState.bets = res?.data || null;

    // IMPORTANTE: a pontuação da classificação prevista é complementar.
    // Nunca bloquear a abertura de "Meus Palpites" aguardando esse cálculo.
    renderMyBets();

    // Atualiza a pontuação oficial em segundo plano.
    // Mesmo que o endpoint demore/falhe, a tela de My Bets já foi renderizada.
    void loadOfficialGroupPredictionPoints()
      .then(() => renderMyBets())
      .catch(err => console.warn('[MyBets] Atualização de pontos da classificação falhou:', err));

  } catch (err) {
    if (err.status === 403) {
      MyBetsState.isLockedView = true;
      MyBetsState.bets = null;
      renderMyBets();
    } else {
      console.error("Erro ao carregar palpites do usuario:", err);
      toast('Erro ao carregar palpites', 'error');
      if (container) container.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;">Erro na comunicacao com o servidor.</div>`;
    }
  }
}

export function renderMyBets() {
  const container = document.getElementById('user-bets-container');
  if (!container) return;

  if (!document.getElementById('mybets-header-root')) {
    container.innerHTML = `<div id="mybets-header-root"></div><div id="mybets-content-root"></div>`;
  }

  document.getElementById('mybets-header-root').innerHTML = renderUserDropdown();
  const contentRoot = document.getElementById('mybets-content-root');

  if (MyBetsState.isLockedView && MyBetsState.selectedUserId !== 'me') {
    contentRoot.innerHTML = renderLockedScreen();
    return;
  }

  const userMatches = MyBetsState.bets?.groupMatches || MyBetsState.bets?.matches || [];

  const hasSavedPodium = Array.isArray(MyBetsState.bets?.podium) && MyBetsState.bets.podium.length > 0;
  const hasSavedExtras = MyBetsState.bets?.extras && Object.values(MyBetsState.bets.extras).some(Boolean);
  const hasSavedGroupPredictions = Array.isArray(MyBetsState.bets?.groupPredictions) &&
    MyBetsState.bets.groupPredictions.some(p =>
      (Array.isArray(p.positions) && p.positions.length) ||
      (Array.isArray(p.additionalQualifiedTeams) && p.additionalQualifiedTeams.length)
    );

  if (!userMatches.length && !hasSavedPodium && !hasSavedExtras && !hasSavedGroupPredictions) {
    contentRoot.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:15px;color:rgba(255,255,255,0.3);">
        <p>Nenhum palpite registrado.</p>
      </div>
    `;
    return;
  }

  const podiumHtml = renderPodium();
  const extrasHtml = renderExtras();
  const groupsHtml = renderGroupPredictions();

  // Mantém Pódio separado e transforma Extras, Classificação e Partidas
  // em seções independentes para reduzir a rolagem.
  contentRoot.innerHTML = `
    <div id="mybets-podium-root">${podiumHtml}</div>
    ${extrasHtml ? renderMyBetsSection('extras', 'EXTRAS', '🎯', extrasHtml, 'Palpites extras') : ''}
    ${groupsHtml ? renderMyBetsSection('groupPredictions', 'CLASSIFICAÇÃO DOS GRUPOS', '📊', groupsHtml, 'Tabelas previstas no seu palpite') : ''}
    ${userMatches.length ? renderMyBetsSection('matches', 'PARTIDAS', '⚽', `
      <div id="mybets-pills-root"></div>
      <div id="mybets-list-root"></div>
    `, 'Seus palpites de partidas') : ''}
  `;

  if (userMatches.length) {
    renderMyBetsListOnly();
  }
}

function renderMyBetsListOnly() {
  const listRoot = document.getElementById('mybets-list-root');
  const pillsRoot = document.getElementById('mybets-pills-root');

  if (!listRoot || !pillsRoot) return;

  // O mapa precisa existir antes de qualquer render/filtro que use getBetPhase().
  const matchMap = new Map(
    (MyBetsState.matches || []).map(m => [Number(m.matchId), m])
  );

  pillsRoot.innerHTML = renderPills(matchMap);

  if (!hasGroupPhase() && MyBetsState.activeTab === 'group') MyBetsState.activeTab = 'knockout';
  if (!hasKnockoutPhase() && MyBetsState.activeTab === 'knockout') MyBetsState.activeTab = 'group';

  const rawBetsList = MyBetsState.bets?.groupMatches || MyBetsState.bets?.matches || [];
  const eligibleBets = rawBetsList.filter(b => {
    if (isPointsRunChampionship()) return isPointsRunPhase(getBetPhase(b, matchMap));
    if (isGroupPhase(getBetPhase(b, matchMap))) return hasGroupPhase();
    return hasKnockoutPhase() && isKnockoutPhase(getBetPhase(b, matchMap));
  });

  const groupBets = eligibleBets.filter(b => isGroupPhase(getBetPhase(b, matchMap)));
  const pointsRunBets = eligibleBets.filter(b => isPointsRunPhase(getBetPhase(b, matchMap)));
  const knockoutBets = eligibleBets.filter(b => isKnockoutPhase(getBetPhase(b, matchMap)));

  // In points-running mode there is one list, not the group/knockout tab model.
  if (isPointsRunChampionship()) {
    MyBetsState.activeTab = 'points_run';
  } else {
    if (MyBetsState.activeTab === 'group' && !groupBets.length && knockoutBets.length) {
      MyBetsState.activeTab = 'knockout';
    } else if (MyBetsState.activeTab === 'knockout' && !knockoutBets.length && groupBets.length) {
      MyBetsState.activeTab = 'group';
    }
  }

  const pointsRunVisibleBets = isPointsRunChampionship()
    ? pointsRunBets
    : (MyBetsState.activeTab === 'knockout' ? knockoutBets : groupBets);

  if (MyBetsState.activeTab === 'group' && !groupBets.length && knockoutBets.length) {
    MyBetsState.activeTab = 'knockout';
  } else if (MyBetsState.activeTab === 'knockout' && !knockoutBets.length && groupBets.length) {
    MyBetsState.activeTab = 'group';
  }

  const visibleBets = MyBetsState.activeTab === 'knockout' ? knockoutBets : groupBets;

  const enriched = visibleBets.map(b => {
    const m = matchMap.get(Number(b.matchId)) || {};
    
    const betScoreA = b.scoreA ?? b.betScoreA;
    const betScoreB = b.scoreB ?? b.betScoreB;

    return {
      ...b,
      // Compatibiliza /all-bets que usa choice em vez de winner
      winner: b.winner ?? b.choice ?? null,
      teamA: m.teamA || b.teamA || 'Time A',
      teamB: m.teamB || b.teamB || 'Time B',
      group: m.group || b.group || 'Mata-mata',
      phase: m.phase || b.phase || (isPointsRunChampionship() ? 'pontos_corridos' : 'group'),
      status: m.status || b.status || 'scheduled',
      betScoreA,
      betScoreB,
      realScoreA: m.scoreA, 
      realScoreB: m.scoreB, 
      qualifiedSide: m.qualifiedSide,
      logoA: m.logoA,
      logoB: m.logoB
    };
  });

  const filtered = enriched.filter(b => {
    if (isPointsRunChampionship()) return isPointsRunPhase(getBetPhase(b, matchMap));
    return MyBetsState.activeTab === 'group'
      ? isGroupPhase(b.phase)
      : isKnockoutPhase(b.phase);
  });

  filtered.sort((a, b) => a.matchId - b.matchId);

  const groups = {};
  filtered.forEach(b => {
    (groups[b.group] ||= []).push(b);
  });

  let html = '';

  if (isPointsRunChampionship()) {
    Object.keys(groups).sort().forEach(g => {
      html += renderAccordion(g, g, groups[g]);
    });
  } else if (MyBetsState.activeTab === 'group') {
    Object.keys(groups).sort().forEach(g => {
      html += renderAccordion(g, g, groups[g]);
    });
  } else {
    KNOCKOUT_ORDER.forEach(stage => {
      if (groups[stage]) {
        html += renderAccordion(stage, stage, groups[stage]);
      }
    });
  }

  listRoot.innerHTML = html;
}

export async function initMyBets() {
  const container = document.getElementById('user-bets-container');
  const leagueId = localStorage.getItem('selectedLeagueId');

  if (!leagueId) {
    if (container) container.innerHTML = '<div class="loading">Selecione um campeonato.</div>';
    return;
  }

  if (container) container.innerHTML = `<div class="loading">Carregando...</div>`;

  MyBetsState.openAccordions = {};
  MyBetsState.selectedUserId = 'me';

  /*
   * IMPORTANTE:
   * A abertura de "Meus Palpites" depende somente dos palpites do usuário.
   * Settings, partidas e ranking são dados auxiliares e NÃO podem bloquear
   * a tela inteira. Isso evita spinner infinito quando qualquer endpoint
   * secundário estiver lento/indisponível.
   */
  try {
    await loadSelectedUserBets();
  } catch (err) {
    console.error('[MyBets] Erro fatal ao carregar palpites:', err);
    if (container) {
      container.innerHTML =
        `<div style="text-align:center;padding:20px;color:#ef4444;">
          Erro na comunicação com o servidor.
        </div>`;
    }
    return;
  }

  // Dados auxiliares carregados em segundo plano.
  void Promise.allSettled([
    (async () => {
      try {
        const settingsRes = await api.get(`/api/settings/global?leagueId=${encodeURIComponent(leagueId)}`);
        if (settingsRes?.success && settingsRes.data) {
          MyBetsState.scoringRules = settingsRes.data.scoringRules || null;
          MyBetsState.championshipRules = settingsRes.data.championshipRules || null;
          renderMyBets();
        }
      } catch (err) {
        console.warn('[MyBets] Não foi possível carregar as regras:', err);
      }
    })(),

    (async () => {
      try {
        const m = await api.get(`/api/matches?leagueId=${encodeURIComponent(leagueId)}`);
        MyBetsState.matches = Array.isArray(m?.data) ? m.data : [];
        renderMyBets();
      } catch (err) {
        console.warn('[MyBets] Não foi possível carregar as partidas auxiliares:', err);
      }
    })(),

    (async () => {
      if (window.__OFFICIAL_RANKING_CACHE__ || window.__RANKING_CACHE__) return;
      try {
        const rankRes = await api.get(`/api/bets/leaderboard?type=official&leagueId=${encodeURIComponent(leagueId)}`);
        window.__OFFICIAL_RANKING_CACHE__ = rankRes?.data || [];
      } catch (err) {
        console.warn('[MyBets] Não foi possível carregar usuários do ranking:', err);
      }
    })()
  ]);
}


export async function reloadMyBets() {
  await initMyBets();
}


<style id="mybets-group-predictions-responsive">
  @media (max-width: 700px) {
    #mybets-group-predictions-inner .mybets-group-predictions-grid {
      grid-template-columns: 1fr !important;
    }
  }
</style>


<style id="mybets-extras-v50">
  .mybets-extras-grid {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:10px;
    margin-top:8px;
  }
  .mybets-extra-card {
    min-width:0;
    min-height:88px;
    box-sizing:border-box;
    display:flex;
    align-items:center;
    gap:9px;
    padding:11px 10px;
    border:1px solid rgba(96,165,250,.20);
    border-radius:14px;
    background:linear-gradient(145deg,rgba(18,36,78,.72),rgba(8,20,48,.82));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 5px 16px rgba(0,0,0,.10);
  }
  .mybets-extra-icon {
    flex:0 0 34px;
    width:34px;
    height:34px;
    display:flex;
    align-items:center;
    justify-content:center;
    border-radius:11px;
    background:rgba(96,165,250,.11);
    border:1px solid rgba(96,165,250,.17);
    font-size:17px;
  }
  .mybets-extra-info {
    min-width:0;
    flex:1;
  }
  .mybets-extra-label {
    font-size:.67rem;
    font-weight:800;
    letter-spacing:.35px;
    color:rgba(226,232,240,.62);
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }
  .mybets-extra-value {
    margin-top:5px;
    min-width:0;
    font-size:.88rem;
    font-weight:700;
    color:#f1f5f9;
  }
  .mybets-extra-team {
    min-width:0;
    display:flex;
    align-items:center;
    gap:6px;
  }
  .mybets-extra-team > span:last-child {
    min-width:0;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  .mybets-extra-points {
    flex:0 0 auto;
    align-self:flex-end;
    font-size:.72rem;
    font-weight:900;
    white-space:nowrap;
  }
  .mybets-extra-points.is-positive { color:#4ade80; }
  .mybets-extra-points.is-zero { color:#f87171; }
  .mybets-extras-total {
    margin-top:10px;
    min-height:42px;
    box-sizing:border-box;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    padding:9px 12px;
    border:1px solid rgba(168,85,247,.18);
    border-radius:12px;
    background:rgba(168,85,247,.07);
    font-size:.82rem;
    font-weight:800;
    color:rgba(226,232,240,.78);
  }
  .mybets-extras-total strong {
    color:#4ade80;
    font-size:.92rem;
    white-space:nowrap;
  }
  @media (max-width:380px) {
    .mybets-extra-card { padding-left:8px; padding-right:7px; gap:7px; }
    .mybets-extra-icon { flex-basis:30px; width:30px; height:30px; font-size:15px; }
    .mybets-extra-label { font-size:.61rem; }
    .mybets-extra-value { font-size:.78rem; }
    .mybets-extra-points { font-size:.66rem; }
  }
</style>
