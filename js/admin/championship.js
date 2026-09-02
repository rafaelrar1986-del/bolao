import { api } from '../api.js';
import { flagEmoji } from '../flags.js';
import { toast, openModal, closeModal } from '../ui.js';
import { renderTeamMedia } from '../matches/matchesUtils.js';
import { DEFAULT_SCORING, DEFAULT_CHAMPIONSHIP_RULES, SAVE_LOCK_KEYS } from './adminConstants.js';
import { R, registerAdminFunctions } from './adminRuntime.js';
import { escapeHtml, knockoutDisplayLabel } from './adminUtils.js';

async function openChampionshipRulesModal() {
  const old = document.getElementById('championship-rules-modal');
  if (old) old.remove();

  const cr = {
    ...DEFAULT_CHAMPIONSHIP_RULES,
    ...(R.CurrentSettings.championshipRules || {})
  };

  const prize = {
    positions: 0,
    totalAmount: 0,
    distribution: [],
    ...(R.CurrentSettings.prizeZone || {})
  };

  const ranking = R.CurrentSettings.rankingRules || { tieBreakers: [] };
  const sr = R.CurrentSettings.scoringRules || DEFAULT_SCORING;

  const getAvailableTieBreakers = () => {
    const knockoutEnabled =
      document.getElementById('cr-hasKnockoutPhase')?.checked ??
      (cr.hasKnockoutPhase === true);

    return [
      {
        value: 'exactScorePoints',
        label: 'Maior pontuação em placar exato',
        available: Number(sr.exactScore || 0) > 0
      },
      {
        value: 'podiumPoints',
        label: 'Maior pontuação em pódio',
        available: Array.isArray(sr.podiumPoints) &&
          sr.podiumPoints.some(value => Number(value) > 0)
      },
      {
        value: 'extraPoints',
        label: 'Maior pontuação em Extras',
        available: [
          'topScorer',
          'bestAttack',
          'worstDefense',
          'upset'
        ].some(key => Number(sr[key] || 0) > 0)
      },
      {
        value: 'knockoutPoints',
        label: 'Maior pontuação em mata-mata',
        available: knockoutEnabled
      }
    ].filter(item => item.available);
  };

  const selectedTieBreakers = Array.isArray(ranking.tieBreakers)
    ? ranking.tieBreakers.filter(value =>
        getAvailableTieBreakers().some(item => item.value === value)
      ).slice(0, 3)
    : [];

  const distributionMap = new Map(
    (Array.isArray(prize.distribution) ? prize.distribution : [])
      .map(item => [
        Number(item.position),
        Number(item.percentage || 0)
      ])
  );

  const html = `
    <div id="championship-rules-modal" class="modal active">
      <div class="modal-content" style="max-width: 560px;">
        <div class="modal-header">
          <h3>🏆 Regras do Campeonato</h3>
          <button class="close-modal" onclick="closeModal('championship-rules-modal')">&times;</button>
        </div>

        <form id="championship-rules-form"
              style="display:flex; flex-direction:column; gap:14px; margin-top:10px;">

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">⚽ Estrutura do Campeonato</h4>

            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="cr-hasGroupPhase" ${cr.hasGroupPhase !== false ? 'checked' : ''}>
              <strong>Este campeonato possui fase de grupos</strong>
            </label>

            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px;">
              <input type="checkbox" id="cr-hasKnockoutPhase" ${cr.hasKnockoutPhase ? 'checked' : ''}>
              <strong>Este campeonato possui fase de mata-mata</strong>
            </label>

            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px;">
              <input type="checkbox" id="cr-hasThirdPlaceMatch" ${cr.hasThirdPlaceMatch !== false ? 'checked' : ''}>
              <strong>Possui partida pelo 3º lugar</strong>
            </label>
            <small style="display:block; margin-top:5px; color:#888;">A fase é criada com o nome fixo <strong>3º lugar</strong> e só se aplica ao mata-mata.</small>
            <small style="display:block; margin-top:5px; color:#888;">
              Se nenhuma das duas fases existir, o campeonato será tratado automaticamente como <strong>pontos corridos</strong>.
            </small>

            <div id="cr-points-run-structure-panel" style="margin-top:14px; padding:10px; border-radius:9px; border:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.12);">
              <strong style="display:block; color:#ffda44; margin-bottom:8px;">📋 Estrutura de pontos corridos</strong>
              <small style="display:block; color:#888; margin-bottom:10px;">Usada quando este campeonato não possui fase de grupos nem mata-mata.</small>
              <div class="form-row">
                <div class="form-group">
                  <label>Total de times</label>
                  <input type="number" id="cr-pointsRunTotalTeams" value="${Number(cr.pointsRun?.totalTeams) || 0}" min="0" step="1" placeholder="Ex.: 20">
                </div>
                <div class="form-group">
                  <label>Confrontos</label>
                  <select id="cr-pointsRunLegs">
                    <option value="1" ${Number(cr.pointsRun?.legs || 1) === 1 ? 'selected' : ''}>Turno único</option>
                    <option value="2" ${Number(cr.pointsRun?.legs || 1) === 2 ? 'selected' : ''}>Turno e returno</option>
                  </select>
                </div>
              </div>
            </div>

            <div id="cr-group-structure-panel" style="margin-top:14px; padding:10px; border-radius:9px; border:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.12);">
              <strong style="display:block; color:#ffda44; margin-bottom:8px;">📊 Estrutura da fase de grupos</strong>
              <small style="display:block; color:#888; margin-bottom:10px;">
                Informe os valores reais deste campeonato.
              </small>
              <div class="form-row">
                <div class="form-group">
                  <label>Total de times</label>
                  <input type="number" id="cr-totalTeams"
                         value="${Number(cr.groupQualification?.totalTeams) || 0}"
                         min="0" step="1" placeholder="Ex.: 48">
                </div>
                <div class="form-group">
                  <label>Número de grupos</label>
                  <input type="number" id="cr-groupCount"
                         value="${Number(cr.groupQualification?.groupCount) || 0}"
                         min="0" step="1" placeholder="Ex.: 12">
                </div>
                <div class="form-group" id="cr-totalQualified-group" style="${cr.hasKnockoutPhase ? '' : 'display:none;'}">
                  <label>Classificados para o mata-mata</label>
                  <input type="number" id="cr-totalQualified"
                         value="${Number(cr.groupQualification?.totalQualified) || 0}"
                         min="0" step="1" placeholder="Ex.: 32">
                </div>
              </div>

              <div class="form-group" style="margin-top:10px;">
                <label>Confrontos entre os times</label>
                <select id="cr-group-legs">
                  <option value="1" ${Number(cr.groupQualification?.legs || 1) === 1 ? 'selected' : ''}>
                    Turno único — cada time enfrenta os outros 1 vez
                  </option>
                  <option value="2" ${Number(cr.groupQualification?.legs || 1) === 2 ? 'selected' : ''}>
                    Turno e returno — cada time enfrenta os outros 2 vezes
                  </option>
                </select>
                <small style="display:block; margin-top:5px; color:#888;">
                  Usado para determinar dinamicamente quando cada grupo termina.
                </small>
              </div>

              <div id="cr-group-qualification-summary" style="font-size:.78rem; color:#aaa; margin-top:6px;"></div>
            </div>

            <div id="cr-knockout-structure-panel" style="margin-top:14px; padding:10px; border-radius:9px; border:1px solid rgba(255,255,255,.08); background:rgba(0,0,0,.12);">
              <strong style="display:block; color:#ffda44; margin-bottom:8px;">🏆 Estrutura do mata-mata</strong>
              <div class="form-group">
                <label>Formato dos confrontos</label>
                <select id="cr-knockout-format">
                  <option value="single" ${cr.knockoutFormat !== 'home_away' ? 'selected' : ''}>Jogo único</option>
                  <option value="home_away" ${cr.knockoutFormat === 'home_away' ? 'selected' : ''}>Ida e volta</option>
                </select>
              </div>
              <div id="cr-knockout-final-format-wrap" style="margin-top:10px; ${cr.knockoutFormat === 'home_away' ? '' : 'display:none;'}">
                <label>Formato da final</label>
                <select id="cr-knockout-final-format">
                  <option value="home_away" ${(cr.knockoutFinalFormat || 'single') !== 'single' ? 'selected' : ''}>Ida e volta</option>
                  <option value="single" ${cr.knockoutFinalFormat === 'single' ? 'selected' : ''}>Jogo único</option>
                </select>
                <small style="display:block; margin-top:5px; color:#888;">
                  Disponível somente quando o formato geral é ida e volta.
                </small>
              </div>
              <div id="cr-knockout-away-goals-wrap" style="margin-top:10px; ${cr.knockoutFormat === 'home_away' ? '' : 'display:none;'}">
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                  <input type="checkbox" id="cr-knockout-away-goals" ${cr.knockoutAwayGoals ? 'checked' : ''}>
                  <span>Utilizar critério de gol fora de casa</span>
                </label>
                <small style="display:block; margin-top:5px; color:#888;">Usado somente se o agregado terminar empatado.</small>
              </div>
              <small style="display:block; margin-top:8px; color:#888;">Em ida e volta, o palpite de classificado pertence ao confronto e vale uma única vez.</small>
            </div>

            <div id="cr-championship-type" style="margin-top:12px; padding:9px 10px; border-radius:8px; background:rgba(0,102,179,.12); border:1px solid rgba(0,102,179,.25); font-size:.86rem;"></div>
          </div>

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">⚙️ Configurações do Campeonato</h4>

            <div class="form-group">
              <label>Tamanho do Pódio</label>
              <select id="cr-podiumSize">
                <option value="4" ${Number(cr.podiumSize) === 4 ? 'selected' : ''}>4 posições (1º ao 4º)</option>
                <option value="3" ${Number(cr.podiumSize) === 3 ? 'selected' : ''}>3 posições (1º ao 3º)</option>
                <option value="2" ${Number(cr.podiumSize) === 2 ? 'selected' : ''}>2 posições (1º e 2º)</option>
                <option value="1" ${Number(cr.podiumSize) === 1 ? 'selected' : ''}>1 posição (somente 1º)</option>
              </select>
            </div>

            <div style="margin-top:12px;">
              <label style="display:block; margin-bottom:7px; font-weight:600;">Período considerado na validação dos palpites</label>
              <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer; margin-bottom:6px;">
                <input type="radio" name="cr-bet-validation-period" value="90" ${!cr.drawIncludesExtraTime ? 'checked' : ''}>
                <span>90 minutos (tempo regulamentar)</span>
              </label>
              <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
                <input type="radio" name="cr-bet-validation-period" value="extra" ${cr.drawIncludesExtraTime ? 'checked' : ''}>
                <span>Após a prorrogação</span>
              </label>
              <small style="display:block; margin-top:6px; color:#888;">Define qual período será usado para validar o resultado e o placar do palpite.</small>
            </div>

            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:12px;">
              <input type="checkbox" id="cr-winnerFromScore" ${cr.winnerFromScore !== false ? 'checked' : ''}>
              <span>Vencedor deriva do placar</span>
            </label>
          </div>

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">💰 Pagamento / PIX</h4>
            <small style="display:block; color:#888; margin-bottom:10px;">
              Configure o pagamento deste campeonato. O QR Code e a chave PIX são exclusivos desta liga.
            </small>

            <div class="form-group">
              <label>Chave PIX</label>
              <input type="text" id="cr-pixKey"
                     value="${String(R.CurrentSettings.payment?.pixKey || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}"
                     maxlength="200" placeholder="Digite a chave PIX">
            </div>

            <div style="margin-top:12px;">
              <label style="display:block; margin-bottom:7px; font-weight:600;">QR Code PIX</label>
              <div id="cr-pix-preview"
                   style="min-height:150px; display:flex; align-items:center; justify-content:center; border:1px dashed rgba(255,255,255,.18); border-radius:8px; padding:10px; background:rgba(0,0,0,.12);">
                ${R.CurrentSettings.payment?.pixQrCode
                  ? `<img src="${R.CurrentSettings.payment.pixQrCode}" alt="QR Code PIX" style="max-width:180px; max-height:180px; object-fit:contain;">`
                  : '<span style="color:#888;">Nenhum QR Code configurado</span>'}
              </div>

              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:9px;">
                <label class="btn btn-outline-secondary" style="margin:0; cursor:pointer;">
                  📷 Tirar foto
                  <input type="file" id="cr-pix-camera" accept="image/*" capture="environment" style="display:none;">
                </label>
                <label class="btn btn-outline-secondary" style="margin:0; cursor:pointer;">
                  🖼️ Enviar imagem
                  <input type="file" id="cr-pix-upload" accept="image/png,image/jpeg,image/webp" style="display:none;">
                </label>
                <button type="button" id="cr-pix-clear" class="btn btn-outline-danger" style="display:${R.CurrentSettings.payment?.pixQrCode ? '' : 'none'};">
                  Remover QR
                </button>
              </div>
              <small style="display:block; margin-top:7px; color:#888;">
                A imagem será redimensionada antes de ser armazenada no campeonato.
              </small>
            </div>
          </div>

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">🏆 Zona de Premiação</h4>

            <div class="form-row">
              <div class="form-group">
                <label>Número de posições premiadas</label>
                <input type="number" id="pz-positions"
                       value="${Number(prize.positions) || 0}"
                       min="0" max="50" step="1">
              </div>

              <div class="form-group">
                <label>Valor total da premiação</label>
                <input type="number" id="pz-totalAmount"
                       value="${Number(prize.totalAmount) || 0}"
                       min="0" step="0.01" placeholder="0,00">
              </div>
            </div>

            <div id="pz-distribution" style="display:flex; flex-direction:column; gap:7px; margin-top:8px;"></div>
            <div id="pz-distribution-total" style="font-size:.78rem; margin-top:7px; color:#aaa;"></div>
          </div>

          <div style="background:rgba(0,0,0,.18); padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,.08);">
            <h4 style="margin:0 0 10px; color:#ffda44;">⚖️ Critérios de Desempate</h4>

            <div class="form-group">
              <label>Número de critérios de desempate</label>
              <select id="tr-count">
                <option value="0" ${selectedTieBreakers.length === 0 ? 'selected' : ''}>0 — nenhum</option>
                <option value="1" ${selectedTieBreakers.length === 1 ? 'selected' : ''}>1 critério</option>
                <option value="2" ${selectedTieBreakers.length === 2 ? 'selected' : ''}>2 critérios</option>
                <option value="3" ${selectedTieBreakers.length === 3 ? 'selected' : ''}>3 critérios</option>
              </select>
            </div>

            <div id="tr-selects" style="display:flex; flex-direction:column; gap:8px;"></div>
            <small style="display:block; margin-top:7px; color:#888;">
              A ordem define a prioridade: o 1º critério é mais importante que o 2º, e assim por diante.
              Se todos os critérios empatarem, o empate permanece.
            </small>
          </div>

          <button type="submit" class="btn btn-success" style="width:100%;">
            <i class="fas fa-save"></i> Salvar Regras do Campeonato
          </button>
        </form>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);

  const updateChampionshipType = () => {
    const hasGroupPhase = document.getElementById('cr-hasGroupPhase')?.checked === true;
    const hasKnockoutPhase = document.getElementById('cr-hasKnockoutPhase')?.checked === true;
    const target = document.getElementById('cr-championship-type');
    const pointsRunPanel = document.getElementById('cr-points-run-structure-panel');
    const groupPanel = document.getElementById('cr-group-structure-panel');
    const knockoutPanel = document.getElementById('cr-knockout-structure-panel');
    if (pointsRunPanel) pointsRunPanel.style.display = (!hasGroupPhase && !hasKnockoutPhase) ? '' : 'none';
    if (groupPanel) groupPanel.style.display = hasGroupPhase ? '' : 'none';
    if (knockoutPanel) knockoutPanel.style.display = hasKnockoutPhase ? '' : 'none';
    const thirdPlace = document.getElementById('cr-hasThirdPlaceMatch')?.closest('label');
    if (thirdPlace) thirdPlace.style.display = hasKnockoutPhase ? '' : 'none';
    if (!target) return;

    let label = '🏁 Tipo do campeonato: <strong>Pontos corridos</strong>';
    if (hasGroupPhase && hasKnockoutPhase) {
      label = '🏆 Tipo do campeonato: <strong>Grupos + Mata-mata</strong>';
    } else if (hasGroupPhase) {
      label = '⚽ Tipo do campeonato: <strong>Fase de grupos</strong>';
    } else if (hasKnockoutPhase) {
      label = '🥊 Tipo do campeonato: <strong>Mata-mata</strong>';
    }
    target.innerHTML = label;
    // Atualiza também o resumo estrutural, inclusive ao editar os campos
    // exclusivos de pontos corridos.
    if (typeof updateGroupQualificationSummary === 'function') {
      updateGroupQualificationSummary();
    }
  };

  const updateGroupQualificationSummary = () => {
    const hasGroupPhase = document.getElementById('cr-hasGroupPhase')?.checked === true;
    const hasKnockoutPhase = document.getElementById('cr-hasKnockoutPhase')?.checked === true;
    const panel = document.getElementById('cr-group-structure-panel');
    const qualifiedGroup = document.getElementById('cr-totalQualified-group');
    const target = document.getElementById('cr-group-qualification-summary');

    if (panel) panel.style.display = hasGroupPhase ? '' : 'none';
    if (qualifiedGroup) qualifiedGroup.style.display = hasGroupPhase && hasKnockoutPhase ? '' : 'none';

    if (!hasGroupPhase) {
      if (hasKnockoutPhase) {
        if (target) target.textContent = 'Este campeonato possui somente fase de mata-mata.';
      } else {
        const prTeams = Number(document.getElementById('cr-pointsRunTotalTeams')?.value || 0);
        const prLegs = Number(document.getElementById('cr-pointsRunLegs')?.value || 1) === 2 ? 2 : 1;
        const expected = prTeams >= 2 ? (prTeams * (prTeams - 1) / 2) * prLegs : 0;
        if (target) target.textContent = prTeams >= 2
          ? `${prTeams} times • ${prLegs === 2 ? 'turno e returno' : 'turno único'} • ${expected} partidas no campeonato • pontos corridos.`
          : 'Informe o número de times para pontos corridos.';
      }
      return;
    }

    const total = Number(document.getElementById('cr-totalTeams')?.value || 0);
    const groups = Number(document.getElementById('cr-groupCount')?.value || 0);
    const qualified = Number(document.getElementById('cr-totalQualified')?.value || 0);
    const legs = Number(document.getElementById('cr-group-legs')?.value || 1) === 2 ? 2 : 1;

    if (!total || !groups || (hasKnockoutPhase && !qualified)) {
      if (target) target.textContent = hasKnockoutPhase
        ? 'Preencha total de times, número de grupos e classificados para o mata-mata.'
        : 'Preencha total de times e número de grupos.';
      return;
    }
    if (total % groups !== 0) {
      target.textContent = '⚠️ O total de times deve ser divisível pelo número de grupos.';
      return;
    }
    if (hasKnockoutPhase && qualified > total) {
      target.textContent = '⚠️ O número de classificados não pode ser maior que o total de times.';
      return;
    }

    if (!hasKnockoutPhase) {
      const teamsPerGroup = total / groups;
      const expected = teamsPerGroup >= 2
        ? (teamsPerGroup * (teamsPerGroup - 1) / 2) * legs
        : 0;
      target.textContent =
        `${teamsPerGroup} times por grupo • ${legs === 2 ? 'turno e returno' : 'turno único'} • ` +
        `${expected} partidas por grupo • fase de grupos sem mata-mata.`;
      return;
    }

    const teamsPerGroup = total / groups;
    const direct = Math.floor(qualified / groups);
    const additional = qualified % groups;
    if (direct > teamsPerGroup || (additional > 0 && direct >= teamsPerGroup)) {
      target.textContent = '⚠️ Essa configuração não permite distribuir os classificados entre os grupos.';
      return;
    }
    const extraPosition = additional > 0 ? direct + 1 : null;
    const expected = teamsPerGroup >= 2
      ? (teamsPerGroup * (teamsPerGroup - 1) / 2) * legs
      : 0;
    target.textContent =
      `${teamsPerGroup} times por grupo • ${legs === 2 ? 'turno e returno' : 'turno único'} • ` +
      `${expected} partidas por grupo • ${direct} classificados por grupo` +
      (additional > 0
        ? ` • ${additional} classificados adicionais entre os ${extraPosition}º colocados`
        : ' • sem classificados adicionais');
  };
  ['cr-totalTeams','cr-groupCount','cr-totalQualified','cr-group-legs'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateGroupQualificationSummary);
  });
  updateGroupQualificationSummary();
  updateChampionshipType();

  const distribution = document.getElementById('pz-distribution');
  const distributionTotal = document.getElementById('pz-distribution-total');

  function renderDistribution() {
    const count = Math.max(
      0,
      Math.min(50, Number(document.getElementById('pz-positions')?.value || 0))
    );

    const oldValues = Array.from(
      distribution.querySelectorAll('input[data-prize-position]')
    ).map(input => [
      Number(input.dataset.prizePosition),
      input.value
    ]);

    const oldMap = new Map(oldValues);
    distribution.innerHTML = '';

    for (let i = 1; i <= count; i++) {
      const value =
        oldMap.get(i) ??
        distributionMap.get(i) ??
        '';

      distribution.insertAdjacentHTML('beforeend', `
        <div style="display:flex; align-items:center; gap:8px;">
          <strong style="width:38px;">${i}º</strong>
          <input type="number"
                 data-prize-position="${i}"
                 min="0" max="100" step="0.01"
                 value="${value}"
                 placeholder="%"
                 style="flex:1;">
          <span style="font-size:.78rem; color:#888;">%</span>
        </div>
      `);
    }

    updateDistributionTotal();
  }

  function updateDistributionTotal() {
    const values = Array.from(
      distribution.querySelectorAll('input[data-prize-position]')
    ).map(input => Number(input.value || 0));

    const total = values.reduce((sum, value) => sum + value, 0);
    distributionTotal.textContent =
      `Total dos percentuais: ${total.toFixed(2)}%` +
      (values.length && Math.abs(total - 100) < 0.001 ? ' ✅' : '');
    distributionTotal.style.color =
      !values.length || Math.abs(total - 100) < 0.001
        ? '#70e090'
        : '#ff8a8a';
  }

  function renderTieBreakers() {
    const container = document.getElementById('tr-selects');
    const count = Number(document.getElementById('tr-count').value || 0);
    const current = Array.from(
      container.querySelectorAll('select[data-tie-index]')
    ).map(select => select.value);

    const selected = current.length ? current : selectedTieBreakers;
    container.innerHTML = '';

    for (let i = 0; i < count; i++) {
      const previous = selected[i] || '';
      const criteria = getAvailableTieBreakers();
      const options = criteria.map(item => `
        <option value="${item.value}" ${item.value === previous ? 'selected' : ''}>
          ${item.label}
        </option>
      `).join('');

      container.insertAdjacentHTML('beforeend', `
        <div>
          <label style="font-size:.8rem;">${i + 1}º critério</label>
          <select data-tie-index="${i}" style="width:100%;">
            <option value="">Selecione...</option>
            ${options}
          </select>
        </div>
      `);
    }

    container.querySelectorAll('select[data-tie-index]').forEach(select => {
      select.addEventListener('change', () => {
        const all = Array.from(
          container.querySelectorAll('select[data-tie-index]')
        ).map(s => s.value).filter(Boolean);

        container.querySelectorAll('select[data-tie-index]').forEach((currentSelect, index) => {
          const usedByOthers = new Set(
            all.filter((value, otherIndex) => otherIndex !== index)
          );

          Array.from(currentSelect.options).forEach(option => {
            if (!option.value) return;
            option.disabled = usedByOthers.has(option.value);
          });
        });
      });
    });
  }

  document.getElementById('pz-positions').addEventListener('input', renderDistribution);
  distribution.addEventListener('input', updateDistributionTotal);
  document.getElementById('tr-count').addEventListener('change', renderTieBreakers);

  const groupCheckbox = document.getElementById('cr-hasGroupPhase');
  const knockoutCheckbox = document.getElementById('cr-hasKnockoutPhase');
  const knockoutFormatSelect = document.getElementById('cr-knockout-format');
  const knockoutStructurePanel = document.getElementById('cr-knockout-structure-panel');
  const knockoutAwayGoalsWrap = document.getElementById('cr-knockout-away-goals-wrap');
  const knockoutFinalFormatWrap = document.getElementById('cr-knockout-final-format-wrap');
  const syncKnockoutFormatUI = () => {
    const enabled = knockoutCheckbox?.checked === true;
    const homeAway = enabled && knockoutFormatSelect?.value === 'home_away';

    // A estrutura do mata-mata só existe quando o campeonato possui mata-mata.
    // Não basta esconder apenas o critério de gol fora: todo o painel deve desaparecer.
    if (knockoutStructurePanel) {
      knockoutStructurePanel.style.display = enabled ? '' : 'none';
    }
    if (knockoutAwayGoalsWrap) {
      knockoutAwayGoalsWrap.style.display = homeAway ? '' : 'none';
    }
    if (knockoutFinalFormatWrap) {
      knockoutFinalFormatWrap.style.display = homeAway ? '' : 'none';
    }
  };
  knockoutFormatSelect?.addEventListener('change', syncKnockoutFormatUI);
  const groupLegsSelect = document.getElementById('cr-group-legs');

  groupLegsSelect?.addEventListener('change', () => {
    updateGroupQualificationSummary();
  });

  groupCheckbox?.addEventListener('change', () => {
    updateGroupQualificationSummary();
    updateChampionshipType();
    renderTieBreakers();
  });

  knockoutCheckbox?.addEventListener('change', () => {
    syncKnockoutFormatUI();
    updateChampionshipType();
    const container = document.getElementById('tr-selects');
    const current = Array.from(
      container?.querySelectorAll('select[data-tie-index]') || []
    ).map(select => select.value);

    // Se o mata-mata foi desativado, remove o critério que deixou de existir.
    if (!knockoutCheckbox.checked && current.includes('knockoutPoints')) {
      container.querySelectorAll('select[data-tie-index]').forEach(select => {
        if (select.value === 'knockoutPoints') select.value = '';
      });
    }

    updateGroupQualificationSummary();
    renderTieBreakers();
  });

  renderDistribution();
  updateGroupQualificationSummary();
  renderTieBreakers();
  syncKnockoutFormatUI();

  // 📷 QR Code: permite câmera/upload e redimensiona a imagem antes do armazenamento.
  R.paymentQrCode = String(R.CurrentSettings.payment?.pixQrCode || '');
  const pixPreview = document.getElementById('cr-pix-preview');
  const pixClear = document.getElementById('cr-pix-clear');

  const renderPixPreview = () => {
    if (!pixPreview) return;
    pixPreview.innerHTML = R.paymentQrCode
      ? `<img src="${R.paymentQrCode}" alt="QR Code PIX" style="max-width:180px; max-height:180px; object-fit:contain;">`
      : '<span style="color:#888;">Nenhum QR Code configurado</span>';
    if (pixClear) pixClear.style.display = R.paymentQrCode ? '' : 'none';
  };

  const processPixImage = file => new Promise((resolve, reject) => {
    if (!file) return resolve('');
    if (!file.type || !file.type.startsWith('image/')) {
      return reject(new Error('Selecione uma imagem válida para o QR Code.'));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Não foi possível processar a imagem.'));
      img.onload = () => {
        const maxSize = 800;
        const sourceW = img.naturalWidth || img.width;
        const sourceH = img.naturalHeight || img.height;
        const scale = Math.min(1, maxSize / Math.max(sourceW, sourceH));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceW * scale));
        canvas.height = Math.max(1, Math.round(sourceH * scale));
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return reject(new Error('Seu navegador não suporta processamento de imagens.'));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > 1500000) {
          return reject(new Error('A imagem do QR Code continua muito grande. Use uma imagem menor.'));
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const handlePixFile = async file => {
    try {
      R.paymentQrCode = await processPixImage(file);
      renderPixPreview();
      toast('QR Code carregado. Clique em salvar para gravar.', 'success');
    } catch (err) {
      toast(err.message || 'Erro ao carregar QR Code.', 'error');
    }
  };

  document.getElementById('cr-pix-camera')?.addEventListener('change', e => {
    handlePixFile(e.target.files?.[0]);
    e.target.value = '';
  });
  document.getElementById('cr-pix-upload')?.addEventListener('change', e => {
    handlePixFile(e.target.files?.[0]);
    e.target.value = '';
  });
  pixClear?.addEventListener('click', () => {
    R.paymentQrCode = '';
    renderPixPreview();
  });

  document.getElementById('championship-rules-form')
    .addEventListener('submit', R.saveChampionshipRules);
}

async function saveChampionshipRules(e) {
  e.preventDefault();

  const leagueId = localStorage.getItem('selectedLeagueId') || '1';

  const positions = Math.max(
    0,
    Math.floor(Number(document.getElementById('pz-positions')?.value || 0))
  );

  const totalAmount = Math.max(
    0,
    Number(document.getElementById('pz-totalAmount')?.value || 0)
  );

  const distribution = positions === 0
    ? []
    : Array.from(
        document.querySelectorAll('#pz-distribution input[data-prize-position]')
      ).map(input => ({
        position: Number(input.dataset.prizePosition),
        percentage: Number(input.value || 0)
      }));

  if (positions > 0) {
    const totalPercentage = distribution.reduce(
      (sum, item) => sum + item.percentage,
      0
    );

    if (distribution.length !== positions) {
      toast('Defina o percentual de todas as posições premiadas.', 'error');
      return;
    }

    if (Math.abs(totalPercentage - 100) > 0.001) {
      toast('A soma dos percentuais da premiação deve ser 100%.', 'error');
      return;
    }
  }

  const tieBreakers = Array.from(
    document.querySelectorAll('#tr-selects select[data-tie-index]')
  ).map(select => select.value).filter(Boolean);

  if (new Set(tieBreakers).size !== tieBreakers.length) {
    toast('Não é permitido repetir um critério de desempate.', 'error');
    return;
  }

  const hasGroupPhase = document.getElementById('cr-hasGroupPhase')?.checked === true;
  const hasKnockoutPhase = document.getElementById('cr-hasKnockoutPhase')?.checked === true;
  const totalTeams = hasGroupPhase ? Math.floor(Number(document.getElementById('cr-totalTeams')?.value || 0)) : 0;
  const pointsRunTotalTeams = !hasGroupPhase && !hasKnockoutPhase ? Math.floor(Number(document.getElementById('cr-pointsRunTotalTeams')?.value || 0)) : 0;
  const pointsRunLegs = !hasGroupPhase && !hasKnockoutPhase
    ? (Number(document.getElementById('cr-pointsRunLegs')?.value || 1) === 2 ? 2 : 1)
    : 1;
  const groupCount = hasGroupPhase ? Math.floor(Number(document.getElementById('cr-groupCount')?.value || 0)) : 0;
  const totalQualified = hasGroupPhase && hasKnockoutPhase ? Math.floor(Number(document.getElementById('cr-totalQualified')?.value || 0)) : 0;
  const groupLegs = hasGroupPhase
    ? (Number(document.getElementById('cr-group-legs')?.value || 1) === 2 ? 2 : 1)
    : 1;

  if (!hasGroupPhase && !hasKnockoutPhase) {
    if (!pointsRunTotalTeams || pointsRunTotalTeams < 2) {
      toast('Em pontos corridos, informe o número de times (mínimo 2).', 'error');
      return;
    }
  }

  if (hasGroupPhase) {
    if (!totalTeams || !groupCount) {
      toast('Informe total de times e número de grupos.', 'error');
      return;
    }
    if (totalTeams % groupCount !== 0) {
      toast('O número de times deve ser divisível pelo número de grupos.', 'error');
      return;
    }
    if (hasKnockoutPhase) {
      if (!totalQualified) {
        toast('Informe o número de classificados para o mata-mata.', 'error');
        return;
      }
      if (totalQualified > totalTeams) {
        toast('O número de classificados não pode ser maior que o número de times.', 'error');
        return;
      }
      let qualifiedPowerOfTwo = totalQualified >= 2;
      let qualifiedPowerValue = totalQualified;
      while (qualifiedPowerOfTwo && qualifiedPowerValue % 2 === 0) qualifiedPowerValue /= 2;
      qualifiedPowerOfTwo = qualifiedPowerOfTwo && qualifiedPowerValue === 1;
      if (!qualifiedPowerOfTwo) {
        toast('O número de classificados para o mata-mata deve ser uma potência de 2 (2, 4, 8, 16, 32...).', 'error');
        return;
      }
    }
  }

  const payload = {
    leagueId,
    championshipRules: {
      drawIncludesExtraTime:
        document.querySelector('input[name="cr-bet-validation-period"]:checked')?.value === 'extra',
      winnerFromScore:
        document.getElementById('cr-winnerFromScore').checked,
      podiumSize:
        Number(document.getElementById('cr-podiumSize').value) || 4,
      hasGroupPhase,
      hasKnockoutPhase,
      hasThirdPlaceMatch: hasKnockoutPhase && document.getElementById('cr-hasThirdPlaceMatch')?.checked === true,
      knockoutFormat: hasKnockoutPhase && document.getElementById('cr-knockout-format')?.value === 'home_away' ? 'home_away' : 'single',
      knockoutFinalFormat: hasKnockoutPhase && document.getElementById('cr-knockout-format')?.value === 'home_away'
        ? (document.getElementById('cr-knockout-final-format')?.value === 'single' ? 'single' : 'home_away')
        : 'single',
      knockoutAwayGoals: hasKnockoutPhase && document.getElementById('cr-knockout-format')?.value === 'home_away' && document.getElementById('cr-knockout-away-goals')?.checked === true,
      pointsRun: {
        totalTeams: pointsRunTotalTeams,
        legs: pointsRunLegs
      },
      groupQualification: {
        totalTeams,
        groupCount,
        totalQualified,
        legs: groupLegs
      }
    },
    prizeZone: {
      positions,
      totalAmount,
      distribution
    },
    rankingRules: {
      tieBreakers
    },
    pixKey: String(document.getElementById('cr-pixKey')?.value || '').trim(),
    pixQrCode: R.paymentQrCode
  };

  try {
    const res = await api.post('/api/settings/global', payload);
    if (!res?.success) {
      throw new Error(res?.message || 'Erro ao salvar');
    }

    R.CurrentSettings.championshipRules = {
      ...R.CurrentSettings.championshipRules,
      ...payload.championshipRules,
      hasGroupPhase
    };
    R.CurrentSettings.prizeZone = payload.prizeZone;
    R.CurrentSettings.rankingRules = payload.rankingRules;
    R.CurrentSettings.payment = {
      pixKey: payload.pixKey,
      pixQrCode: payload.pixQrCode
    };

    toast('Regras do campeonato salvas!', 'success');
    closeModal('championship-rules-modal');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar regras', 'error');
  }
}

async function openChampionshipResultsModal() {
  const old = document.getElementById('championship-results-modal');
  if (old) old.remove();

  const sr = R.CurrentSettings.scoringRules || { ...DEFAULT_SCORING };
  const cr = R.CurrentSettings.championshipResults || {};

  // Só mostra campos que têm pontuação > 0
  const showTopScorer    = (sr.topScorer || 0) > 0;
  const showBestAttack   = (sr.bestAttack || 0) > 0;
  const showWorstDefense = (sr.worstDefense || 0) > 0;
  const showUpset        = (sr.upset || 0) > 0;

  const allMatches = R.AdminState.matches || [];
  const teams = [...new Set(allMatches.flatMap(m => [m.teamA, m.teamB]))].sort();
  const teamOptions = teams.map(t => `<option value="${t}">${R.withFlag(t)}</option>`).join('');

  let fieldsHtml = '';

  if (showTopScorer) {
    fieldsHtml += `
      <div class="form-group">
        <label>⚽ Artilheiro Oficial <span style="color:#ffda44;">(${sr.topScorer} pts)</span></label>
        <input type="text" id="cr-res-topScorer" value="${cr.topScorer || ''}" placeholder="Nome do artilheiro">
      </div>`;
  }
  if (showBestAttack) {
    fieldsHtml += `
      <div class="form-group">
        <label>🔥 Melhor Ataque Oficial <span style="color:#ffda44;">(${sr.bestAttack} pts)</span></label>
        <select id="cr-res-bestAttack"><option value="">Selecione...</option>${teamOptions}</select>
      </div>`;
  }
  if (showWorstDefense) {
    fieldsHtml += `
      <div class="form-group">
        <label>🥅 Pior Defesa Oficial <span style="color:#ffda44;">(${sr.worstDefense} pts)</span></label>
        <select id="cr-res-worstDefense"><option value="">Selecione...</option>${teamOptions}</select>
      </div>`;
  }
  if (showUpset) {
    fieldsHtml += `
      <div class="form-group">
        <label>🦓 Zebra Oficial <span style="color:#ffda44;">(${sr.upset} pts)</span></label>
        <input type="text" id="cr-res-upset" value="${cr.upset || ''}" placeholder="Descreva a maior zebra">
      </div>`;
  }

  if (!fieldsHtml) {
    fieldsHtml = '<p style="text-align:center; color:#888;">Nenhuma categoria de extra está ativa. Defina pontuação > 0 nas Regras de Pontuação primeiro.</p>';
  }

  const html = `
    <div id="championship-results-modal" class="modal active">
      <div class="modal-content" style="max-width: 460px;">
        <div class="modal-header">
          <h3>🏅 Resultados Oficiais (Extras)</h3>
          <button class="close-modal" onclick="closeModal('championship-results-modal')">&times;</button>
        </div>
        <form id="championship-results-form" style="display:flex; flex-direction:column; gap:12px; margin-top:10px;">
          ${fieldsHtml}
          <button type="submit" class="btn btn-success" style="width:100%; margin-top:8px;">
            <i class="fas fa-save"></i> Salvar Resultados Oficiais
          </button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  // Preenche selects com valor salvo
  if (showBestAttack && cr.bestAttack) {
    const sel = document.getElementById('cr-res-bestAttack');
    if (sel) sel.value = cr.bestAttack;
  }
  if (showWorstDefense && cr.worstDefense) {
    const sel = document.getElementById('cr-res-worstDefense');
    if (sel) sel.value = cr.worstDefense;
  }

  document.getElementById('championship-results-form').addEventListener('submit', R.saveChampionshipResults);
}

