'use strict';

/**
 * Verifica se a temporada atual de uma competição da API ainda é válida.
 * A API pode manter is_active/is_current como true mesmo após o fim da
 * temporada; por isso a data final é a regra determinante.
 */
function isAvailableLeagueSeason(league, referenceDate = new Date()) {
    const season = league?.current_season;
    if (!season?.end_date) return false;

    const endDateText = String(season.end_date).slice(0, 10);
    const endDate = new Date(`${endDateText}T23:59:59.999Z`);
    if (Number.isNaN(endDate.getTime())) return false;

    const todayUtc = new Date(referenceDate);
    if (Number.isNaN(todayUtc.getTime())) return false;
    todayUtc.setUTCHours(0, 0, 0, 0);

    return endDate >= todayUtc;
}

module.exports = { isAvailableLeagueSeason };
