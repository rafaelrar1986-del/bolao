/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesPodiumExtras(ctx = {}) {
  const get = (name) => ctx[name];

  function togglePodiumVisibility() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasPodium } = ctx;
    const podiumSection = document.querySelector('.podium-section');
    if (podiumSection) {
      podiumSection.style.display = hasPodium() ? '' : 'none';
    }
  }

  function updatePodiumPointsDisplay() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules, getPodiumSize } = ctx;
    const rules = getScoringRules();
    const pts = Array.isArray(rules.podiumPoints) ? rules.podiumPoints : [0, 0, 0, 0];
    const size = getPodiumSize();

    // Mapeamento dinâmico baseado no tamanho do pódio
    const positionMap = [
      { selector: '.position-1 .podium-points', index: 0 },
      { selector: '.position-2 .podium-points', index: 1 },
      { selector: '.position-3 .podium-points', index: 2 },
      { selector: '.podium-consolation .podium-points', index: 3 }
    ];

    positionMap.forEach(({ selector, index }) => {
      const el = document.querySelector(selector);
      if (el) {
        // Só mostra pontos se a posição existir no tamanho configurado
        if (index < size) {
          const val = pts[index] || 0;
          el.textContent = val > 0 ? `(${val} pontos)` : '(0 pts)';
          el.style.display = '';
        } else {
          el.style.display = 'none';
        }
      }
    });
  }

  function fillPodiumSelects() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasPodium, getPodiumPositions, updateBetsCounters, togglePodiumVisibility, updatePodiumIndicator } = ctx;
    togglePodiumVisibility();
    if (!hasPodium()) return;

    const allMatches = STATE.matches || [];
    const teams = [...new Set(allMatches.flatMap(m => [m.teamA, m.teamB]))].sort();
    
    const positions = getPodiumPositions();

    positions.forEach(p => {
      const el = document.getElementById(`${p}-place`);
      if (!el) return;

      const parentContainer = el.parentElement; 
      const selectedTeam = STATE.podium ? STATE.podium[p] : null;

      const existingDisplays = parentContainer.querySelectorAll('.big-flag-display');
      existingDisplays.forEach(d => d.remove());

      if (STATE.hasSubmitted) {
        el.style.display = 'none';

        if (selectedTeam && selectedTeam.trim() !== "") {
          const teamNameClean = selectedTeam.trim();
          const matchFound = allMatches.find(m => 
            (m.teamA && m.teamA.trim() === teamNameClean) || 
            (m.teamB && m.teamB.trim() === teamNameClean)
          );
          
          let logoUrl = null;
          if (matchFound) {
            logoUrl = (matchFound.teamA.trim() === teamNameClean) ? matchFound.logoA : matchFound.logoB;
          }

          const mediaHtml = renderTeamMedia(selectedTeam, logoUrl);

          const flagHtml = `
            <div class="big-flag-display" style="display: flex; align-items: center; gap: 15px; margin-top: 10px;">
              <div class="flag-wrapper-podium">
                ${mediaHtml}
              </div>
              <span class="flag-team-name" style="font-weight: 700; font-size: 1.rem;">${selectedTeam}</span>
            </div>
          `;
          el.insertAdjacentHTML('afterend', flagHtml);
        } else {
          el.insertAdjacentHTML('afterend', '<div class="big-flag-display"><span class="flag-team-name">—</span></div>');
        }

        updatePodiumIndicator(p);
        return; 
      }

      el.style.display = 'block';
      el.disabled = false;
      el.innerHTML = '<option value="">Selecione...</option>' + 
        teams.map(t => `<option value="${t}">${withFlag(t)}</option>`).join('');

      el.value = selectedTeam || '';

      el.onchange = () => {
        if(!STATE.podium) STATE.podium = {};
        STATE.podium[p] = el.value;
        updatePodiumIndicator(p);

        if (typeof updateBetsCounters === 'function') {
          updateBetsCounters();
        }
      };

      updatePodiumIndicator(p);
    });
  }

  function updatePodiumIndicator(p) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const indicator = document.getElementById(`${p}-indicator`);
    if (!indicator) return;

    const userBet = STATE.podium[p];
    const idxMap = { first: 0, second: 1, third: 2, fourth: 3 };
    const idx = idxMap[p];
    const officialResult = (STATE.officialPodium && Array.isArray(STATE.officialPodium) && idx !== undefined)
      ? STATE.officialPodium[idx]
      : null;

    if (userBet && officialResult) {
      const ok = userBet === officialResult;
      indicator.textContent = ok ? '✔️' : '❌';
      indicator.style.color = ok ? '#28a745' : '#dc3545';
    } else {
      indicator.textContent = ''; 
    }
  }

  function renderExtrasSection() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules } = ctx;
    const rules = getScoringRules();

    const allMatches = STATE.matches || [];

    // Mesma lista de times utilizada no Pódio
    const teams = [...new Set(
      allMatches.flatMap(m => [m.teamA, m.teamB])
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const extras = [
      {
        key: 'topScorer',
        id: 'extra-top-scorer',
        wrapId: 'extra-top-scorer-wrap',
        pointsId: 'extra-top-scorer-pts',
        label: 'Artilheiro',
        type: 'text'
      },
      {
        key: 'bestAttack',
        id: 'extra-best-attack',
        wrapId: 'extra-best-attack-wrap',
        pointsId: 'extra-best-attack-pts',
        label: 'Melhor Ataque',
        type: 'team'
      },
      {
        key: 'worstDefense',
        id: 'extra-worst-defense',
        wrapId: 'extra-worst-defense-wrap',
        pointsId: 'extra-worst-defense-pts',
        label: 'Pior Defesa',
        type: 'team'
      },
      {
        key: 'upset',
        id: 'extra-upset',
        wrapId: 'extra-upset-wrap',
        pointsId: 'extra-upset-pts',
        label: 'Zebra',
        type: 'team'
      }
    ];

    const enabledExtras = extras.filter(
      extra => Number(rules[extra.key]) > 0
    );

    // Remove seção anterior para evitar duplicação
    const oldSection = document.getElementById('extras-section');
    if (oldSection) oldSection.remove();

    // Nenhum Extra habilitado
    if (!enabledExtras.length) return;

    const section = document.createElement('section');
    section.id = 'extras-section';
    section.className = 'extras-section';

    section.innerHTML = `
      <div class="extras-header">
        <h2>🎯 EXTRAS</h2>
      </div>

      <div class="extras-list">

        ${enabledExtras.map(extra => {

          const inputHtml = extra.type === 'team'
            ? `
              <select
                id="${extra.id}"
                style="
                  width: 100%;
                  box-sizing: border-box;
                  padding: 10px 12px;
                  border-radius: 8px;
                  border: 1px solid rgba(255,255,255,0.2);
                  background: rgba(0,0,0,0.2);
                  color: #fff;
                  font-size: 0.95rem;
                "
              >
                <option value="">Selecione...</option>
                ${teams.map(team => `
                  <option value="${team}">
                    ${withFlag(team)}
                  </option>
                `).join('')}
              </select>
            `
            : `
              <input
                type="text"
                id="${extra.id}"
                placeholder="Digite o nome do jogador..."
                autocomplete="off"
                style="
                  width: 100%;
                  box-sizing: border-box;
                  padding: 10px 12px;
                  border-radius: 8px;
                  border: 1px solid rgba(255,255,255,0.2);
                  background: rgba(0,0,0,0.2);
                  color: #fff;
                  font-size: 0.95rem;
                "
              />
            `;

          return `
            <div
              class="extra-item"
              id="${extra.wrapId}"
              style="
                margin-bottom: 14px;
                padding: 14px;
                border-radius: 10px;
                background: rgba(255,255,255,0.05);
              "
            >

              <div
                class="extra-title"
                style="
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  gap: 10px;
                  margin-bottom: 8px;
                "
              >
                <span style="font-weight: 700;">
                  ${extra.label}
                </span>

                <span
                  id="${extra.pointsId}"
                  style="font-size: 0.85rem; opacity: 0.8;"
                >
                  (${Number(rules[extra.key])} pontos)
                </span>

                <span
                  id="extra-${extra.key}-indicator"
                  class="extra-indicator"
                ></span>
              </div>

              ${inputHtml}

            </div>
          `;
        }).join('')}

      </div>
    `;

    // EXTRAS fica imediatamente antes do PÓDIO
    const podiumSection = document.querySelector('.podium-section');

    if (podiumSection && podiumSection.parentNode) {
      podiumSection.parentNode.insertBefore(section, podiumSection);
    }
  }

  function updateExtrasPointsDisplay() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getScoringRules } = ctx;
    const rules = getScoringRules();
    const map = {
      'extra-top-scorer-pts':    rules.topScorer,
      'extra-best-attack-pts':   rules.bestAttack,
      'extra-worst-defense-pts': rules.worstDefense,
      'extra-upset-pts':         rules.upset
    };
    Object.entries(map).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = `(${val || 0} pontos)`;
    });
  }

  function updateExtrasIndicator(key) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const indicator = document.getElementById(`extra-${key}-indicator`);
    if (!indicator) return;

    const userBet = STATE.extras?.[key];
    const officialResult = STATE.officialExtras?.[key] || null;

    if (userBet && officialResult) {
      const ok = String(userBet).trim().toLowerCase() === String(officialResult).trim().toLowerCase();
      indicator.textContent = ok ? '✔️' : '❌';
      indicator.style.color = ok ? '#28a745' : '#dc3545';
    } else {
      indicator.textContent = '';
    }
  }

  function fillExtrasInputs() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, hasExtras, updateBetsCounters, updateExtrasIndicator } = ctx;
      if (!hasExtras()) return;

    const keys = [
      { key: 'topScorer',    id: 'extra-top-scorer',    label: 'Artilheiro' },
      { key: 'bestAttack',   id: 'extra-best-attack',   label: 'Melhor Ataque' },
      { key: 'worstDefense', id: 'extra-worst-defense', label: 'Pior Defesa' },
      { key: 'upset',        id: 'extra-upset',         label: 'Zebra' }
    ];

    keys.forEach(({ key, id, label }) => {
      const el = document.getElementById(id);
      if (!el) return;

      const val = STATE.extras?.[key] || '';

      if (STATE.hasSubmitted) {
        el.style.display = 'none';

        const existing = el.parentElement.querySelector('.extra-display');
        if (existing) existing.remove();

        if (val && String(val).trim() !== '') {
          const display = document.createElement('div');
          display.className = 'extra-display';
          display.innerHTML = `<span>${val}</span>`;
          el.insertAdjacentElement('afterend', display);
        } else {
          const display = document.createElement('div');
          display.className = 'extra-display';
          display.innerHTML = `<span style="color:rgba(255,255,255,0.4)">—</span>`;
          el.insertAdjacentElement('afterend', display);
        }

        updateExtrasIndicator(key);
        return;
      }

      // Remove display se existir (modo edição)
      const existing = el.parentElement.querySelector('.extra-display');
      if (existing) existing.remove();

      el.style.display = 'block';
      el.disabled = false;
      el.value = val;

      const saveExtraValue = () => {
          if (!STATE.extras) {
              STATE.extras = {
                  topScorer: '',
                  bestAttack: '',
                  worstDefense: '',
                  upset: ''
              };
          }

          STATE.extras[key] = el.value;

          // Extras fazem parte das pendências obrigatórias.
          // Atualiza imediatamente após cada alteração.
          if (typeof updateBetsCounters === 'function') {
              updateBetsCounters();
          }

          updateExtrasIndicator(key);
      };

  if (el.tagName === 'SELECT') {
    el.onchange = saveExtraValue;
  } else {
    el.oninput = saveExtraValue;
  }

      updateExtrasIndicator(key);
    });
  }

  return {
    togglePodiumVisibility,
    updatePodiumPointsDisplay,
    fillPodiumSelects,
    updatePodiumIndicator,
    renderExtrasSection,
    updateExtrasPointsDisplay,
    updateExtrasIndicator,
    fillExtrasInputs,
  };
}
