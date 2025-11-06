import { api } from './api.js';

export async function loadRanking(currentUser){
  const res = await api.leaderboard();
  const list = res.data || [];
  const tbody = document.getElementById('ranking-body');
  if(list.length===0){ tbody.innerHTML = '<tr><td colspan="6" class="center">Nenhum participante</td></tr>'; return; }
  tbody.innerHTML = list.map(entry => {
    const isMe = currentUser && entry.user && (entry.user._id===currentUser._id);
    const style = isMe ? ' style="background:#e3f2fd;"' : '';
    return `<tr${style}>
      <td class="position">${entry.position}</td>
      <td>${entry.user.name} ${isMe ? '(Você)' : ''}</td>
      <td class="points">${entry.totalPoints}</td>
      <td>${entry.groupPoints||0}</td>
      <td>${entry.podiumPoints||0}</td>
      <td>${entry.bonusPoints||0}</td>
    </tr>`;
  }).join('');
}
