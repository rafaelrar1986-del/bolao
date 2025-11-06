
import { apiGet, apiPost, apiPut, apiDelete } from './api.js';
import { qs, openModal, closeModal } from './ui.js';

let matches = [];

export async function loadAdminArea(){
  await refreshMatches();
  qs('#btn-open-add').onclick = ()=> openAddModal();
  qs('#btn-open-finish').onclick = ()=> openFinishModal();
  qs('#btn-open-set-podium').onclick = ()=> openSetPodiumModal();
  qs('#btn-recalc').onclick = ()=> recalcAll();
}

async function refreshMatches(){
  const res = await apiGet('/api/matches/admin/all', true);
  matches = res.data || [];
  renderAdminMatches();
}

function renderAdminMatches(){
  const cont = qs('#admin-matches-list');
  if(!matches.length){ cont.innerHTML = '<div class="card">Sem partidas.</div>'; return; }
  const rows = [`<table class="table"><thead>
    <tr><th>ID</th><th>Partida</th><th>Grupo</th><th>Status</th><th>Placar</th><th>Palpites</th><th>Ações</th></tr>
  </thead><tbody>`,
  ...matches.map(m=>{
    const score = (typeof m.scoreA==='number' && typeof m.scoreB==='number') ? `${m.scoreA}-${m.scoreB}` : '--:--';
    return `<tr>
      <td>${m.matchId}</td>
      <td><strong>${m.teamA}</strong> vs <strong>${m.teamB}</strong></td>
      <td>${m.group}</td>
      <td>${m.status}</td>
      <td>${score}</td>
      <td>${m.betsCount||0}</td>
      <td>
        <button class="btn btn-info btn-sm" data-edit="${m.matchId}"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-sm" data-del="${m.matchId}"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }), '</tbody></table>'].join('');
  cont.innerHTML = rows;
  cont.querySelectorAll('[data-edit]').forEach(b=> b.onclick = ()=> openEditModal(parseInt(b.dataset.edit)));
  cont.querySelectorAll('[data-del]').forEach(b=> b.onclick = ()=> deleteMatch(parseInt(b.dataset.del)));
}

function openAddModal(){
  openModal('Adicionar Partida', formHTML());
  bindFormSubmit('add');
}

function openEditModal(matchId){
  const m = matches.find(x=>x.matchId===matchId);
  openModal(`Editar Partida #${matchId}`, formHTML(m, true));
  bindFormSubmit('edit', matchId);
}

function formHTML(m={}, isEdit=false){
  return `
    <form id="match-form" class="form">
      <div class="form-group">
        <label>ID da Partida</label>
        <input type="number" id="f-id" ${isEdit?'disabled':''} value="${m.matchId||''}" required min="1">
      </div>
      <div class="form-group"><label>Time A</label><input id="f-teamA" value="${m.teamA||''}" required></div>
      <div class="form-group"><label>Time B</label><input id="f-teamB" value="${m.teamB||''}" required></div>
      <div class="form-group"><label>Data (DD/MM/AAAA)</label><input id="f-date" value="${m.date||''}" placeholder="13/06/2026" required></div>
      <div class="form-group"><label>Hora (HH:MM)</label><input id="f-time" value="${m.time||''}" placeholder="16:00" required></div>
      <div class="form-group"><label>Grupo</label><input id="f-group" value="${m.group||''}" required></div>
      <div class="form-group"><label>Estádio</label><input id="f-stadium" value="${m.stadium||''}"></div>
      <div class="form-group">
        <label>Status</label>
        <select id="f-status">
          <option value="scheduled" ${m.status==='scheduled'?'selected':''}>Agendado</option>
          <option value="in_progress" ${m.status==='in_progress'?'selected':''}>Em andamento</option>
          <option value="finished" ${m.status==='finished'?'selected':''}>Finalizado</option>
        </select>
      </div>
      <div class="form-group">
        <label>Placar (A - B)</label>
        <div style="display:flex;gap:8px;">
          <input type="number" id="f-scoreA" min="0" max="20" value="${(typeof m.scoreA==='number')?m.scoreA:''}" placeholder="A">
          <input type="number" id="f-scoreB" min="0" max="20" value="${(typeof m.scoreB==='number')?m.scoreB:''}" placeholder="B">
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="submit" class="btn btn-success">${isEdit?'Salvar':'Adicionar'}</button>
        <button type="button" class="btn btn-light" id="btn-cancel">Cancelar</button>
      </div>
    </form>
  `;
}

function bindFormSubmit(mode, matchId){
  qs('#btn-cancel').onclick = ()=> closeModal();
  qs('#match-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const payload = {
      matchId: parseInt(qs('#f-id').value),
      teamA: qs('#f-teamA').value.trim(),
      teamB: qs('#f-teamB').value.trim(),
      date: qs('#f-date').value.trim(),
      time: qs('#f-time').value.trim(),
      group: qs('#f-group').value.trim(),
      stadium: qs('#f-stadium').value.trim(),
      status: qs('#f-status').value,
    };
    const sA = qs('#f-scoreA').value; const sB = qs('#f-scoreB').value;
    if(sA!=='' && sB!==''){ payload.scoreA=parseInt(sA); payload.scoreB=parseInt(sB); }

    try{
      if(mode==='add'){
        await apiPost('/api/matches/admin/add', payload, true);
      }else{
        await apiPut(`/api/matches/admin/edit/${matchId}`, payload, true);
      }
      closeModal();
      await refreshMatches();
    }catch(e){
      alert(e.message || 'Erro ao salvar partida');
    }
  });
}

function openFinishModal(){
  const opts = matches.filter(m=>m.status!=='finished').map(m=>`<option value="${m.matchId}">${m.teamA} vs ${m.teamB}</option>`).join('');
  openModal('Finalizar Partida', `
    <div class="form-group">
      <label>Partida</label>
      <select id="fin-id"><option value="">Selecione</option>${opts}</select>
    </div>
    <div class="form-group"><label>Placar A</label><input type="number" id="fin-a" min="0" max="20"></div>
    <div class="form-group"><label>Placar B</label><input type="number" id="fin-b" min="0" max="20"></div>
    <button class="btn btn-success" id="fin-ok">Finalizar</button>
  `);
  qs('#fin-ok').onclick = async ()=>{
    const id = parseInt(qs('#fin-id').value); const a = parseInt(qs('#fin-a').value); const b = parseInt(qs('#fin-b').value);
    if(!id || isNaN(a) || isNaN(b)){ alert('Selecione a partida e informe o placar.'); return; }
    try{
      await apiPost(`/api/matches/admin/finish/${id}`, {scoreA:a, scoreB:b}, true);
      closeModal(); await refreshMatches();
    }catch(e){ alert(e.message || 'Erro ao finalizar'); }
  }
}

function openSetPodiumModal(){
  openModal('Definir Pódio', `
    <div class="form-group"><label>🥇 1º</label><input id="p1"></div>
    <div class="form-group"><label>🥈 2º</label><input id="p2"></div>
    <div class="form-group"><label>🥉 3º</label><input id="p3"></div>
    <button class="btn btn-success" id="pod-ok">Aplicar</button>
  `);
  qs('#pod-ok').onclick = async ()=>{
    try{
      await apiPost('/api/points/process-podium', { first: qs('#p1').value, second: qs('#p2').value, third: qs('#p3').value }, true);
      closeModal();
    }catch(e){ alert(e.message || 'Erro ao processar pódio'); }
  }
}

async function recalcAll(){
  try{ await apiPost('/api/points/recalculate-all', {}, true); alert('Recalculo solicitado.'); }
  catch(e){ alert(e.message || 'Erro no recálculo'); }
}

async function deleteMatch(matchId){
  if(!confirm('Excluir partida?')) return;
  try{ await apiDelete(`/api/matches/admin/delete/${matchId}`, true); await refreshMatches(); }
  catch(e){ alert(e.message || 'Erro ao excluir'); }
}
