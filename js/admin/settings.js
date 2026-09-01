import { api } from '../api.js';
import { flagEmoji } from '../flags.js';
import { toast, openModal, closeModal } from '../ui.js';
import { renderTeamMedia } from '../matches/matchesUtils.js';
import { DEFAULT_SCORING, DEFAULT_CHAMPIONSHIP_RULES, SAVE_LOCK_KEYS } from './adminConstants.js';
import { R, registerAdminFunctions } from './adminRuntime.js';
import { escapeHtml, knockoutDisplayLabel } from './adminUtils.js';

async function loadLeagueSettings() {
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  try {
    const res = await api.get(`/api/settings/global?leagueId=${leagueId}`);
    if (res?.success && res.data) {
      R.CurrentSettings.scoringRules = {
        ...DEFAULT_SCORING,
        groupQualificationRules: [],
        ...(res.data.scoringRules || {})
      };
      R.CurrentSettings.championshipRules = {
        ...DEFAULT_CHAMPIONSHIP_RULES,
        ...(res.data.championshipRules || {}),
        hasGroupPhase: res.data.championshipRules?.hasGroupPhase !== false
      };
      R.CurrentSettings.championshipResults = {
        topScorer: null, bestAttack: null, worstDefense: null, upset: null,
        ...(res.data.championshipResults || {})
      };
      R.CurrentSettings.podium = res.data.podium || [];
      R.CurrentSettings.prizeZone = {
        positions: 0,
        totalAmount: 0,
        distribution: [],
        ...(res.data.prizeZone || {})
      };
      R.CurrentSettings.rankingRules = {
        tieBreakers: [],
        ...(res.data.rankingRules || {})
      };
      R.CurrentSettings.payment = {
        pixKey: String(res.data.pixKey || ''),
        pixQrCode: String(res.data.pixQrCode || '')
      };
      R.CurrentSettings.betLockMode =
        res.data.betLockMode || R.CurrentSettings.betLockMode;
    }
  } catch (err) {
    console.warn('Erro ao carregar configurações da liga:', err);
  }
}

