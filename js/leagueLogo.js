// Resolução única dos símbolos/logos das competições.
// A mesma função é usada pela LeagueSelection, app4 e painel Admin para
// impedir que cada tela tenha uma regra diferente para o logo.
export function getLeagueLogoUrl(leagueOrId) {
  const league = leagueOrId && typeof leagueOrId === 'object' ? leagueOrId : { id: leagueOrId };
  // Campeonatos manuais não possuem competição equivalente na API.
  // Nunca use o leagueId interno como se fosse apiLeagueId.
  if (String(league.source || '').toLowerCase() === 'manual') return '';

  const apiId = league.apiLeagueId ?? league.api_id ?? league.id ?? league.leagueId;
  const id = String(apiId ?? '').trim();

  if (!id) return '';

  // A World Cup 2026 usa o mesmo asset local já utilizado na seleção de ligas.
  if (id === '27') {
    return new URL('../img/27.jpg', import.meta.url).href;
  }

  return `https://sports.bzzoiro.com/img/league/${encodeURIComponent(id)}`;
}
