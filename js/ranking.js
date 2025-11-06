import { api } from './api.js';
import { $, toast } from './ui.js';

export async function loadRanking(){
  const body = document.getElementById('ranking-body');
  body.innerHTML = '<tr><td colspan="6" style="text-align:center;"><div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando...</div></td></tr>';
  try{
    const data = await api.leaderboard();
    const rows = (data.data||[]).map(entry=>{
      return `<tr>
        <td class="position">${entry.position}</td>
        <td>${entry.user?.name||'-'}</td>
        <td class="points">${entry.totalPoints||0}</td>
        <td>${entry.groupPoints||0}</td>
        <td>${entry.podiumPoints||0}</td>
        <td>${entry.bonusPoints||0}</td>
      </tr>`;
    }).join('');
    body.innerHTML = rows || '<tr><td colspan="6" style="text-align:center;">Sem dados</td></tr>';
  }catch(err){
    toast('error','Erro ao carregar ranking: '+err.message);
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;">Erro</td></tr>';
  }
}
