import { api } from './api.js';
import { $, toast, createModal, confirmDialog } from './ui.js';

export async function loadAdminMatches(){
  const box = $('#admin-matches-list');
  box.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>';
  try{
    const res = await api.adminAll();
    const rows = (res.data||[]).map(m=>{
      const statusColor = m.status;
      const score = m.status==='finished' ? `${m.scoreA} - ${m.scoreB}` : '-- : --';
      return `<tr>
        <td>${m.matchId}</td>
        <td><strong>${m.teamA}</strong> vs <strong>${m.teamB}</strong></td>
        <td>${m.group}</td>
        <td><span class="badge ${statusColor}">${m.status}</span></td>
        <td>${score}</td>
        <td>${m.betsCount||0}</td>
        <td>
          <button class="btn btn-info btn-small" data-edit="${m.matchId}"><i class="fas fa-edit"></i></button>
          ${m.status!=='finished' ? `<button class="btn btn-success btn-small" data-finish="${m.matchId}"><i class="fas fa-whistle"></i></button>`:''}
        </td>
      </tr>`;
    }).join('');
    box.innerHTML = `<table class="table">
      <thead><tr><th>ID</th><th>Partida</th><th>Grupo</th><th>Status</th><th>Placar</th><th>Palpites</th><th>Ações</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

    box.querySelectorAll('[data-edit]').forEach(btn=>btn.addEventListener('click', ()=>openEditModal(btn.dataset.edit)));
    box.querySelectorAll('[data-finish]').forEach(btn=>btn.addEventListener('click', ()=>openFinishModal(btn.dataset.finish)));
  }catch(err){
    box.innerHTML = `<p>Erro: ${err.message}</p>`;
  }
}

export function bindAdminButtons(){
  $('#btn-open-add-modal').addEventListener('click', openAddModal);
  $('#btn-open-finish-modal').addEventListener('click', ()=>openFinishModal());
  $('#btn-open-podium-modal').addEventListener('click', openPodiumModal);
  $('#btn-recalc').addEventListener('click', async ()=>{
    try{ await api.recalcAll(); toast('success','Recalculo concluído'); }catch(e){ toast('error',e.message); }
  });
  $('#btn-integrity').addEventListener('click', async ()=>{
    try{ const r = await api.integrity(); toast('info',`Erros: ${r.data.errors?.length||0} | Avisos: ${r.data.warnings?.length||0}`); }catch(e){ toast('error',e.message); }
  });
}

function openAddModal(){
  const modal = createModal('add-match-modal','Adicionar Partida',`
    <form id="add-match-form" class="auth-form">
      <div class="form-row">
        <div class="form-group"><label>ID</label><input id="match-id" type="number" min="1" required/></div>
        <div class="form-group"><label>Grupo</label><input id="match-group" required/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Time A</label><input id="team-a" required/></div>
        <div class="form-group"><label>Time B</label><input id="team-b" required/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Data (DD/MM/AAAA)</label><input id="match-date" placeholder="13/06/2026" required/></div>
        <div class="form-group"><label>Hora (HH:MM)</label><input id="match-time" placeholder="16:00" required/></div>
      </div>
      <div class="form-group"><label>Estádio</label><input id="match-stadium"/></div>
      <button class="btn btn-success" type="submit">Adicionar</button>
    </form>`);
  modal.querySelector('#add-match-form').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const payload = {
      matchId: parseInt($('#match-id',modal).value,10),
      teamA: $('#team-a',modal).value.trim(),
      teamB: $('#team-b',modal).value.trim(),
      date: $('#match-date',modal).value.trim(),
      time: $('#match-time',modal).value.trim(),
      group: $('#match-group',modal).value.trim(),
      stadium: $('#match-stadium',modal).value.trim()
    };
    try{ await api.adminAdd(payload); toast('success','Partida adicionada'); modal.remove(); loadAdminMatches(); }catch(e){ toast('error',e.message); }
  });
}

async function openEditModal(matchId){
  // fetch one from admin list to prefill
  try{
    const res = await api.adminAll();
    const m = (res.data||[]).find(x=>String(x.matchId)===String(matchId));
    if(!m){ toast('error','Partida não encontrada'); return; }
    const modal = createModal('edit-match-modal','Editar Partida',`
      <form id="edit-match-form" class="auth-form">
        <input type="hidden" id="edit-id" value="${m.matchId}" />
        <div class="form-row">
          <div class="form-group"><label>Time A</label><input id="edit-team-a" value="${m.teamA}" required/></div>
          <div class="form-group"><label>Time B</label><input id="edit-team-b" value="${m.teamB}" required/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Data (DD/MM/AAAA)</label><input id="edit-date" value="${m.date}" required/></div>
          <div class="form-group"><label>Hora (HH:MM)</label><input id="edit-time" value="${m.time}" required/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Grupo</label><input id="edit-group" value="${m.group}" required/></div>
          <div class="form-group"><label>Estádio</label><input id="edit-stadium" value="${m.stadium||''}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Status</label>
            <select id="edit-status">
              <option value="scheduled" ${m.status==='scheduled'?'selected':''}>Agendado</option>
              <option value="in_progress" ${m.status==='in_progress'?'selected':''}>Em andamento</option>
              <option value="finished" ${m.status==='finished'?'selected':''}>Finalizado</option>
            </select>
          </div>
          <div class="form-group"><label>Placar A</label><input id="edit-score-a" type="number" min="0" max="20" value="${m.scoreA??''}" /></div>
          <div class="form-group"><label>Placar B</label><input id="edit-score-b" type="number" min="0" max="20" value="${m.scoreB??''}" /></div>
        </div>
        <button class="btn btn-success" type="submit">Salvar</button>
      </form>`);
    modal.querySelector('#edit-match-form').addEventListener('submit', async (e)=>{
      e.preventDefault();
      const id = $('#edit-id',modal).value;
      const payload = {
        teamA: $('#edit-team-a',modal).value.trim(),
        teamB: $('#edit-team-b',modal).value.trim(),
        date: $('#edit-date',modal).value.trim(),
        time: $('#edit-time',modal).value.trim(),
        group: $('#edit-group',modal).value.trim(),
        stadium: $('#edit-stadium',modal).value.trim(),
        status: $('#edit-status',modal).value
      };
      const sa = $('#edit-score-a',modal).value;
      const sb = $('#edit-score-b',modal).value;
      if(sa!=='' && sb!==''){ payload.scoreA = parseInt(sa,10); payload.scoreB = parseInt(sb,10); }
      try{ await api.adminEdit(id,payload); toast('success','Atualizado'); modal.remove(); loadAdminMatches(); }catch(e){ toast('error',e.message); }
    });
  }catch(e){ toast('error',e.message); }
}

async function openFinishModal(matchId){
  // If id not provided, open select
  const res = await api.adminAll();
  const options = (res.data||[]).filter(x=>x.status!=='finished').map(x=>`<option value="${x.matchId}">${x.matchId} - ${x.teamA} vs ${x.teamB}</option>`).join('');
  const modal = createModal('finish-modal','Finalizar Partida',`
    <div class="form-group"><label>Partida</label>
      <select id="finish-select"><option value="">Selecione...</option>${options}</select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Placar A</label><input id="finish-a" type="number" min="0" max="20"/></div>
      <div class="form-group"><label>Placar B</label><input id="finish-b" type="number" min="0" max="20"/></div>
    </div>
    <button id="finish-btn" class="btn btn-success">Finalizar</button>
  `);
  if(matchId){ $('#finish-select',modal).value = matchId; }
  $('#finish-btn',modal).addEventListener('click', async ()=>{
    const id = $('#finish-select',modal).value;
    const a = $('#finish-a',modal).value;
    const b = $('#finish-b',modal).value;
    if(!id||a===''||b===''){ return toast('warning','Preencha tudo'); }
    try{ await api.adminFinish(id,{scoreA:parseInt(a,10),scoreB:parseInt(b,10)}); toast('success','Finalizado'); modal.remove(); loadAdminMatches(); }catch(e){ toast('error',e.message); }
  });
}

function openPodiumModal(){
  const modal = createModal('podium-modal','Definir Pódio',`
    <div class="form-group"><label>🥇 1º (7 pts)</label><input id="podium-first"/></div>
    <div class="form-group"><label>🥈 2º (4 pts)</label><input id="podium-second"/></div>
    <div class="form-group"><label>🥉 3º (2 pts)</label><input id="podium-third"/></div>
    <button id="podium-btn" class="btn btn-success">Salvar Pódio</button>
  `);
  $('#podium-btn',modal).addEventListener('click', async ()=>{
    const first = $('#podium-first',modal).value.trim();
    const second = $('#podium-second',modal).value.trim();
    const third = $('#podium-third',modal).value.trim();
    if(!first||!second||!third) return toast('warning','Preencha o pódio completo');
    try{ await api.processPodium({first,second,third}); toast('success','Pódio definido'); modal.remove(); }catch(e){ toast('error',e.message); }
  });
}