async function saveChampionshipResults(e) {
  e.preventDefault();
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';

  const sr = R.CurrentSettings.scoringRules || { ...DEFAULT_SCORING };
  const results = {};

  if ((sr.topScorer || 0) > 0) {
    const val = document.getElementById('cr-res-topScorer')?.value?.trim();
    if (val) results.topScorer = val;
  }
  if ((sr.bestAttack || 0) > 0) {
    const val = document.getElementById('cr-res-bestAttack')?.value;
    if (val) results.bestAttack = val;
  }
  if ((sr.worstDefense || 0) > 0) {
    const val = document.getElementById('cr-res-worstDefense')?.value;
    if (val) results.worstDefense = val;
  }
  if ((sr.upset || 0) > 0) {
    const val = document.getElementById('cr-res-upset')?.value?.trim();
    if (val) results.upset = val;
  }

  const payload = { leagueId, championshipResults: results };

  try {
    const res = await api.post('/api/settings/global', payload);
    if (!res?.success) throw new Error(res?.message || 'Erro ao salvar');

    R.CurrentSettings.championshipResults = results;
    toast('Resultados oficiais salvos!', 'success');
    closeModal('championship-results-modal');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro ao salvar resultados', 'error');
  }
}

registerAdminFunctions({openChampionshipRulesModal: openChampionshipRulesModal, saveChampionshipRules: saveChampionshipRules, openChampionshipResultsModal: openChampionshipResultsModal, saveChampionshipResults: saveChampionshipResults});
