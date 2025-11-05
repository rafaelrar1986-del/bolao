// js/admin.js
(function(API, UI){
  async function loadAdminMatches(){
    const box = document.getElementById('admin-matches-list');
    try{
      const res = await API.request('/api/matches/admin/all',{auth:true});
      const rows = (res.data||[]).map(m=>`
        <div class="card">
          <div class="flex-between">
            <div><strong>#${m.matchId}</strong> — ${m.teamA} vs ${m.teamB} • <small>${m.group}</small></div>
            <div class="badge">${m.status}</div>
          </div>
          <div class="mt">Palpites: ${m.betsCount||0}</div>
          <div class="actions mt">
            <button class="btn info" data-edit="${m.matchId}"><i class="fas fa-edit"></i> Editar</button>
            ${m.status!=='finished' ? `<button class="btn success" data-finish="${m.matchId}"><i class="fas fa-whistle"></i> Finalizar</button>`:''}
          </div>
        </div>`).join('');
      box.innerHTML = rows || '<p>Nenhuma partida.</p>';
      UI.$$('#admin-matches-list [data-edit]').forEach(b=>b.addEventListener('click', ()=> openEditModal(parseInt(b.dataset.edit))));
      UI.$$('#admin-matches-list [data-finish]').forEach(b=>b.addEventListener('click', ()=> openFinishModal(parseInt(b.dataset.finish))));
    }catch(e){
      box.innerHTML = `<p>${e.message}</p>`;
    }
  }

  function openAddModal(){
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="grid-2">
        <div><label>ID</label><input type="number" name="matchId" required min="1"></div>
        <div><label>Grupo</label><input type="text" name="group" required></div>
      </div>
      <div class="grid-2">
        <div><label>Time A</label><input type="text" name="teamA" required></div>
        <div><label>Time B</label><input type="text" name="teamB" required></div>
      </div>
      <div class="grid-2">
        <div><label>Data (DD/MM/AAAA)</label><input type="text" name="date" required></div>
        <div><label>Hora (HH:MM)</label><input type="text" name="time" required></div>
      </div>
      <div><label>Estádio</label><input type="text" name="stadium"></div>
      <div class="mt"><button class="btn success" type="submit"><i class="fas fa-save"></i> Adicionar</button></div>
    `;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      payload.matchId = parseInt(payload.matchId);
      try{
        await API.request('/api/matches/admin/add',{method:'POST', auth:true, body:payload});
        UI.closeModal();
        loadAdminMatches();
      }catch(err){ alert(err.message); }
    });
    UI.openModal('Adicionar Partida', form);
  }

  function openEditModal(matchId){
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="grid-2">
        <div><label>Time A</label><input type="text" name="teamA" required></div>
        <div><label>Time B</label><input type="text" name="teamB" required></div>
      </div>
      <div class="grid-2">
        <div><label>Data</label><input type="text" name="date" required></div>
        <div><label>Hora</label><input type="text" name="time" required></div>
      </div>
      <div class="grid-2">
        <div><label>Grupo</label><input type="text" name="group" required></div>
        <div><label>Estádio</label><input type="text" name="stadium"></div>
      </div>
      <div class="mt"><button class="btn success" type="submit"><i class="fas fa-save"></i> Salvar</button></div>
    `;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      try{
        await API.request(`/api/matches/admin/edit/${matchId}`,{method:'PUT', auth:true, body:payload});
        UI.closeModal();
        loadAdminMatches();
      }catch(err){ alert(err.message); }
    });
    UI.openModal(`Editar Partida #${matchId}`, form);
  }

  function openFinishModal(matchId){
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="grid-2">
        <div><label>Placar A</label><input type="number" name="scoreA" required min="0" max="20"></div>
        <div><label>Placar B</label><input type="number" name="scoreB" required min="0" max="20"></div>
      </div>
      <div class="mt"><button class="btn success" type="submit"><i class="fas fa-flag-checkered"></i> Finalizar</button></div>
    `;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const p = Object.fromEntries(new FormData(form).entries());
      p.scoreA = parseInt(p.scoreA); p.scoreB = parseInt(p.scoreB);
      try{
        await API.request(`/api/matches/admin/finish/${matchId}`,{method:'POST', auth:true, body:p});
        UI.closeModal();
        loadAdminMatches();
      }catch(err){ alert(err.message); }
    });
    UI.openModal(`Finalizar Partida #${matchId}`, form);
  }

  async function openPodiumModal(){
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="grid-3">
        <div><label>🥇 Campeão</label><input type="text" name="first" required></div>
        <div><label>🥈 Vice</label><input type="text" name="second" required></div>
        <div><label>🥉 Terceiro</label><input type="text" name="third" required></div>
      </div>
      <div class="mt"><button class="btn success" type="submit"><i class="fas fa-trophy"></i> Definir</button></div>
    `;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const p = Object.fromEntries(new FormData(form).entries());
      try{
        await API.request('/api/points/process-podium',{method:'POST', auth:true, body:p});
        UI.closeModal();
        alert('Pódio definido e pontos calculados!');
      }catch(err){ alert(err.message); }
    });
    UI.openModal('Definir Pódio', form);
  }

  async function recalcAll(){
    try{
      await API.request('/api/points/recalculate-all',{method:'POST', auth:true});
      alert('Pontos recalculados!');
    }catch(err){ alert(err.message); }
  }

  function bindAdminButtons(){
    document.getElementById('btn-open-add').addEventListener('click', openAddModal);
    document.getElementById('btn-open-finish').addEventListener('click', ()=>{
      const id = prompt('ID da partida para finalizar:');
      if(!id) return;
      openFinishModal(parseInt(id));
    });
    document.getElementById('btn-open-podium').addEventListener('click', openPodiumModal);
    document.getElementById('btn-recalc').addEventListener('click', recalcAll);
  }

  window.Admin = { loadAdminMatches, bindAdminButtons };
})(window.API, window.UI);
