// Utilitários puros da tela de partidas.
// Este módulo NÃO conhece STATE, DOM, apostas ou regras de pontuação.
// A separação é intencional para permitir a refatoração gradual de matches4.js.

import { flagEmoji } from '../flags.js';

export function withFlag(name) {
  const f = flagEmoji(name);
  return f ? `${f} ${name}` : name;
}

export function flagOnly(name) {
  return flagEmoji(name) || '';
}

export function renderTeamMedia(teamName, logoUrl) {
  const bandeiraLocal = flagEmoji(teamName);

  if (logoUrl && logoUrl !== '') {
    return `
      <div class="logo-wrapper" style="display: inline-flex; vertical-align: middle; width: 22px; height: 22px; justify-content: center; align-items: center;">
        <img src="${logoUrl}"
             class="team-logo-api"
             style="display: block; width: 100%; height: 100%; object-fit: contain;"
             onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML='<span class=\\'team-emoji\\'>${bandeiraLocal || '🏳️'}</span>';">
      </div>
    `;
  }

  if (bandeiraLocal) {
    return `<span class="team-emoji" style="display: inline-block; vertical-align: middle;">${bandeiraLocal}</span>`;
  }

  return '';
}

export function isKnockoutMatch(m) {
  if (!m) return false;
  const phase = m.phase == null ? '' : String(m.phase).trim().toLowerCase();
  const stage = m.stage == null ? '' : String(m.stage).trim().toLowerCase();

  // Fase explícita tem prioridade. 'round 24' é uma rodada de grupo,
  // portanto não pode ativar a pontuação de classificado.
  if (phase === 'knockout' || phase === 'mata-mata' || phase.includes('knockout') || phase.includes('mata')) return true;
  if (phase === 'group' || phase === 'groups' || phase === 'grupo' || phase === 'grupos') return false;

  if (/quarter|quartas|semi|semifinal|final|playoff|knockout/.test(stage)) return true;
  if (/round\s*(of\s*)?(16|8|4|2)\b/.test(stage)) return true;

  return false;
}

export function statusLabel(status) {
  const s = String(status).toLowerCase().trim();

  const mapping = {
    scheduled: 'Agendado',
    agendado: 'Agendado',
    '1_tempo': '1°T',
    intervalo: 'Intervalo',
    '2_tempo': '2°T',
    prorrogacao: 'Prorrog.',
    '1_tet': '1°T ET',
    '2_tet': '2°T ET',
    penaltis: 'Pênaltis',
    finished: 'Encerrado',
    postponed: 'Adiado',
    cancelled: 'Cancelado',
    inprogress: 'Ao Vivo',
    in_progress: 'Ao Vivo'
  };

  return mapping[s] || status || '-';
}

export function resultWinnerFromScore(a, b) {
  if (a == null || b == null) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'draw';
}

export function parseMatchDate(match) {
  if (!match || !match.date) return null;
  if (match.date instanceof Date) return new Date(match.date.getTime());

  const dateStr = String(match.date).trim();
  const timeStr = match.time ? String(match.time).trim() : '00:00';
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return null;

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  let day;
  let month;
  let year;

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    [year, month, day] = dateStr.split('-').map(Number);
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    [day, month, year] = dateStr.split('/').map(Number);
  } else {
    return null;
  }

  const timestamp = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? null : d;
}

// O instante acima é sempre UTC, alinhado ao betLockService.
// A interface, porém, continua mostrando o horário local do navegador.
export function formatMatchTimeLocal(match) {
  const d = parseMatchDate(match);
  if (!d || isNaN(d.getTime())) return '--:--';

  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatMatchDateLocal(match) {
  const d = parseMatchDate(match);
  if (!d || isNaN(d.getTime())) return 'Data inválida';

  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}
