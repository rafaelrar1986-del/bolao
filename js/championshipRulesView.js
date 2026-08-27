/* ============================================================
   CHAMPIONSHIP RULES VIEW
   Fonte única de apresentação das regras configuradas pelo ADM.
   Não contém regras de cálculo; apenas traduz a configuração
   atual do campeonato para uma apresentação consistente.
============================================================ */

const MATCH_CONDITION_LABELS = {
  exactScore: 'Placar exato',
  result: 'Resultado (vencedor/empate)',
  scoreTeamA: 'Gols do Time A',
  scoreTeamB: 'Gols do Time B',
  scoreWinner: 'Gols do vencedor',
  scoreLoser: 'Gols do perdedor',
  totalGoals: 'Total de gols',
  goalDifference: 'Diferença de gols',
  qualifier: 'Classificado'
};

const GROUP_CONDITION_LABELS = {
  positionCorrect: 'Posição correta',
  positionIncorrect: 'Posição incorreta',
  teamQualified: 'Time classificado',
  teamNotQualified: 'Time não classificado'
};

const CONDITION_ICONS = {
  exactScore: '🎯',
  result: '🏆',
  scoreTeamA: '⚽',
  scoreTeamB: '⚽',
  scoreWinner: '⚽',
  scoreLoser: '⚽',
  totalGoals: '⚽',
  goalDifference: '📊',
  qualifier: '➡️'
};

const EXTRA_LABELS = {
  topScorer: ['Artilheiro', '🥇'],
  bestAttack: ['Melhor Ataque', '🔥'],
  worstDefense: ['Pior Defesa', '🛡️'],
  upset: ['Zebra', '✨']
};