async function openBetReceiptValidationModal() {
  const existing = document.getElementById('bet-receipt-validation-modal');
  if (existing) {
    existing.classList.add('active');
    document.getElementById('bet-receipt-protocol')?.focus();
    return;
  }

  const modal = document.createElement('div');
  modal.id = 'bet-receipt-validation-modal';
  modal.className = 'modal active';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:620px;">
      <div class="modal-header">
        <h3><i class="fas fa-search"></i> Validar protocolo de aposta</h3>
        <button class="close-modal" type="button" aria-label="Fechar"
          onclick="document.getElementById('bet-receipt-validation-modal')?.remove()">&times;</button>
      </div>
      <div style="padding:10px 0;">
        <p style="color:#aaa;font-size:.82rem;margin:0 0 12px;">
          Informe o protocolo recebido pelo participante para verificar se ele corresponde
          à versão atualmente válida da aposta.
        </p>
        <div style="display:flex;gap:8px;">
          <input id="bet-receipt-protocol" type="text" autocomplete="off"
            placeholder="Ex.: KB26-20260901-A1B2C3D4E5"
            style="flex:1;padding:10px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.15);color:inherit;">
          <button id="btn-validate-bet-receipt" class="btn btn-primary" type="button">
            <i class="fas fa-search"></i> Consultar
          </button>
        </div>
        <div id="bet-receipt-result" style="margin-top:14px;"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const input = document.getElementById('bet-receipt-protocol');
  const result = document.getElementById('bet-receipt-result');
  const button = document.getElementById('btn-validate-bet-receipt');

  const renderResult = data => {
    const r = data?.receipt;
    const u = r?.user;
    const when = r?.createdAt ? new Date(r.createdAt).toLocaleString('pt-BR') : '-';
    const current = data?.currentProtocol || r?.protocol || '-';
    if (data?.status === 'current') {
      result.innerHTML = `
        <div style="padding:14px;border-radius:9px;border:1px solid rgba(46,204,113,.35);background:rgba(46,204,113,.08);">
          <div style="font-weight:800;color:#2ecc71;font-size:1rem;">✅ PROTOCOLO VÁLIDO E ATUAL</div>
          <div style="margin-top:9px;line-height:1.7;">
            <strong>Participante:</strong> ${escapeHtml(u?.name || 'Participante')}<br>
            <strong>E-mail:</strong> ${escapeHtml(u?.email || '-')}<br>
            <strong>Protocolo:</strong> ${escapeHtml(r.protocol)}<br>
            <strong>Versão:</strong> ${Number(r.version || 1)}<br>
            <strong>Emitido:</strong> ${escapeHtml(when)}
          </div>
        </div>`;
    } else {
      result.innerHTML = `
        <div style="padding:14px;border-radius:9px;border:1px solid rgba(241,196,15,.35);background:rgba(241,196,15,.08);">
          <div style="font-weight:800;color:#f1c40f;font-size:1rem;">⚠️ PROTOCOLO HISTÓRICO — NÃO É O ATUAL</div>
          <div style="margin-top:9px;line-height:1.7;">
            <strong>Participante:</strong> ${escapeHtml(u?.name || 'Participante')}<br>
            <strong>E-mail:</strong> ${escapeHtml(u?.email || '-')}<br>
            <strong>Protocolo consultado:</strong> ${escapeHtml(r.protocol)}<br>
            <strong>Versão:</strong> ${Number(r.version || 1)}<br>
            <strong>Emitido:</strong> ${escapeHtml(when)}<br>
            <div style="margin-top:10px;padding:9px;background:rgba(255,255,255,.05);border-radius:6px;">
              <strong>✅ Protocolo atual válido:</strong><br>
              <span style="font-family:monospace;font-weight:800;">${escapeHtml(current)}</span>
            </div>
          </div>
        </div>`;
    }
  };

  const validate = async () => {
    const protocol = String(input?.value || '').trim();
    if (!protocol) {
      result.innerHTML = '<div style="color:#e74c3c;">Informe um protocolo.</div>';
      return;
    }
    button.disabled = true;
    result.innerHTML = '<div style="color:#aaa;"><i class="fas fa-spinner fa-spin"></i> Consultando...</div>';
    try {
      const leagueId = localStorage.getItem('selectedLeagueId') || '1';
      const data = await api.get(`/api/admin/bet-receipts/validate?leagueId=${encodeURIComponent(leagueId)}&protocol=${encodeURIComponent(protocol)}`);
      renderResult(data);
    } catch (err) {
      if (err.status === 404) {
        result.innerHTML = `
          <div style="padding:14px;border-radius:9px;border:1px solid rgba(231,76,60,.35);background:rgba(231,76,60,.08);">
            <div style="font-weight:800;color:#e74c3c;">❌ PROTOCOLO NÃO ENCONTRADO</div>
            <div style="margin-top:7px;">Nenhum comprovante corresponde ao protocolo informado.</div>
          </div>`;
      } else {
        result.innerHTML = `<div style="color:#e74c3c;">${escapeHtml(err.message || 'Erro ao consultar protocolo.')}</div>`;
      }
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener('click', validate);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') validate(); });
  input.focus();
}

async function openBetLockModeModal() {
  const old = document.getElementById('bet-lock-mode-modal');
  if (old) old.remove();

  const current = R.CurrentSettings.betLockMode === 'match' ? 'match' : 'grade';

  const html = `
    <div id="bet-lock-mode-modal" class="modal active">
      <div class="modal-content" style="max-width: 430px;">
        <div class="modal-header">
          <h3>🔒 Bloqueio das Apostas</h3>
          <button class="close-modal"
                  onclick="closeModal('bet-lock-mode-modal')">&times;</button>
        </div>
        <div style="padding: 8px 0;">
          <p style="margin-top:0;">
            Escolha como as partidas serão bloqueadas automaticamente.
          </p>
          <label style="display:block; margin:14px 0; cursor:pointer;">
            <input type="radio" name="bet-lock-mode" value="grade"
                   ${current === 'grade' ? 'checked' : ''}>
            <strong>Por grade</strong>
            <span style="display:block; margin-left:24px; font-size:12px; opacity:.8;">
              Quando uma partida da grade começar, a grade inteira será bloqueada.
            </span>
          </label>
          <label style="display:block; margin:14px 0; cursor:pointer;">
            <input type="radio" name="bet-lock-mode" value="match"
                   ${current === 'match' ? 'checked' : ''}>
            <strong>Por partida</strong>
            <span style="display:block; margin-left:24px; font-size:12px; opacity:.8;">
              Cada partida será bloqueada somente no seu próprio horário.
            </span>
          </label>
        </div>
        <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn btn-secondary" onclick="closeModal('bet-lock-mode-modal')">Cancelar</button>
          <button class="btn btn-primary" onclick="saveBetLockMode()">Salvar</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
}

async function saveBetLockMode() {
  const selected =
    document.querySelector('input[name="bet-lock-mode"]:checked')?.value;

  if (!['grade', 'match'].includes(selected)) {
    toast('Selecione um modo de bloqueio válido.', 'error');
    return;
  }

  const leagueId =
    localStorage.getItem('selectedLeagueId') || '1';

  try {
    const res = await api.post('/api/settings/global', {
      leagueId,
      betLockMode: selected
    });

    if (!res?.success) {
      throw new Error(res?.message || 'Erro ao salvar modo de bloqueio.');
    }

    R.CurrentSettings.betLockMode = selected;
    toast(
      selected === 'match'
        ? 'Bloqueio definido por partida.'
        : 'Bloqueio definido por grade.',
      'success'
    );
    closeModal('bet-lock-mode-modal');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar modo de bloqueio.', 'error');
  }
}

async function openScoringRulesModal() {
  const old = document.getElementById('scoring-rules-modal');
  if (old) old.remove();

  const r = R.CurrentSettings.scoringRules || { ...DEFAULT_SCORING };
  const pp = Array.isArray(r.podiumPoints) ? r.podiumPoints : [20,15,10,5];
  const podiumSize = R.getConfiguredPodiumSize();
  const hasGroup = R.CurrentSettings.championshipRules?.hasGroupPhase !== false;
  const hasKnockout = R.CurrentSettings.championshipRules?.hasKnockoutPhase === true;

  const conditionOptions = [
    ['exactScore', 'Placar exato'],
    ['result', 'Resultado'],
    ['scoreTeamA', 'Gols do Time A'],
    ['scoreTeamB', 'Gols do Time B'],
    ['scoreWinner', 'Gols do vencedor'],
    ['scoreLoser', 'Gols do perdedor'],
    ['totalGoals', 'Total de gols'],
    ['goalDifference', 'Diferença de gols']
  ];

  const existingRules = Array.isArray(r.matchRules)
    ? r.matchRules
        .filter(rule => Array.isArray(rule?.conditions) && rule.conditions.length)
        .map(rule => ({
          points: Number(rule.points) || 0,
          conditions: [...new Set(rule.conditions)].filter(c =>
            conditionOptions.some(([key]) => key === c)
          )
        }))
    : [];

  window.__editingMatchRules = existingRules;

  const optionHtml = (selected) => conditionOptions
    .map(([value, label]) =>
      `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`
    ).join('');

  const renderRule = (rule, index) => {
    const conditions = Array.isArray(rule.conditions) && rule.conditions.length
      ? rule.conditions.filter(condition => condition !== 'qualifier')
      : [conditionOptions[0][0]];

    return `
      <div class="scoring-builder-rule" data-rule-index="${index}"
           style="background:rgba(0,0,0,.20); border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:10px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
          <strong style="font-size:.82rem; color:#ffda44;">Regra ${index + 1}</strong>
          <button type="button" class="btn btn-danger btn-remove-match-rule"
                  data-rule-index="${index}" style="padding:4px 8px; font-size:.72rem;">
            Remover
          </button>
        </div>

        <div class="form-row" style="align-items:flex-end;">
          <div class="form-group" style="flex:0 0 110px;">
            <label>Pontos</label>
            <input type="number" min="0" step="1" class="sr-rule-points"
                   value="${rule.points}" style="width:90px;">
          </div>

          <div class="form-group" style="flex:1;">
            <label>Condições <small style="color:#888;">(todas devem ser verdadeiras)</small></label>
            <div class="sr-rule-conditions">
              ${conditions.map((condition, conditionIndex) => `
                <div class="sr-condition-row" style="display:flex; gap:6px; margin-bottom:6px;">
                  <select class="sr-rule-condition" style="flex:1; min-width:0;">
                    ${optionHtml(condition)}
                  </select>
                  <button type="button" class="btn btn-secondary btn-remove-condition"
                          style="padding:4px 8px;" ${conditions.length === 1 ? 'disabled' : ''}>
                    ×
                  </button>
                </div>
              `).join('')}
            </div>
            <button type="button" class="btn btn-secondary btn-add-condition"
                    style="font-size:.72rem; padding:5px 8px;">
              + Condição
            </button>
          </div>
        </div>
      </div>
    `;
  };

  const initialRulesHtml = existingRules.length
    ? existingRules.map(renderRule).join('')
    : `<div id="match-rules-empty"
        style="padding:12px; text-align:center; color:#888; border:1px dashed rgba(255,255,255,.12); border-radius:8px;">
        Nenhuma regra criada. Adicione a primeira regra abaixo.
       </div>`;

  const html = `
    <div id="scoring-rules-modal" class="modal active">
      <div class="modal-content" style="max-width:620px;">
        <div class="modal-header">
          <h3>⚙️ Regras de Pontuação</h3>
          <button class="close-modal" onclick="closeModal('scoring-rules-modal')">&times;</button>
        </div>

        <form id="scoring-rules-form" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">

          <div style="background:linear-gradient(135deg,rgba(0,190,255,.08),rgba(120,70,255,.06)); padding:12px; border-radius:10px; border:1px solid rgba(0,210,255,.16);">
            <h4 style="margin:0 0 5px; color:#2ee8ff;">🎯 Regras das partidas</h4>
            <p style="margin:0 0 10px; color:#aaa; font-size:.72rem; line-height:1.45;">
               Primeiro defina em <b>Regras do Campeonato</b> quais fases e características existem.
               Depois configure aqui <b>o que pontua</b> dentro dessa estrutura.
               Dentro de uma regra, as condições são ligadas por <b>E</b>; regras diferentes funcionam como <b>OU</b>.
             </p>

            <div id="match-rules-builder">${initialRulesHtml}</div>

            <button type="button" id="btn-add-match-rule" class="btn btn-primary"
                    style="width:100%; margin-top:2px;">
              + Adicionar regra
            </button>

            <small style="display:block; color:#777; margin-top:7px;">
              Condições disponíveis:
              ${conditionOptions.map(([,label]) => label).join(' • ')}
            </small>
          </div>

          ${hasKnockout ? `
          <div id="match-extras-panel" style="background:linear-gradient(135deg,rgba(255,180,0,.08),rgba(0,190,255,.05)); padding:12px; border-radius:10px; border:1px solid rgba(255,190,0,.16);">
            <h4 style="margin:0 0 5px; color:#ffd34d;">🎯 Extras por partida do mata-mata</h4>
            <p style="margin:0 0 10px; color:#aaa; font-size:.72rem; line-height:1.45;">
              Estes extras são avaliados <b>em cada confronto</b> do mata-mata. A pontuação entra no total de <b>Mata-mata</b>.
            </p>
            <div class="form-group" style="max-width:180px; margin:0;">
              <label>Classificado</label>
              <input type="number" id="sr-match-extra-qualifier"
                     value="${r.matchExtras?.qualifier ?? 3}"
                     min="0" step="1"
                     style="width:100%; box-sizing:border-box;">
              <small style="display:block; color:#777; margin-top:5px;">Pontos por classificado acertado</small>
            </div>
          </div>
          ` : ''}

          ${hasGroup ? `
          <div id="group-qualification-extra-panel" style="background:linear-gradient(135deg,rgba(255,180,0,.08),rgba(0,190,255,.05)); padding:12px; border-radius:10px; border:1px solid rgba(255,190,0,.16);">
            <h4 style="margin:0 0 5px; color:#ffd34d;">🏆 Classificação da fase de grupos</h4>
            <p style="margin:0 0 10px; color:#aaa; font-size:.72rem; line-height:1.45;">
              Dentro de uma regra, as condições são ligadas por <b>E</b>.
              Regras diferentes funcionam como <b>OU</b>. A primeira regra satisfeita concede os pontos.
            </p>
            <div id="group-qualification-rules-builder"></div>
            <button type="button" id="btn-add-group-qualification-rule" class="btn btn-primary" style="width:100%; margin-top:2px;">
              + Adicionar regra
            </button>
            <small style="display:block; color:#777; margin-top:7px;">
              Condições: Posição correta • Posição incorreta${hasKnockout ? ' • Time classificado • Time não classificado' : ''}
            </small>
          </div>
          ` : ''}

          <div style="background:rgba(0,0,0,.20); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 8px; font-size:.85rem; color:#ffda44;">Pódio — ${podiumSize} ${podiumSize === 1 ? 'posição' : 'posições'}</h4>
            <div style="display:grid; grid-template-columns:repeat(${podiumSize},minmax(0,1fr)); gap:14px; align-items:start;">
              ${R.getPodiumFieldConfig().slice(0, podiumSize).map((field, index) => `
                <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                  <label style="min-height:2.2em; display:flex; align-items:flex-start;">${index + 1}º</label>
                  <input type="number" id="sr-podium-${index}" value="${pp[index] ?? [20,15,10,5][index]}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
                </div>
              `).join('')}
            </div>
          </div>

          <div style="background:rgba(0,0,0,.20); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 8px; font-size:.85rem; color:#ffda44;">Extras</h4>
            <div style="display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; align-items:start;">
              <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                <label style="min-height:2.8em; display:flex; align-items:flex-start;">Artilheiro</label>
                <input type="number" id="sr-topScorer" value="${r.topScorer ?? 10}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
              </div>
              <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                <label style="min-height:2.8em; display:flex; align-items:flex-start;">Melhor Ataque</label>
                <input type="number" id="sr-bestAttack" value="${r.bestAttack ?? 10}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
              </div>
              <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                <label style="min-height:2.8em; display:flex; align-items:flex-start;">Pior Defesa</label>
                <input type="number" id="sr-worstDefense" value="${r.worstDefense ?? 10}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
              </div>
              <div class="form-group" style="min-width:0; display:flex; flex-direction:column;">
                <label style="min-height:2.8em; display:flex; align-items:flex-start;">Zebra</label>
                <input type="number" id="sr-upset" value="${r.upset ?? 15}" min="0" style="width:100%; max-width:100%; box-sizing:border-box;">
              </div>
            </div>
          </div>

          <button type="submit" class="btn btn-success" style="width:100%; margin-top:8px;">
            <i class="fas fa-save"></i> Salvar Regras
          </button>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);

  const builder = document.getElementById('match-rules-builder');
  const addRuleButton = document.getElementById('btn-add-match-rule');

  // ============================================================
  // CONSTRUTOR — EXTRA: CLASSIFICAÇÃO PARA O MATA-MATA
  // ============================================================
  const groupQualificationBuilder = document.getElementById('group-qualification-rules-builder');
  const addGroupQualificationRuleButton = document.getElementById('btn-add-group-qualification-rule');

  const groupQualificationConditionOptions = [
    ['positionCorrect', 'Posição correta'],
    ['positionIncorrect', 'Posição incorreta'],
    ...(hasKnockout
      ? [
          ['teamQualified', 'Time classificado'],
          ['teamNotQualified', 'Time não classificado']
        ]
      : [])
  ];

  const existingGroupQualificationRules =
    Array.isArray(r.groupQualificationRules)
      ? r.groupQualificationRules
          .filter(rule => Array.isArray(rule?.conditions) && rule.conditions.length)
          .map(rule => ({
            points: Number(rule.points) || 0,
            conditions: [...new Set(rule.conditions)].filter(c =>
              groupQualificationConditionOptions.some(([key]) => key === c)
            )
          }))
          .filter(rule => rule.conditions.length)
      : [];

  const groupConditionOptionHtml = (selected) =>
    groupQualificationConditionOptions.map(([value,label]) =>
      `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`
    ).join('');

  const renderGroupQualificationRule = (rule,index) => {
    const conditions = Array.isArray(rule?.conditions) && rule.conditions.length
      ? rule.conditions : ['positionCorrect'];

    return `
      <div class="group-qualification-rule" data-rule-index="${index}"
           style="background:rgba(0,0,0,.20); border:1px solid rgba(255,255,255,.09); border-radius:10px; padding:10px; margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
          <strong style="font-size:.82rem;color:#ffda44;">Regra ${index+1}</strong>
          <button type="button" class="btn btn-danger btn-remove-group-qualification-rule" style="padding:4px 8px;font-size:.72rem;">Remover</button>
        </div>
        <div class="form-row" style="align-items:flex-end;">
          <div class="form-group" style="flex:0 0 110px;">
            <label>Pontos</label>
            <input type="number" min="0" step="1" class="gqr-rule-points" value="${rule?.points ?? 0}" style="width:90px;">
          </div>
          <div class="form-group" style="flex:1;">
            <label>Condições <small style="color:#888;">(todas devem ser verdadeiras)</small></label>
            <div class="gqr-rule-conditions">
              ${conditions.map(condition => `
                <div class="gqr-condition-row" style="display:flex;gap:6px;margin-bottom:6px;">
                  <select class="gqr-rule-condition" style="flex:1;min-width:0;">${groupConditionOptionHtml(condition)}</select>
                  <button type="button" class="btn btn-secondary btn-remove-gqr-condition" style="padding:4px 8px;" ${conditions.length===1?'disabled':''}>×</button>
                </div>`).join('')}
            </div>
            <button type="button" class="btn btn-secondary btn-add-gqr-condition" style="font-size:.72rem;padding:5px 8px;">+ Condição</button>
          </div>
        </div>
      </div>`;
  };

  const refreshGroupQualificationRuleNumbers = () => {
    groupQualificationBuilder?.querySelectorAll('.group-qualification-rule').forEach((el,i) => {
      el.dataset.ruleIndex=i;
      const title=el.querySelector('strong');
      if(title) title.textContent=`Regra ${i+1}`;
    });
  };

  const bindGroupQualificationRule = (ruleEl) => {
    const updateRemoveButtons=()=>{
      const buttons=ruleEl.querySelectorAll('.btn-remove-gqr-condition');
      buttons.forEach(btn=>btn.disabled=buttons.length<=1);
    };

    ruleEl.querySelector('.btn-add-gqr-condition')?.addEventListener('click',()=>{
      const wrapper=ruleEl.querySelector('.gqr-rule-conditions');
      const row=document.createElement('div');
      row.className='gqr-condition-row';
      row.style.cssText='display:flex;gap:6px;margin-bottom:6px;';
      row.innerHTML=`
        <select class="gqr-rule-condition" style="flex:1;min-width:0;">${groupConditionOptionHtml('positionCorrect')}</select>
        <button type="button" class="btn btn-secondary btn-remove-gqr-condition" style="padding:4px 8px;">×</button>`;
      wrapper.appendChild(row);
      row.querySelector('.btn-remove-gqr-condition').addEventListener('click',()=>{
        row.remove(); updateRemoveButtons();
      });
      updateRemoveButtons();
    });

    ruleEl.querySelectorAll('.btn-remove-gqr-condition').forEach(btn=>{
      btn.addEventListener('click',()=>{
        btn.closest('.gqr-condition-row')?.remove(); updateRemoveButtons();
      });
    });

    ruleEl.querySelector('.btn-remove-group-qualification-rule')?.addEventListener('click',()=>{
      ruleEl.remove(); refreshGroupQualificationRuleNumbers();
    });
    updateRemoveButtons();
  };

  if(groupQualificationBuilder){
    groupQualificationBuilder.innerHTML=existingGroupQualificationRules.length
      ? existingGroupQualificationRules.map(renderGroupQualificationRule).join('')
      : `<div class="gqr-empty" style="padding:12px;text-align:center;color:#888;border:1px dashed rgba(255,255,255,.12);border-radius:8px;">Nenhuma regra criada. Adicione a primeira regra abaixo.</div>`;

    groupQualificationBuilder.querySelectorAll('.group-qualification-rule').forEach(bindGroupQualificationRule);

    addGroupQualificationRuleButton?.addEventListener('click',()=>{
      groupQualificationBuilder.querySelector('.gqr-empty')?.remove();
      const index=groupQualificationBuilder.querySelectorAll('.group-qualification-rule').length;
      const temp=document.createElement('div');
      temp.innerHTML=renderGroupQualificationRule({points:0,conditions:['positionCorrect']},index);
      const created=temp.firstElementChild;
      groupQualificationBuilder.appendChild(created);
      bindGroupQualificationRule(created);
      refreshGroupQualificationRuleNumbers();
    });
  }

  const refreshRuleNumbers = () => {
    builder.querySelectorAll('.scoring-builder-rule').forEach((ruleEl, index) => {
      ruleEl.dataset.ruleIndex = index;
      const title = ruleEl.querySelector('strong');
      if (title) title.textContent = `Regra ${index + 1}`;
      ruleEl.querySelector('.btn-remove-match-rule')?.setAttribute('data-rule-index', index);
      ruleEl.querySelectorAll('.sr-rule-condition').forEach(select => {
        select.name = `rule-${index}-condition`;
      });
    });
  };

  const bindConditionButtons = (ruleEl) => {
    const add = ruleEl.querySelector('.btn-add-condition');
    add?.addEventListener('click', () => {
      const wrapper = ruleEl.querySelector('.sr-rule-conditions');
      const row = document.createElement('div');
      row.className = 'sr-condition-row';
      row.style.cssText = 'display:flex; gap:6px; margin-bottom:6px;';
      row.innerHTML = `
        <select class="sr-rule-condition" style="flex:1; min-width:0;">
          ${optionHtml(conditionOptions[0][0])}
        </select>
        <button type="button" class="btn btn-secondary btn-remove-condition" style="padding:4px 8px;">×</button>
      `;
      wrapper.appendChild(row);
      refreshRuleNumbers();
      updateRemoveConditionState(ruleEl);
      row.querySelector('.btn-remove-condition')?.addEventListener('click', () => {
        row.remove();
        updateRemoveConditionState(ruleEl);
      });
    });

    ruleEl.querySelectorAll('.btn-remove-condition').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.sr-condition-row')?.remove();
        updateRemoveConditionState(ruleEl);
      });
    });
  };

  const updateRemoveConditionState = (ruleEl) => {
    const buttons = ruleEl.querySelectorAll('.btn-remove-condition');
    buttons.forEach(btn => { btn.disabled = buttons.length <= 1; });
  };

  const bindRule = (ruleEl) => {
    bindConditionButtons(ruleEl);
    updateRemoveConditionState(ruleEl);
    ruleEl.querySelector('.btn-remove-match-rule')?.addEventListener('click', () => {
      ruleEl.remove();
      const empty = document.getElementById('match-rules-empty');
      if (!builder.querySelector('.scoring-builder-rule') && !empty) {
        builder.innerHTML = `<div id="match-rules-empty" style="padding:12px; text-align:center; color:#888; border:1px dashed rgba(255,255,255,.12); border-radius:8px;">Nenhuma regra criada. Adicione a primeira regra abaixo.</div>`;
      }
      refreshRuleNumbers();
    });
  };

  builder.querySelectorAll('.scoring-builder-rule').forEach(bindRule);

  addRuleButton?.addEventListener('click', () => {
    const empty = document.getElementById('match-rules-empty');
    if (empty) empty.remove();

    const index = builder.querySelectorAll('.scoring-builder-rule').length;

    // Cria exatamente um elemento da regra. A versão anterior criava um
    // wrapper vazio, renderizava a regra duas vezes e depois fazia replaceWith,
    // o que podia deixar o listener do botão inconsistente em alguns browsers.
    const temp = document.createElement('div');
    temp.innerHTML = renderRule(
      { points: 0, conditions: [conditionOptions[0][0]] },
      index
    ).trim();

    const created = temp.firstElementChild;
    if (!created) {
      console.error('Não foi possível criar a nova regra de pontuação.');
      return;
    }

    builder.appendChild(created);
    bindRule(created);
    refreshRuleNumbers();
  });

  document.getElementById('scoring-rules-form')?.addEventListener('submit', R.saveScoringRules);
}

