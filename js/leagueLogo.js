// Resolução única dos símbolos/logos das competições.
// A mesma função é usada pela LeagueSelection, app4 e painel Admin.
// Regra: quando houver apiLeagueId, ele sempre tem prioridade. O campo
// source não pode esconder um logo de uma liga que está vinculada à API.
export function getLeagueLogoUrl(leagueOrId) {
  const league = leagueOrId && typeof leagueOrId === 'object'
    ? leagueOrId
    : { id: leagueOrId };

  const rawApiId =
    league.apiLeagueId ??
    league.api_id ??
    league.apiLeague?.id ??
    null;

  const apiId = Number(rawApiId);
  const hasApiId = Number.isInteger(apiId) && apiId > 0;

  // Se a liga tem vínculo explícito com a API, use esse ID,
  // independentemente de source.
  if (hasApiId) {
    if (String(apiId) === '27') {
      return new URL('../img/27.jpg', import.meta.url).href;
    }
    return `https://sports.bzzoiro.com/img/league/${encodeURIComponent(String(apiId))}`;
  }

  // Compatibilidade com ligas legadas: antes do cadastro League existir,
  // o próprio leagueId era o ID da competição da API.
  const source = String(league.source || '').toLowerCase();
  if (source !== 'manual') {
    const legacyId = Number(league.id ?? league.leagueId);
    if (Number.isInteger(legacyId) && legacyId > 0) {
      if (String(legacyId) === '27') {
        return new URL('../img/27.jpg', import.meta.url).href;
      }
      return `https://sports.bzzoiro.com/img/league/${encodeURIComponent(String(legacyId))}`;
    }
  }

  // Liga manual sem vínculo com a API: não existe logo externo para buscar.
  return '';
}
