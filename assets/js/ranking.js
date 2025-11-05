
// ranking.js (module)
import { getLeaderboard } from './api.js';
import { html, qs } from './utils.js';
import { currentUser } from './auth.js';

export async function loadRanking() {
  const tbody = qs('#ranking-body');
  try {
    const data = await getLeaderboard();
    const list = data.data || [];
    if (!list.length) {
      html(tbody, `<tr><td colspan="6" class="center">Nenhum participante ainda</td></tr>`);
      return;
    }
    html(tbody, list.map(rowTpl).join(''));
  } catch (e) {
    html(tbody, `<tr><td colspan="6" class="center">Erro ao carregar ranking</td></tr>`);
  }
}

function rowTpl(entry) {
  const me = currentUser && entry.user && entry.user._id === currentUser._id;
  const mark = me ? ' style="background:#eaf4ff;"' : '';
  return `<tr${mark}>
    <td>${entry.position}</td>
    <td>${entry.user.name} ${me?'(Você)':''}</td>
    <td><strong>${entry.totalPoints||0}</strong></td>
    <td>${entry.groupPoints||0}</td>
    <td>${entry.podiumPoints||0}</td>
    <td>${entry.bonusPoints||0}</td>
  </tr>`;
}