function unique(values) {
  return [...new Set(Array.isArray(values) ? values : [])];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeRules(data = {}) {
  return {
    scoringRules: data.scoringRules || {},
    championshipRules: data.championshipRules || {},
    prizeZone: data.prizeZone || {}
  };
}

function getConditionLabel(condition, labels) {
  if (!condition) return '';
  if (typeof condition === 'string') return labels[condition] || condition;

  if (typeof condition === 'object') {
    const key = condition.key || condition.type || condition.name || condition.condition;
    return labels[key] || condition.label || key || '';
  }

  return '';
}

function describeConditions(conditions, labels) {
  return unique(conditions)
    .map(condition => getConditionLabel(condition, labels))
    .filter(Boolean)
    .join(' + ');
}

function getRuleConditions(rule) {
  return Array.isArray(rule?.conditions)
    ? rule.conditions
    : [];
}

function validRule(rule) {
  return Number(rule?.points) > 0 && getRuleConditions(rule).length > 0;
}

function renderRuleItems(rules, labels, category, defaultIcon = '📌') {
  if (!Array.isArray(rules)) return '';

  return rules
    .filter(validRule)
    .map(rule => {
      const conditions = getRuleConditions(rule);
      const label = describeConditions(conditions, labels);
      if (!label) return '';

      let icon = defaultIcon;

      const first = conditions[0];
      const key = typeof first === 'string'
        ? first
        : first?.key || first?.type || first?.condition;

      if (conditions.length === 1) {
        icon = CONDITION_ICONS[key] || defaultIcon;
      } else if (category === 'match') {
        icon = '🎯';
      }

      return `
        <div class="profile-rule-item profile-rule-${escapeHtml(category)}">
          <span class="profile-rule-icon" aria-hidden="true">${icon}</span>
          <span class="rule-label">${escapeHtml(label)}</span>
          <span class="profile-rule-points">${Number(rule.points)}<small>pts</small></span>
        </div>
      `;
    })
    .filter(Boolean)
    .join('');
}

function renderExtras(scoringRules) {
  return Object.entries(EXTRA_LABELS)
    .map(([key, [label, icon]]) => {
      const points = Number(scoringRules?.[key]);
      if (!(points > 0)) return '';

      return `
        <div class="profile-rule-item profile-rule-extra">
          <span class="profile-rule-icon" aria-hidden="true">${icon}</span>
          <span class="rule-label">${escapeHtml(label)}</span>
          <span class="profile-rule-points">${points}<small>pts</small></span>
        </div>
      `;
    })
    .filter(Boolean)
    .join('');
}

function renderPodium(scoringRules, championshipRules = {}) {
  const podium = Array.isArray(scoringRules?.podiumPoints)
    ? scoringRules.podiumPoints
    : [];

  const configuredSize = Number(championshipRules?.podiumSize);
  const podiumSize = configuredSize > 0
    ? Math.min(configuredSize, podium.length)
    : podium.length;

  const icons = ['🥇', '🥈', '🥉'];

  return podium
    .slice(0, podiumSize)
    .map((points, index) => {
      const value = Number(points);
      if (!(value > 0)) return '';

      return `
        <div class="profile-rule-item profile-rule-podium">
          <span class="profile-rule-icon" aria-hidden="true">${icons[index] || '🏅'}</span>
          <span class="rule-label">Pódio — ${index + 1}º lugar</span>
          <span class="profile-rule-points">${value}<small>pts</small></span>
        </div>
      `;
    })
    .filter(Boolean)
    .join('');
}

function hasGroupPhase(championshipRules) {
  const group = championshipRules?.groupQualification || {};

  return championshipRules?.hasGroupPhase === true ||
    (
      Number(group.totalTeams) > 0 &&
      Number(group.groupCount) > 0 &&
      Number(group.totalQualified) > 0
    );
}

function hasKnockoutPhase(championshipRules) {
  return championshipRules?.hasKnockoutPhase === true;
}

function getPhaseDescription(championshipRules) {
  const group = hasGroupPhase(championshipRules);
  const knockout = hasKnockoutPhase(championshipRules);

  if (!group && !knockout) {
    return 'Pontos corridos';
  }

  if (group && knockout) {
    return 'Fase de grupos + mata-mata';
  }

  if (group) {
    return 'Fase de grupos';
  }

  return 'Mata-mata';
}

function getLockLabel(data) {
  const raw = String(
    data?.betLockMode ??
    data?.championshipRules?.betLockMode ??
    ''
  ).toLowerCase();

  if (['match', 'partida'].includes(raw)) return 'Por partida';
  if (['grid', 'grade'].includes(raw)) return 'Por grade';
  return '';
}

function getLockExplanation(label) {
  if (label === 'Por partida') {
    return 'A partida é bloqueada no início da partida.';
  }

  if (label === 'Por grade') {
    return 'A fase/rodada é bloqueada no início do primeiro jogo da rodada.';
  }

  return '';
}

function renderPhaseInfo(data) {
  const { championshipRules } = normalizeRules(data);
  const phase = getPhaseDescription(championshipRules);

  const parts = [`<p><strong>FORMATO:</strong> ${escapeHtml(phase)}.</p>`];

  if (championshipRules.drawIncludesExtraTime === true) {
    parts.push('<p><strong>EMPATE:</strong> a aposta considera o resultado com prorrogação.</p>');
  } else {
    parts.push('<p><strong>EMPATE:</strong> a aposta considera o resultado dos 90 minutos.</p>');
  }

  return parts.join('');
}

function renderGroup(title, icon, html, category) {
  if (!html) return '';

  return `
    <section class="profile-rules-group profile-rules-group-${category}">
      <div class="profile-rules-group-title">
        <span class="profile-rules-group-icon">${icon}</span>
        <span>${escapeHtml(title)}</span>
      </div>
      <div class="rules-grid">${html}</div>
    </section>
  `;
}

export function buildChampionshipRulesContent(data = {}, options = {}) {
  const normalized = normalizeRules(data);
  const { scoringRules, championshipRules } = normalized;

  const matchHtml = renderRuleItems(
    scoringRules.matchRules,
    MATCH_CONDITION_LABELS,
    'match',
    '⚽'
  );

  const groupHtml = hasGroupPhase(championshipRules)
    ? renderRuleItems(
        scoringRules.groupQualificationRules,
        GROUP_CONDITION_LABELS,
        'qualification',
        '🏅'
      )
    : '';

  const extrasHtml = renderExtras(scoringRules);
  const podiumHtml = renderPodium(scoringRules, championshipRules);

  const groups = [
    renderGroup('Pontuação das partidas', '⚽', matchHtml, 'match'),
    renderGroup('Classificação da fase de grupos', '🏅', groupHtml, 'qualification'),
    renderGroup('Extras', '✨', extrasHtml, 'extra'),
    renderGroup('Pódio', '🏆', podiumHtml, 'podium')
  ].filter(Boolean);

  const empty = groups.length === 0
    ? `<div class="profile-rules-empty">Nenhuma regra de pontuação ativa.</div>`
    : '';

  const lockLabel = getLockLabel(normalized);
  const lockExplanation = getLockExplanation(lockLabel);

  const help = options.includeHelp !== false
    ? `
      <div class="profile-rules-help-panel" hidden>
        <div class="profile-rules-help-title">
          <strong>📋 Como funcionam as regras?</strong>
          <button type="button" class="profile-rules-help-close" aria-label="Fechar">×</button>
        </div>
        <p>
          Cada regra concede os pontos indicados quando todas as condições
          exibidas nessa regra forem atendidas.
        </p>
        ${
          lockExplanation
            ? `<p><strong>🔒 ${escapeHtml(lockLabel)}:</strong> ${escapeHtml(lockExplanation)}</p>`
            : ''
        }
      </div>
    `
    : '';

  return {
    phaseInfo: renderPhaseInfo(normalized),
    groupsHtml: groups.join(''),
    emptyHtml: empty,
    lockLabel,
    lockExplanation,
    helpHtml: help,
    html: `${renderPhaseInfo(normalized)}${groups.join('')}${empty}`
  };
}

export function renderChampionshipRulesCard(container, data = {}, options = {}) {
  if (!container) return null;

  const result = buildChampionshipRulesContent(data, options);

  container.innerHTML = `
    <details class="profile-card rules-card profile-rules-card">
      <summary class="profile-rules-collapsed">
        <span class="profile-rules-collapsed-left">
          <span class="profile-rules-collapsed-title">
            <span class="profile-rules-title-icon">📋</span>
            <span>Regras de Pontuação</span>
          </span>
          <span class="profile-rules-badges">
            ${
              result.lockLabel
                ? `<span class="profile-rules-badge profile-rules-badge-lock">🔒 ${escapeHtml(result.lockLabel)}</span>`
                : ''
            }
          </span>
        </span>
        <span class="profile-rules-collapsed-actions">
          <button type="button" class="profile-rules-help" aria-label="Explicação das regras" title="Como funciona?">?</button>
          <span class="profile-rules-toggle" aria-hidden="true">⌄</span>
        </span>
      </summary>

      <div class="profile-rules-expanded">
        ${result.helpHtml}
        <div class="profile-rules-expanded-top"></div>
        <div class="profile-rules-divider"></div>
        ${result.groupsHtml || result.emptyHtml}
      </div>
    </details>
  `;

  const card = container.querySelector('.profile-rules-card');
  const helpButton = card?.querySelector('.profile-rules-help');
  const helpPanel = card?.querySelector('.profile-rules-help-panel');
  const helpClose = card?.querySelector('.profile-rules-help-close');

  const closeHelp = () => {
    if (helpPanel) helpPanel.hidden = true;
  };

  helpButton?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (helpPanel) helpPanel.hidden = !helpPanel.hidden;
  });

  helpClose?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    closeHelp();
  });

  return result;
}

export {
  escapeHtml,
  normalizeRules,
  describeConditions,
  getPhaseDescription,
  renderPhaseInfo
};
