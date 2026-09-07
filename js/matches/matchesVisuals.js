/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesVisuals(ctx = {}) {
  const get = (name) => ctx[name];

  function generateShotmapDots(sequence) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    let html = '';
    const totalDots = Math.max(5, sequence.length);

    for (let i = 0; i < totalDots; i++) {
      let backgroundColor = '#d2d7d9'; 
      let shadow = 'none';

      if (i < sequence.length) {
        if (sequence[i] === true) {
          backgroundColor = '#2ecc71'; 
          shadow = '0 0 6px rgba(46, 204, 113, 0.6)';
        } else {
          backgroundColor = '#e74c3c'; 
          shadow = '0 0 6px rgba(231, 76, 60, 0.6)';
        }
      }

      html += `
        <span class="shot-dot" style="
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background-color: ${backgroundColor};
          box-shadow: ${shadow};
          border: 1px solid rgba(0, 0, 0, 0.15);
          transition: all 0.3s ease;
        "></span>
      `;
    }
    return html;
  }

  return {
    generateShotmapDots,
  };
}
