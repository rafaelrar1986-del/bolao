/* Rebuilt from the pre-refactor matches4.js baseline. Business logic preserved verbatim. */
export function createMatchesGroupPrediction(ctx = {}) {
  const get = (name) => ctx[name];

  function renderFilterHeader() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    if (!STATE.hasSubmitted) return '';

    return `
      <div class="filter-wrapper" style="margin-bottom: 20px;">
        <div class="filter-pills-row" style="display: flex; margin-bottom: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch;">
          <div class="filter-pills" style="display: flex; gap: 8px;">
            <button class="pill ${STATE.groupFilter === 'group' ? 'active' : ''}" onclick="setMatchFilter('group')">Grupo</button>
            <button class="pill ${STATE.groupFilter === 'date' ? 'active' : ''}" onclick="setMatchFilter('date')">Data</button>
            <button class="pill ${STATE.groupFilter === 'live' ? 'active' : ''}" onclick="setMatchFilter('live')">📡 Ao Vivo</button>
          </div>
        </div>

        ${STATE.groupFilter === 'date' ? `
          <div class="status-filter-row" style="display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
            <span style="font-size: 13px; color: #ffffff; font-weight: 600;">Pendentes</span>
            <label class="switch">
              <input type="checkbox" ${STATE.groupStatusFilter === 'pending' ? 'checked' : ''} onchange="window.togglePendingFilter(this.checked)">
              <span class="slider round"></span>
            </label>
          </div>
        ` : ''}
      </div>
    `;
  }

  function getGroupQualificationConfig() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const q = STATE.championshipRules?.groupQualification || {};
    const totalTeams = Number(q.totalTeams || 0);
    const groupCount = Number(q.groupCount || 0);
    const totalQualified = Number(q.totalQualified || 0);
    if (
      totalTeams > 0 &&
      groupCount > 0 &&
      totalQualified > 0 &&
      totalTeams % groupCount === 0 &&
      totalQualified <= totalTeams
    ) {
      const teamsPerGroup = totalTeams / groupCount;
      const base = Math.floor(totalQualified / groupCount);
      const additional = totalQualified % groupCount;

      if (
        base <= teamsPerGroup &&
        (additional === 0 || base < teamsPerGroup)
      ) {
        return {
          baseQualifiedPerGroup: base,
          additionalQualifiedCount: additional,
          additionalQualificationPosition: additional > 0 ? base + 1 : null,
          teamsPerGroup,
          totalQualified,
          configured: true
        };
      }
    }
    return {
      baseQualifiedPerGroup: 0,
      additionalQualifiedCount: 0,
      additionalQualificationPosition: null,
      teamsPerGroup: null,
      totalQualified: 0,
      configured: false
    };
  }

  function getGroupTeams(groupGames) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const out=[], seen=new Set();
    groupGames.forEach(m => [m.teamA,m.teamB].forEach(team => {
      const t=String(team||'').trim();
      if(t&&!seen.has(t)){seen.add(t);out.push(t);}
    }));
    return out;
  }

  function getPredictedResultForMatch(match) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const id=Number(match.matchId);
    const score=STATE.scoresMap.get(id)||STATE.scoresMap.get(String(match.matchId))||{};
    const a=Number(score.scoreA), b=Number(score.scoreB);
    if(Number.isFinite(a)&&Number.isFinite(b)) return {a,b,complete:true};
    const winner=STATE.betsMap.get(id) ?? STATE.betsMap.get(String(match.matchId)) ?? null;
    if(['A','B','draw'].includes(winner)) return {a:null,b:null,winner,complete:true};
    return {a:null,b:null,winner:null,complete:false};
  }

  function calculatePredictedGroupStandings(groupGames) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getGroupTeams, getPredictedResultForMatch } = ctx;
    const rows=new Map();
    getGroupTeams(groupGames).forEach(team=>rows.set(team,{team,pts:0,gp:0,gc:0,sg:0,completed:0}));
    groupGames.forEach(match=>{
      const p=getPredictedResultForMatch(match), a=rows.get(match.teamA), b=rows.get(match.teamB);
      if(!a||!b||!p.complete)return;
      a.completed++;b.completed++;
      if(Number.isFinite(p.a)&&Number.isFinite(p.b)){
        a.gp+=p.a;a.gc+=p.b;b.gp+=p.b;b.gc+=p.a;
        if(p.a>p.b)a.pts+=3; else if(p.b>p.a)b.pts+=3; else {a.pts++;b.pts++;}
      } else if(p.winner==='A') a.pts+=3;
      else if(p.winner==='B') b.pts+=3;
      else if(p.winner==='draw'){a.pts++;b.pts++;}
      a.sg=a.gp-a.gc;b.sg=b.gp-b.gc;
    });
    /*
     * A classificação prevista deve usar EXATAMENTE a mesma ordem
     * aplicada pelo backend em groupController.js:
     *
     * 1) pontos
     * 2) confronto direto (pontos)
     * 3) confronto direto (saldo)
     * 4) confronto direto (gols marcados)
     * 5) saldo geral
     * 6) gols marcados
     * 7) nome
     *
     * Aqui calculamos os dados previstos dos confrontos diretos a partir
     * dos próprios palpites do usuário, sem alterar a regra oficial.
     */
    const rowsArray = [...rows.values()];
    const predictedMatches = groupGames
      .map(match => {
        const p = getPredictedResultForMatch(match);
        if (!p?.complete) return null;

        const a = rows.get(match.teamA);
        const b = rows.get(match.teamB);
        if (!a || !b) return null;

        let scoreA = Number.isFinite(p.a) ? p.a : null;
        let scoreB = Number.isFinite(p.b) ? p.b : null;

        return {
          teamA: match.teamA,
          teamB: match.teamB,
          scoreA,
          scoreB,
          winner: p.winner
        };
      })
      .filter(Boolean);

    const h2h = new Map();

    const ensureH2H = (team) => {
      if (!h2h.has(team)) {
        h2h.set(team, {
          pts: 0,
          sg: 0,
          gp: 0
        });
      }
      return h2h.get(team);
    };

    /*
     * Para dois times empatados em pontos, groupController calcula o
     * confronto direto exclusivamente entre eles.
     */
    const getHeadToHead = (teamA, teamB) => {
      const result = {
        ptsA: 0, ptsB: 0,
        sgA: 0, sgB: 0,
        gpA: 0, gpB: 0
      };

      predictedMatches.forEach(match => {
        const involvesBoth =
          (match.teamA === teamA && match.teamB === teamB) ||
          (match.teamA === teamB && match.teamB === teamA);

        if (!involvesBoth) return;

        if (Number.isFinite(match.scoreA) && Number.isFinite(match.scoreB)) {
          const golsA = match.teamA === teamA ? match.scoreA : match.scoreB;
          const golsB = match.teamA === teamB ? match.scoreA : match.scoreB;

          result.gpA += golsA;
          result.gpB += golsB;
          result.sgA += golsA - golsB;
          result.sgB += golsB - golsA;

          if (golsA > golsB) result.ptsA += 3;
          else if (golsB > golsA) result.ptsB += 3;
          else {
            result.ptsA += 1;
            result.ptsB += 1;
          }
        } else {
          if (match.winner === 'A') {
            if (match.teamA === teamA) result.ptsA += 3;
            else result.ptsB += 3;
          } else if (match.winner === 'B') {
            if (match.teamB === teamA) result.ptsA += 3;
            else result.ptsB += 3;
          } else if (match.winner === 'draw') {
            result.ptsA += 1;
            result.ptsB += 1;
          }
        }
      });

      return result;
    };

    return rowsArray.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;

      const h = getHeadToHead(a.team, b.team);

      if (h.ptsB !== h.ptsA) return h.ptsB - h.ptsA;
      if (h.sgB !== h.sgA) return h.sgB - h.sgA;
      if (h.gpB !== h.gpA) return h.gpB - h.gpA;

      if (b.sg !== a.sg) return b.sg - a.sg;
      if (b.gp !== a.gp) return b.gp - a.gp;

      return a.team.localeCompare(b.team, undefined, {
        sensitivity: 'base'
      });
    });
  }

  function getSavedGroupPrediction(groupName, standings, groupGames = []) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getGroupTeams } = ctx;
    const saved = STATE.groupPredictions.get(groupName);

    /*
     * A classificação deve ser DERIVADA dos palpites das partidas enquanto
     * o usuário não tiver alterado manualmente os selects.
     *
     * Nas versões anteriores, a classificação automática inicial (normalmente
     * em ordem alfabética, porque ainda não havia palpites) era gravada em
     * STATE.groupPredictions. Depois disso ela passava a ser tratada como
     * previsão manual e nunca mais acompanhava os novos palpites.
     */
    let manual = saved?.manual === true;

    // Compatibilidade com previsões antigas: se a previsão salva não possui
    // a marca manual e corresponde exatamente à ordem alfabética do grupo,
    // tratamos como a antiga previsão automática e a descartamos.
    if (saved?.positions?.length && saved.manual !== true) {
      const teams = getGroupTeams(groupGames || []);
      const alphabetical = [...teams].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
      const savedTeams = saved.positions
        .slice()
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map(p => String(p.team || '').trim());

      const isLegacyAutomatic =
        !Array.isArray(saved.additionalQualifiedTeams) ||
        saved.additionalQualifiedTeams.length === 0
          ? savedTeams.length === alphabetical.length &&
            savedTeams.every((team, i) => team === alphabetical[i])
          : false;

      if (!isLegacyAutomatic) manual = true;
    }

    if (manual && saved?.positions?.length) {
      const map = new Map(saved.positions.map(p => [Number(p.position), p.team]));
      return {
        group: groupName,
        positions: standings.map((row, i) => ({
          position: i + 1,
          team: map.get(i + 1) || row.team
        })),
        additionalQualifiedTeams: [
          ...new Set(saved.additionalQualifiedTeams || [])
        ],
        manual: true
      };
    }

    // Sem previsão manual: sempre mostra a classificação calculada agora.
    return {
      group: groupName,
      positions: standings.map((row, i) => ({
        position: i + 1,
        team: row.team
      })),
      additionalQualifiedTeams: []
    };
  }

  function getAllAdditionalQualifiedTeams() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const all = new Set();
    STATE.groupPredictions.forEach(prediction => {
      (prediction?.additionalQualifiedTeams || []).forEach(team => {
        const value = String(team || '').trim();
        if (value) all.add(value);
      });
    });
    return all;
  }

  function getGlobalAdditionalQualifiedCount() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getAllAdditionalQualifiedTeams } = ctx;
    return getAllAdditionalQualifiedTeams().size;
  }

  function refreshAllGroupThirdCounters() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getGroupQualificationConfig, getGlobalAdditionalQualifiedCount } = ctx;
    const config = getGroupQualificationConfig();
    const limit = Number(config.additionalQualifiedCount || 0);
    if (limit <= 0) return;
    const count = getGlobalAdditionalQualifiedCount();
    document.querySelectorAll('.group-prediction-section').forEach(section => {
      const counter = section.querySelector('.group-third-counter');
      if (!counter) return;
      counter.textContent = `${count} de ${limit}`;
      counter.style.color = count === limit ? '#6ee7b7' : '#ffd34d';
    });
  }

  async function loadGroupPredictionPointsLive() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal } = ctx;
    const leagueId = localStorage.getItem('selectedLeagueId') || 'default';
    const predictions = [...STATE.groupPredictions.values()].filter(Boolean);
    if (!predictions.length) return;

    try {
      const response = await api.post(
        `/api/groups/prediction-points?leagueId=${encodeURIComponent(leagueId)}&live=true`,
        { groupPredictions: predictions }
      );
      const data = response?.data || response || {};

      STATE.groupPredictionPoints.clear();
      for (const item of (data.breakdown || [])) {
        const group = String(item.group || '').trim();
        const team = String(item.team || '').trim();
        if (!group || !team) continue;
        if (!STATE.groupPredictionPoints.has(group)) {
          STATE.groupPredictionPoints.set(group, new Map());
        }
        STATE.groupPredictionPoints.get(group).set(team, item);
      }

      STATE.groupPredictionPointsStarted = new Set(
        (data.startedGroups || []).map(String)
      );

      document.querySelectorAll('.group-prediction-section').forEach(section => {
        const group = decodeURIComponent(section.dataset.group || '');
        const points = STATE.groupPredictionPoints.get(group) || new Map();
        const started = STATE.groupPredictionPointsStarted.has(group);

        section.querySelectorAll('.group-prediction-position').forEach(row => {
          const select = row.querySelector('.group-prediction-position-select');
          const el = row.querySelector('.group-prediction-points');
          if (!el) return;

          if (!started) {
            el.textContent = '—';
            el.style.color = '#999';
            return;
          }

          const item = points.get(select?.value || '');
          const pts = Number(item?.points || 0);
          el.textContent = pts > 0 ? `✓ +${pts}` : '✗ 0';
          el.style.color = pts > 0 ? '#6ee7b7' : '#f87171';
        });

        const total = [...points.values()].reduce(
          (sum, item) => sum + Number(item?.points || 0), 0
        );
        const totalEl = section.querySelector('.group-prediction-live-total');
        if (totalEl) {
          totalEl.textContent = started
            ? `🔴 Ao vivo: ${total} pts`
            : '⏳ Aguardando início do grupo';
        }
      });
    } catch (error) {
      console.warn('[GroupPredictionPoints] Falha ao atualizar pontuação LIVE:', error);
    }
  }

  function renderGroupPredictionSection(groupName, groupGames) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getGroupQualificationConfig, getGroupTeams, calculatePredictedGroupStandings, getSavedGroupPrediction, getGlobalAdditionalQualifiedCount } = ctx;
    const config=getGroupQualificationConfig();
    const rules=STATE.scoringRules?.groupQualificationRules;
    if(!Array.isArray(rules)||rules.length===0) return '';
    if(!groupGames.some(m=>String(m.phase||'').toLowerCase()==='group')) return '';

    const standings=calculatePredictedGroupStandings(groupGames);
    const existingPrediction=STATE.groupPredictions.get(groupName);
    const prediction=getSavedGroupPrediction(groupName,standings,groupGames);

    /*
     * A previsão automática faz parte do palpite e precisa ser persistida
     * mesmo quando o usuário nunca abriu/alterou o select.
     *
     * Se já existe uma previsão manual, preservamos exatamente o que o
     * usuário escolheu.
     */
    // A previsão automática NÃO é gravada em STATE.groupPredictions.
    // Ela é recalculada a cada render a partir dos palpites das partidas.
    // STATE.groupPredictions fica reservado para uma escolha manual do usuário.
    const candidatePosition=config.additionalQualificationPosition;
    const selected=new Set(prediction.additionalQualifiedTeams||[]);
    const globalSelectedCount=getGlobalAdditionalQualifiedCount();
    const teams=getGroupTeams(groupGames);
    const complete=standings.every(r=>r.completed>=groupGames.length/2);
    const limit=Number(config.additionalQualifiedCount||0);

    const rows=prediction.positions.map(p=>{
      const candidate=candidatePosition!=null&&Number(p.position)===Number(candidatePosition);
      const active=selected.has(p.team);
      return `<div class="group-prediction-position" style="display:grid;grid-template-columns:34px minmax(0,1fr) 58px 42px;gap:7px;align-items:center;margin:6px 0;">
        <span style="font-weight:800;text-align:center;">${p.position===1?'🥇':p.position===2?'🥈':p.position===3?'🥉':`${p.position}º`}</span>
        <select class="group-prediction-position-select" data-group="${encodeURIComponent(groupName)}" data-position="${p.position}" data-previous-value="${String(p.team).replace(/"/g,'&quot;')}" style="width:100%;min-width:0;padding:8px 6px;border-radius:7px;">
          ${teams.map(t=>`<option value="${String(t).replace(/"/g,'&quot;')}" ${t===p.team?'selected':''}>${t}</option>`).join('')}
        </select>
        <span class="group-prediction-points" style="font-size:.68rem;font-weight:900;text-align:right;white-space:nowrap;color:#999;">—</span>
        ${candidate?`<button type="button" class="group-third-qualifier ${active?'active':''}" data-group="${encodeURIComponent(groupName)}" data-position="${p.position}" data-team="${String(p.team).replace(/"/g,'&quot;')}" style="width:38px;height:34px;border-radius:8px;border:1px solid ${active?'#ffd34d':'rgba(255,255,255,.18)'};background:${active?'rgba(255,211,77,.18)':'rgba(255,255,255,.06)'};color:${active?'#ffd34d':'#aaa'};font-size:16px;">🏆</button>`:'<span></span>'}
      </div>`;
    }).join('');

    return `<section class="group-prediction-section" data-group="${encodeURIComponent(groupName)}" style="margin-top:12px;padding:12px;border-top:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.025);border-radius:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div><strong style="font-size:.9rem;">🏆 Classificação prevista</strong><div style="font-size:.68rem;color:#999;">Montada automaticamente pelos seus palpites.</div></div>
        ${limit>0?`<span class="group-third-counter" style="font-size:.68rem;color:${globalSelectedCount===limit?'#6ee7b7':'#ffd34d'};">${globalSelectedCount} de ${limit}</span>`:''}
      </div>
      ${rows}
      ${limit>0?`<div style="font-size:.68rem;color:#888;margin-top:6px;">Toque no 🏆 do ${candidatePosition}º colocado para indicar que ele avançará.</div>`:''}
      ${!complete?`<div style="margin-top:7px;font-size:.68rem;color:#f5b942;">A classificação será refinada conforme você preencher mais palpites.</div>`:''}
      <div class="group-prediction-live-total" style="margin-top:8px;text-align:right;font-size:.75rem;font-weight:900;color:#67e8f9;">${STATE.groupPredictionPointsStarted.has(groupName) ? '🔴 Ao vivo: 0 pts' : '⏳ Aguardando início do grupo'}</div>
    </section>`;
  }

  function persistGroupPredictionFromDom(section) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getGroupQualificationConfig } = ctx;
    const group=decodeURIComponent(section.dataset.group||'');
    if(!group)return;
    const positions=[...section.querySelectorAll('.group-prediction-position-select')].map(select=>({
      position:Number(select.dataset.position),team:select.value
    })).filter(p=>Number.isInteger(p.position)&&p.team);
    const old=STATE.groupPredictions.get(group)||{};
    const candidate=getGroupQualificationConfig().additionalQualificationPosition;
    const candidateTeam=positions.find(p=>Number(p.position)===Number(candidate))?.team;
    const additional=new Set(old.additionalQualifiedTeams||[]);
    const oldCandidate=old.positions?.find(p=>Number(p.position)===Number(candidate))?.team;
    if(oldCandidate&&oldCandidate!==candidateTeam) additional.delete(oldCandidate);
    STATE.groupPredictions.set(group,{
      group,
      positions,
      additionalQualifiedTeams:[...additional],
      manual:true
    });
  }

  function rerenderGroupPrediction(group) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, renderGroupPredictionSection, bindGroupPredictionSection } = ctx;
    const section=document.querySelector(`.group-prediction-section[data-group="${encodeURIComponent(group)}"]`);
    if(!section)return;
    const games=STATE.matches.filter(m=>!isKnockoutMatch(m)&&String(m.group||'').trim()===group);
    section.outerHTML=renderGroupPredictionSection(group,games);
    const fresh=document.querySelector(`.group-prediction-section[data-group="${encodeURIComponent(group)}"]`);
    if(fresh)bindGroupPredictionSection(fresh);
  }

  function refreshPredictedGroupForMatch(matchId) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, rerenderGroupPrediction } = ctx;
    const id = Number(matchId);
    const match = STATE.matches.find(m => Number(m.matchId) === id);
    if (!match || isKnockoutMatch(match)) return;

    const group = String(match.group || '').trim();
    if (!group) return;

    const rules = STATE.scoringRules?.groupQualificationRules;
    if (!Array.isArray(rules) || rules.length === 0) return;

    rerenderGroupPrediction(group);
  }

  function bindGroupPredictionSection(section) {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, getGroupQualificationConfig, getGlobalAdditionalQualifiedCount, refreshAllGroupThirdCounters, persistGroupPredictionFromDom, rerenderGroupPrediction } = ctx;
    section.querySelectorAll('.group-prediction-position-select').forEach(select=>{
      select.addEventListener('change',()=>{
        const duplicate=[...section.querySelectorAll('.group-prediction-position-select')].find(o=>o!==select&&o.value===select.value);
        if(duplicate) duplicate.value=select.dataset.previousValue||duplicate.value;
        persistGroupPredictionFromDom(section);
        rerenderGroupPrediction(decodeURIComponent(section.dataset.group||''));
      });
    });
    section.querySelectorAll('.group-third-qualifier').forEach(button=>{
      button.addEventListener('click',()=>{
        persistGroupPredictionFromDom(section);
        const group=decodeURIComponent(section.dataset.group||''), prediction=STATE.groupPredictions.get(group);
        if(!prediction)return;
        const team=button.dataset.team, selected=new Set(prediction.additionalQualifiedTeams||[]);
        const config=getGroupQualificationConfig(), limit=Number(config.additionalQualifiedCount||0);
        if(selected.has(team)) selected.delete(team);
        else {
          if(getGlobalAdditionalQualifiedCount()>=limit){toast(`Você já definiu ${limit} palpites de ${config.additionalQualificationPosition}º lugar classificados no campeonato.`,'warning');return;}
          selected.add(team);
        }
        prediction.additionalQualifiedTeams=[...selected];
         prediction.manual=true;
         STATE.groupPredictions.set(group,prediction);
        rerenderGroupPrediction(group);
        refreshAllGroupThirdCounters();
        toast(`${getGlobalAdditionalQualifiedCount()} de ${limit} palpites de ${config.additionalQualificationPosition}° lugar classificado${getGlobalAdditionalQualifiedCount()===1?'':'s'} definido${getGlobalAdditionalQualifiedCount()===1?'':'s'}.`,'success');
      });
    });
  }

  function bindAllGroupPredictionSections() {
      const { STATE, api, flagEmoji, $, toast, getBackendAlignedQualifier, getFrontendMatchPointStatus, getEffectiveBetWinner, calculateScoringMatchPoints, withFlag, flagOnly, renderTeamMedia, isKnockoutMatch, statusLabel, resultWinnerFromScore, parseMatchDate, formatMatchTimeLocal, formatMatchDateLocal, bindGroupPredictionSection } = ctx;
    document.querySelectorAll('.group-prediction-section').forEach(bindGroupPredictionSection);
  }

  return {
    renderFilterHeader,
    getGroupQualificationConfig,
    getGroupTeams,
    getPredictedResultForMatch,
    calculatePredictedGroupStandings,
    getSavedGroupPrediction,
    getAllAdditionalQualifiedTeams,
    getGlobalAdditionalQualifiedCount,
    refreshAllGroupThirdCounters,
    loadGroupPredictionPointsLive,
    renderGroupPredictionSection,
    persistGroupPredictionFromDom,
    rerenderGroupPrediction,
    refreshPredictedGroupForMatch,
    bindGroupPredictionSection,
    bindAllGroupPredictionSections,
  };
}