async function saveScoringRules(e) {
  e.preventDefault();
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';
  const builder = document.getElementById('match-rules-builder');

  const matchRules = [...builder.querySelectorAll('.scoring-builder-rule')].map(ruleEl => {
    const conditions = [...ruleEl.querySelectorAll('.sr-rule-condition')]

      .map(select => select.value)
      .filter(Boolean);

    return {
      points: Math.max(0, Number(ruleEl.querySelector('.sr-rule-points')?.value || 0)),
      conditions: [...new Set(conditions)].filter(condition => condition !== 'qualifier')
    };
  }).filter(rule => rule.points > 0 && rule.conditions.length > 0);

  const groupQualificationRules = [...(document.getElementById('group-qualification-rules-builder')?.querySelectorAll('.group-qualification-rule') || [])]
    .map(ruleEl => ({
      points: Math.max(0, Number(ruleEl.querySelector('.gqr-rule-points')?.value || 0)),
      conditions: [...new Set(
        [...ruleEl.querySelectorAll('.gqr-rule-condition')].map(select => select.value).filter(Boolean)
      )]
    }))
    .filter(rule => rule.points > 0 && rule.conditions.length > 0);

  const groupQualification = R.CurrentSettings.championshipRules?.groupQualification || {};
  const validGroupQualificationConfig =
    Number(groupQualification.totalTeams) > 0 &&
    Number(groupQualification.groupCount) > 0 &&
    Number(groupQualification.totalQualified) > 0 &&
    Number(groupQualification.totalTeams) % Number(groupQualification.groupCount) === 0 &&
    Number(groupQualification.totalQualified) <= Number(groupQualification.totalTeams);

  const qualificationStatusRules = groupQualificationRules.some(rule =>
    rule.conditions.includes('teamQualified') ||
    rule.conditions.includes('teamNotQualified')
  );

  if (qualificationStatusRules && (
    R.CurrentSettings.championshipRules?.hasGroupPhase === false ||
    R.CurrentSettings.championshipRules?.hasKnockoutPhase !== true ||
    !validGroupQualificationConfig
  )) {
    toast(
      '“Time classificado” e “Time não classificado” exigem fase de grupos + mata-mata e uma estrutura de grupos válida.',
      'error'
    );
    return;
  }

  const scoringRules = {
    // Mantém as configurações atuais, mas Classificado pertence exclusivamente a matchExtras.
    ...(R.CurrentSettings.scoringRules || {}),
    matchRules: matchRules.filter(rule =>
      !rule.conditions.includes('qualifier')
    ),
    matchExtras: {
      qualifier: Math.max(
        0,
        Number(document.getElementById('sr-match-extra-qualifier')?.value || 0)
      )
    },
    groupQualificationRules,
    podiumPoints: Array.from({ length: R.getConfiguredPodiumSize() }, (_, index) =>
      Number(document.getElementById(`sr-podium-${index}`)?.value || 0)
    ),
    topScorer: Number(document.getElementById('sr-topScorer').value) || 0,
    bestAttack: Number(document.getElementById('sr-bestAttack').value) || 0,
    worstDefense: Number(document.getElementById('sr-worstDefense').value) || 0,
    upset: Number(document.getElementById('sr-upset').value) || 0
  };

  try {
    const res = await api.post('/api/settings/global', {
      leagueId,
      scoringRules,
      // A pontuação é consequência da estrutura definida no campeonato.
      championshipRules: R.CurrentSettings.championshipRules || {}
    });

    if (!res?.success) throw new Error(res?.message || 'Erro ao salvar');

    R.CurrentSettings.scoringRules = res.data?.scoringRules || scoringRules;
    toast('Regras de pontuação salvas!', 'success');
    closeModal('scoring-rules-modal');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar regras', 'error');
  }
}

registerAdminFunctions({loadLeagueSettings: loadLeagueSettings, openBetReceiptValidationModal: openBetReceiptValidationModal, openBetLockModeModal: openBetLockModeModal, saveBetLockMode: saveBetLockMode, openScoringRulesModal: openScoringRulesModal, saveScoringRules: saveScoringRules});
