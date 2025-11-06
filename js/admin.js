import { api } from './api.js';
import { openModal, notify } from './ui.js';

export async function initAdmin(){
  await loadAdminMatches();
  document.getElementById('btn-add-match').addEventListener('click', openAddMatch);
  document.getElementById('btn-finish-match').addEventListener('click', openFinishMatch);
  document.getElementById('btn-set-podium').addEventListener('click', openSetPodium);
  document.getElementById('btn-recalc').addEventListener('click', recalcAll);
  document.getElementById('btn-integrity').addEventListener('click', doIntegrity);
}

async function loadAdminMatches(){
  const res = await api.adminAll();
  const container = document.getElementById('admin-matches-list');
  const list = res.data || [];
  if(list.length===0){ container.innerHTML='<p>Nenhuma partida.</p>'; return; }
  container.innerHTML = `<table class="ranking-table" style="font-size:.92rem">
    <thead><tr><th>ID</th><th>Partida</th><th>Grupo</th><th>Status</th><th>Placar</th><th>Palpites</th><th>Ações</th></tr></thead>
    <tbody>
      ${list.map(m => {
        const stc = m.status==='finished' ? 'var(--success)' : (m.status==='in_progress' ? 'var(--warning)' : 'var(--info)');
        const score = m.status==='finished' ? `${m.scoreA} - ${m.scoreB}` : '-- : --';
        return `<tr>
          <td>${m.matchId}</td>
          <td><strong>${m.teamA}</strong> vs <strong>${m.teamB}</strong></td>
          <td>${m.group}</td>
          <td style="color:${stc};font-weight:700">${m.status}</td>
          <td>${score}</td>
          <td>${m.betsCount||0}</td>
          <td>
            <button class="btn btn-small btn-info" data-action="edit" data-id="${m.matchId}"><i class="fas fa-edit"></i></button>
            ${m.status!=='finished' ? `<button class="btn btn-small btn-success" data-action="finish" data-id="${m.matchId}"><i class="fas fa-whistle"></i></button>` : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
  container.querySelectorAll('button[data-action]').forEach(b=>{
    const id = b.dataset.id;
    if(b.dataset.action==='finish') b.addEventListener('click', ()=> openFinishMatch(id));
    if(b.dataset.action==='edit') b.addEventListener('click', ()=> openEditMatch(id));
  });
}

function openAddMatch(){
  openModal('Adicionar Partida', `
    <form id="form-add" class="stack">
      <div class="form-row">
        <div class="form-group"><label>ID</label><input id="am-id" type="number" min="1" required></div>
        <div class="form-group"><label>Grupo</label><input id="am-group" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Time A</label><input id="am-a" required></div>
        <div class="form-group"><label>Time B</label><input id="am-b" required></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Data (DD/MM/AAAA)</label><input id="am-date" placeholder="DD/MM/AAAA" required></div>
        <div class="form-group"><label>Hora (HH:MM)</label><input id="am-time" placeholder="HH:MM" required></div>
      </div>
      <div class="form-group"><label>Estádio</label><input id="am-stadium"></div>
      <button class="btn btn-success" type="submit">Adicionar</button>
    </form>
  `);
  document.getElementById('form-add').addEventListener('submit', async (e)=>{
    e.preventDefault();
    try{
      await api.adminAdd({
        matchId: parseInt(document.getElementById('am-id').value,10),
        teamA: document.getElementById('am-a').value.trim(),
        teamB: document.getElementById('am-b').value.trim(),
        date: document.getElementById('am-date').value.trim(),
        time: document.getElementById('am-time').value.trim(),
        group: document.getElementById('am-group').value.trim(),
        stadium: document.getElementById('am-stadium').value.trim()
      });
      notify('success','Partida adicionada!');
      document.getElementById('modal').classList.remove('open');
      await loadAdminMatches();
    }catch(e){ notify('error', e.message); }
  });
}

function openFinishMatch(prefId){
  openModal('Finalizar Partida', `
    <form id="form-finish" class="stack">
      <div class="form-group"><label>ID da partida</label><input id="fm-id" type="number" required value="${prefId||''}"></div>
      <div class="form-row">
        <div class="form-group"><label>Placar A</label><input id="fm-a" type="number" min="0" value="0" required></div>
        <div class="form-group"><label>Placar B</label><input id="fm-b" type="number" min="0" value="0" required></div>
      </div>
      <button class="btn btn-success" type="submit">Finalizar</button>
    </form>
  `);
  document.getElementById('form-finish').addEventListener('submit', async (e)=>{
    e.preventDefault();
    try{
      const id = document.getElementById('fm-id').value;
      await api.adminFinish(id, { scoreA: parseInt(document.getElementById('fm-a').value,10), scoreB: parseInt(document.getElementById('fm-b').value,10) });
      notify('success','Partida finalizada e pontos calculados!');
      document.getElementById('modal').classList.remove('open');
      await loadAdminMatches();
    }catch(e){ notify('error', e.message); }
  });
}

function openSetPodium(){
  openModal('Definir Pódio', `
    <form id="form-podium" class="stack">
      <div class="form-group"><label>🥇 Campeão</label><input id="pd-first" required placeholder="Ex.: Brasil"></div>
      <div class="form-group"><label>🥈 Vice</label><input id="pd-second" required></div>
      <div class="form-group"><label>🥉 Terceiro</label><input id="pd-third" required></div>
      <button class="btn btn-success" type="submit">Salvar</button>
    </form>
  `);
  document.getElementById('form-podium').addEventListener('submit', async (e)=>{
    e.preventDefault();
    try{
      await api.processPodium({
        first: document.getElementById('pd-first').value.trim(),
        second: document.getElementById('pd-second').value.trim(),
        third: document.getElementById('pd-third').value.trim()
      });
      notify('success','Pódio definido e pontos calculados!');
      document.getElementById('modal').classList.remove('open');
    }catch(e){ notify('error', e.message); }
  });
}

async function recalcAll(){
  try{
    await api.recalcAll();
    notify('success','Todos os pontos recalculados!');
  }catch(e){ notify('error', e.message); }
}

async function doIntegrity(){
  try{
    const res = await api.integrityCheck();
    const r = res.data;
    openModal('Relatório de Integridade', `<pre style="white-space:pre-wrap">${JSON.stringify(r, null, 2)}</pre>`);
  }catch(e){ notify('error', e.message); }
}

function openEditMatch(id){
  openFinishMatch(id); // for now we reuse finish modal; edition full would be similar
}
