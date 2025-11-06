
import { apiGet } from './api.js';
import { qs } from './ui.js';

export async function loadRankingUI(){
  const tbody = qs('#ranking-body');
  try{
    const res = await apiGet('/api/bets/leaderboard', true);
    const rows = (res.data||[]).map(entry=>{
      return `<tr>
        <td>${entry.position}</td>
        <td>${entry.user?.name||'-'}</td>
        <td><strong>${entry.totalPoints||0}</strong></td>
        <td>${entry.groupPoints||0}</td>
        <td>${entry.podiumPoints||0}</td>
        <td>${entry.bonusPoints||0}</td>
      </tr>`;
    }).join('');
    tbody.innerHTML = rows || '<tr><td colspan="6">Sem dados.</td></tr>';
  }catch(e){
    tbody.innerHTML = '<tr><td colspan="6">Erro ao carregar ranking.</td></tr>';
  }
}
