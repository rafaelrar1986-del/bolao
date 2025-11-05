
// stats.js (module)
import { getPointsStats } from './api.js';
import { html, qs } from './utils.js';

export async function loadStats() {
  const container = qs('#stats-container');
  try {
    const data = await getPointsStats();
    const s = data.data || {};
    const top = (s.topParticipants||[]).slice(0,5);
    let h = `
      <div class="filters">
        <div class="filter-grid">
          <div class="card"><div class="muted">Participantes</div><div class="badge" style="font-size:1.4rem">${s.participants||0}</div></div>
          <div class="card"><div class="muted">Finalizadas</div><div class="badge" style="font-size:1.4rem">${s.finishedMatches||0}</div></div>
          <div class="card"><div class="muted">Pontos Distribuídos</div><div class="badge" style="font-size:1.4rem">${s.totalPoints||0}</div></div>
          <div class="card"><div class="muted">Média</div><div class="badge" style="font-size:1.4rem">${s.averagePoints||0}</div></div>
          <div class="card"><div class="muted">Precisão Média</div><div class="badge" style="font-size:1.4rem">${s.averageAccuracy||0}%</div></div>
        </div>
      </div>`;
    if (top.length) {
      h += `<div class="card"><h3><i class="fas fa-trophy"></i> Top 5</h3>
        <table class="table"><thead><tr><th>Posição</th><th>Participante</th><th>Pontos</th></tr></thead>
        <tbody>${top.map(t=>`<tr><td>${t.position||'-'}</td><td>${t.name}</td><td><strong>${t.points}</strong></td></tr>`).join('')}</tbody></table>
      </div>`;
    }
    html(container, h);
  } catch (e) {
    html(container, '<p>Erro ao carregar estatísticas.</p>');
  }
}
