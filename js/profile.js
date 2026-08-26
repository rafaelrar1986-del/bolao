import { api } from './api.js';
import { toast } from './ui.js';
import { initNewsTicker } from './newsTicker.js';
import { renderUserScoreCard } from './components/userScoreCard.js';
import { renderDuelInterface } from './components/duelRenderer.js';

let profileChart = null;
let rankingTimelineChart = null;
let historyExpanded = false;
const INITIAL_HISTORY_COUNT = 9;
let history = [];
let rankingHistory = null;
let compareHistory = null;
let compareRankingHistory = null;
let rankingRange = 7;

/* =========================
   UTIL — DATA DD/MM
========================= */
function formatDDMM(dateStr) {
  const d = new Date(dateStr);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}



/* =========================
   🖼️ AVATAR — PERFIL PRIVADO
========================= */
async function resizeAvatarToDataUrl(file) {
  if (!file || !file.type?.startsWith('image/')) {
    throw new Error('Selecione uma imagem válida.');
  }

  // Limite do arquivo original para evitar uploads desnecessariamente grandes.
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('A imagem deve ter no máximo 8 MB.');
  }

  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
      img.src = sourceUrl;
    });

    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível preparar a imagem.');

    // Corta proporcionalmente pelo centro para manter um avatar quadrado.
    const scale = Math.max(size / image.width, size / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const x = (size - drawWidth) / 2;
    const y = (size - drawHeight) / 2;

    ctx.drawImage(image, x, y, drawWidth, drawHeight);

    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function changePrivateProfileAvatar(file, user, isMe) {
  if (!isMe) return;

  try {
    const avatar = await resizeAvatarToDataUrl(file);
    const result = await api.updateMyAvatar(avatar);

    const updatedAvatar = result?.user?.avatar || avatar;
    user.avatar = updatedAvatar;

    // Mantém também o usuário local sincronizado para outras telas.
    window.currentUser = {
      ...(window.currentUser || {}),
      ...user,
      avatar: updatedAvatar
    };

    try {
      const stored = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (stored) {
        localStorage.setItem(
          'currentUser',
          JSON.stringify({ ...stored, avatar: updatedAvatar })
        );
      }
    } catch (_) {}

    toast('Foto de perfil atualizada!', 'success');
    return updatedAvatar;
  } catch (err) {
    toast(err?.message || 'Não foi possível atualizar a foto.', 'error');
    throw err;
  }
}

/* =========================
   ENTRY
========================= */
export async function initProfile(profileUserId = null) {
  const token = localStorage.getItem('token');
  const leagueId = localStorage.getItem('selectedLeagueId') || '1';

  if (!token) {
    console.warn('Perfil: token ausente');
    return;
  }

  try {
    /* =========================
        1️⃣ Usuário (ME ou OUTRO)
    ========================= */
    let user = null;
    let isMe = false;

    if (!profileUserId) {
      const meJson = await api.me();
      user = meJson.user;
      isMe = true;
    } else {
      const json = await api.getUserProfile(profileUserId);
      user = json?.data?.user;
      isMe = false;
    }

    if (!user?._id) return;

    /* =========================
        2️⃣ Leaderboard + Regras do Admin + Stats
    ========================= */
    const [lbRes, rulesRes, statsRes] = await Promise.all([
      api.leaderboard(leagueId, 'official'),
      api.getMatchRules(leagueId),
      api.get(`/api/matches/stats?leagueId=${encodeURIComponent(leagueId)}`)
    ]);

    const ranking = lbRes?.data || [];
    const rankedUser = ranking.find(r => r.user?._id === user._id);

    // ✅ getMatchRules() retorna { success, data }
    const rules = rulesRes?.data?.scoringRules || {};
    const champRules = rulesRes?.data?.championshipRules || {};
    const podiumTeams = rulesRes?.data?.podium || [];

    const matchStats = statsRes?.data || null;


    /* =========================
        3️⃣ Nome
    ========================= */
    const nameEl = document.getElementById('profileName');

    if (nameEl) {
      nameEl.innerText = isMe ? user.name : `Perfil de ${user.name}`;
    }


    /* =========================
        🧭 TABS PERFIL / DUELO
    ========================= */
    if (isMe) {

      const tabs =
        document.querySelectorAll('.profile-tabs .tab-pill');

      const slider =
        document.getElementById('profileTabSlider');

      const sections = {
        'profile-main':
          document.getElementById('profile-main'),

        'profile-duel':
          document.getElementById('profile-duel')
      };


      tabs.forEach(tab => {

        tab.onclick = () => {

          const target =
            tab.dataset.target;

          const index =
            Number(tab.dataset.index) || 0;


          tabs.forEach(t =>
            t.classList.remove('active')
          );

          tab.classList.add('active');


          if (slider) {
            slider.style.transform =
              `translateX(${index * 100}%)`;
          }


          Object.entries(sections).forEach(
            ([id, el]) => {

              if (!el) return;

              el.style.display =
                id === target
                  ? 'block'
                  : 'none';
            }
          );


          if (target === 'profile-duel') {
            window.dispatchEvent(
              new CustomEvent('reset-duel-phase')
            );
          }
        };

      });
    }


    /* =========================
        🗨️ FRASE DO USUÁRIO
    ========================= */
    const input =
      document.getElementById('newsInput');

    const btn =
      document.getElementById('sendNewsBtn');


    if (input && btn && isMe) {

      btn.onclick = async () => {

        const text =
          input.value.trim();


        if (text.length < 3) {
          toast(
            'A frase é muito curta',
            'warning'
          );

          return;
        }


        if (text.length > 80) {
          toast(
            'Máximo de 80 caracteres',
            'warning'
          );

          return;
        }


        btn.disabled = true;


        try {

          await api.createNews({
            text,
            leagueId
          });


          toast(
            'Frase enviada 😄',
            'success'
          );


          input.value = '';

          initNewsTicker();

        } catch (err) {

          toast(
            err.message,
            'error'
          );

        } finally {

          btn.disabled = false;

        }
      };
    }


    /* =========================
        4️⃣ Card de Pontuação
    ========================= */
    const cardContainer =
      document.getElementById('profileScoreCard');


    if (cardContainer && rankedUser) {

      const breakdown = {

        groups:
          Number(
            rankedUser.groupPhasePoints || 0
          ),

        knockout:
          Number(
            rankedUser.knockoutPoints || 0
          ),

        podium:
          Number(
            rankedUser.podiumPoints || 0
          ),

        bonus:
          Number(
            rankedUser.bonusPoints || 0
          ),

        extras:
          Number(
            rankedUser.extrasPoints || 0
          )
      };


      const totalPoints =
        Number(rankedUser.totalPoints) ||
        (
          breakdown.groups +
          breakdown.knockout +
          breakdown.podium +
          breakdown.bonus +
          breakdown.extras
        );


      let accuracy = null;


      if (matchStats) {

        const groupFinished =
          Number(
            matchStats.group?.finished || 0
          );


        const groupPointsPerMatch =
          Number(
            matchStats.group?.pointsPerMatch || 0
          );


        const knockoutFinished =
          Number(
            matchStats.knockout?.finished || 0
          );


        const knockoutPointsPerMatch =
          Number(
            matchStats.knockout?.pointsPerMatch || 0
          );


        const groupPossible =
          groupFinished *
          groupPointsPerMatch;


        const knockoutPossible =
          knockoutFinished *
          knockoutPointsPerMatch;


        accuracy = {

          group:
            groupPossible > 0

              ? Math.round(
                  (
                    Number(
                      rankedUser.groupPhasePoints || 0
                    ) /
                    groupPossible
                  ) * 100
                )

              : null,


          knockout:
            knockoutPossible > 0

              ? Math.round(
                  (
                    Number(
                      rankedUser.knockoutPoints || 0
                    ) /
                    knockoutPossible
                  ) * 100
                )

              : null
        };
      }


      renderUserScoreCard({

        container:
          cardContainer,

        user: {

          name:
            rankedUser.user.name,

          avatar:
            rankedUser.user.avatar || user.avatar || null,

          points:
            totalPoints,

          breakdown
        },

        position:
          rankedUser.position,

        accuracy,

        editableAvatar: isMe,

        onAvatarChange: async (file) => {
          const avatar = await changePrivateProfileAvatar(file, user, isMe);
          if (avatar) {
            rankedUser.user.avatar = avatar;
            renderUserScoreCard({
              container: cardContainer,
              user: {
                name: rankedUser.user.name,
                avatar,
                points: totalPoints,
                breakdown
              },
              position: rankedUser.position,
              accuracy,
              editableAvatar: true,
              onAvatarChange: async (nextFile) => {
                await changePrivateProfileAvatar(nextFile, user, true);
              }
            });
          }
        }
      });
    }


    /* =========================
        📋 Regras de Pontuação
    ========================= */
    const rulesContainer =
      document.getElementById(
        'profileRulesInfo'
      );


    if (rulesContainer && rules) {

      const ruleItems = [];


      const addRule = (
        value,
        label,
        icon,
        category
      ) => {

        const points = Number(value);


        if (points > 0) {

          ruleItems.push(`
            <div class="profile-rule-item profile-rule-${category}">
              <span class="profile-rule-icon" aria-hidden="true">${icon}</span>
              <span class="rule-label">${label}</span>
              <span class="profile-rule-points">${points}<small>pts</small></span>
            </div>
          `);
        }
      };


      /* =========================
         REGRAS DAS PARTIDAS
      ========================= */
      addRule(rules.exactScore, 'Placar Exato', '🎯', 'match');
      addRule(rules.scoreTeamA, 'Gols Time A', '⚽', 'match');
      addRule(rules.scoreTeamB, 'Gols Time B', '⚽', 'match');
      addRule(rules.winner, 'Vencedor / Empate', '🏆', 'match');
      addRule(rules.qualifier, 'Classificado', '➡️', 'match');


      /* =========================
         EXTRAS
      ========================= */
      addRule(rules.topScorer, 'Artilheiro', '🥇', 'extra');
      addRule(rules.upset, 'Zebra', '✨', 'extra');
      addRule(rules.bestAttack, 'Melhor Ataque', '🔥', 'extra');
      addRule(rules.worstDefense, 'Pior Defesa', '🛡️', 'extra');


      /* =========================
         PÓDIO
      ========================= */
      const podiumPoints =
        Array.isArray(rules.podiumPoints)
          ? rules.podiumPoints
          : [];

      const podiumLabels = [
        'Pódio 1º lugar',
        'Pódio 2º lugar',
        'Pódio 3º lugar',
        'Pódio 4º lugar',
        'Pódio 5º lugar',
        'Pódio 6º lugar',
        'Pódio 7º lugar',
        'Pódio 8º lugar'
      ];

      const podiumIcons = ['🥇', '🥈', '🥉', '🏅', '🏅', '🏅', '🏅', '🏅'];

      podiumPoints.forEach((value, index) => {
        addRule(
          value,
          podiumLabels[index] || `Pódio ${index + 1}º lugar`,
          podiumIcons[index] || '🏅',
          'podium'
        );
      });


      const scoringMode =
        String(rules.scoringMode || '').toLowerCase();

      const lockModeRaw =
                String(
                    rulesRes?.data?.betLockMode ??
                    ''
                ).toLowerCase();

      const lockMode =
        lockModeRaw === 'match' || lockModeRaw === 'partida'
          ? 'match'
          : lockModeRaw === 'grid' || lockModeRaw === 'grade'
            ? 'grid'
            : '';

      const lockLabel =
        lockMode === 'match'
          ? 'Por partida'
          : lockMode === 'grid'
            ? 'Por grade'
            : '';

      const lockExplanation =
        lockMode === 'match'
          ? 'A partida é bloqueada no início da partida.'
          : lockMode === 'grid'
            ? 'A fase/rodada é bloqueada no início do primeiro jogo da rodada.'
            : '';

      const modeLabel =
        scoringMode === 'dependent'
          ? 'Dependente'
          : scoringMode === 'independent'
            ? 'Independente'
            : 'Não informado';

      const modeIcon =
        scoringMode === 'dependent'
          ? '🔗'
          : scoringMode === 'independent'
            ? '🧩'
            : 'ℹ️';

      const podiumTeamsHtml =
        podiumTeams.length
          ? `
            <div class="rules-podium-teams">
              <span class="rules-podium-icon">🏆</span>
              <span>${podiumTeams.join(' › ')}</span>
            </div>
          `
          : '';

      const renderRuleGroup = (title, icon, category) => {
        const items = ruleItems.filter(
          item => item.includes(`profile-rule-${category}`)
        );

        return items.length
          ? `
              <section class="profile-rules-group profile-rules-group-${category}">
                <div class="profile-rules-group-title">
                  <span class="profile-rules-group-icon">${icon}</span>
                  <span>${title}</span>
                </div>
                <div class="rules-grid">${items.join('')}</div>
              </section>
            `
          : '';
      };

      rulesContainer.innerHTML = `
        <details class="profile-card rules-card profile-rules-card">
          <summary class="profile-rules-collapsed">
            <span class="profile-rules-collapsed-left">
              <span class="profile-rules-collapsed-title">
                <span class="profile-rules-title-icon">📋</span>
                <span>Regras de Pontuação</span>
              </span>
              <span class="profile-rules-badges">
                <span class="profile-rules-badge">${modeIcon} ${modeLabel}</span>
                ${
                  lockLabel
                    ? `<span class="profile-rules-badge profile-rules-badge-lock">🔒 ${lockLabel}</span>`
                    : ''
                }
              </span>
            </span>
            <span class="profile-rules-collapsed-actions">
              <button
                type="button"
                class="profile-rules-help"
                aria-label="Explicação das regras"
                title="Como funciona?"
              >?</button>
              <span class="profile-rules-toggle" aria-hidden="true">⌄</span>
            </span>
          </summary>

          <div class="profile-rules-expanded">
            <div class="profile-rules-help-panel" hidden>
              <div class="profile-rules-help-title">
                <strong>${modeIcon} Modo ${modeLabel}</strong>
                <button type="button" class="profile-rules-help-close" aria-label="Fechar">×</button>
              </div>
              <p>
                ${
                  scoringMode === 'dependent'
                    ? 'Se acertar o placar exato, não pontua nas outras regras da partida.'
                    : scoringMode === 'independent'
                      ? 'Cada pontuação é independente e os acertos podem ser somados na mesma partida.'
                      : 'Consulte as regras de pontuação desta liga.'
                }
              </p>
              ${
                Number(rules.qualifier || 0) > 0
                  ? '<p><strong>Classificado:</strong> pontua independentemente.</p>'
                  : ''
              }
              ${
                lockExplanation
                  ? `<p><strong>🔒 ${lockLabel}:</strong> ${lockExplanation}</p>`
                  : ''
              }
            </div>
            <div class="profile-rules-expanded-top">

            </div>

            <div class="profile-rules-divider"></div>

            ${
              ruleItems.length > 0
                ? `
                  ${renderRuleGroup('Partidas', '⚽', 'match')}
                  ${renderRuleGroup('Extras', '✨', 'extra')}
                  ${renderRuleGroup('Pódio', '🏆', 'podium')}
                `
                : `
                  <div class="profile-rules-empty">
                    Nenhuma regra de pontuação ativa.
                  </div>
                `
            }

            ${podiumTeamsHtml}
          </div>
        </details>
      `;

            const rulesCard = rulesContainer.querySelector('.profile-rules-card');
            const helpButton = rulesCard?.querySelector('.profile-rules-help');
            const helpPanel = rulesCard?.querySelector('.profile-rules-help-panel');
            const helpClose = rulesCard?.querySelector('.profile-rules-help-close');

            const closeRulesHelp = () => {
              if (helpPanel) helpPanel.hidden = true;
            };

            helpButton?.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (helpPanel) helpPanel.hidden = !helpPanel.hidden;
            });

            helpClose?.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              closeRulesHelp();
            });

    }


    /* =========================
        5️⃣ Histórico (Filtrado por Liga)
    ========================= */
    const histRes =
      await api.getUserPointsHistory(
        user._id,
        leagueId
      );


    history =
      Array.isArray(histRes)
        ? histRes
        : [];


    history.sort(
      (a, b) =>
        a.date.localeCompare(
          b.date
        )
    );


    const rankRes =
      await api.getUserRankingHistory(
        user._id,
        leagueId
      );


    rankingHistory =
      Array.isArray(rankRes)
        ? rankRes
        : null;


    const historyList =
      document.getElementById(
        'profileHistoryList'
      );


    const toggleBtn =
      document.getElementById(
        'toggleHistoryBtn'
      );


    function renderHistory() {

      if (!historyList) return;


      historyList.innerHTML = '';


      const data =
        historyExpanded

          ? history

          : history.slice(
              -INITIAL_HISTORY_COUNT
            );


      let lastTotal =
        historyExpanded

          ? 0

          : (
              history.length >
              INITIAL_HISTORY_COUNT

                ? Number(
                    history[
                      history.length -
                      data.length -
                      1
                    ]?.points || 0
                  )

                : 0
            );


      data.forEach(h => {

        const currentTotal =
          Number(h.points || 0);


        const dailyPoints =
          currentTotal -
          lastTotal;


        lastTotal =
          currentTotal;


        let icon = '⚪';

        let cls = 'neutral';


        if (dailyPoints > 0) {

          icon =
            dailyPoints >= 5
              ? '🔥'
              : '🟢';


          cls =
            dailyPoints >= 5
              ? 'hot'
              : 'positive';
        }


        historyList.innerHTML += `

          <div
            class="history-row ${cls}"
          >

            <div class="history-date">
              ${formatDDMM(h.date)}
            </div>


            <div class="history-bottom">

              <div class="history-icon">
                ${icon}
              </div>


              <div class="history-points">
                +${dailyPoints}
              </div>

            </div>

          </div>

        `;
      });


      if (toggleBtn) {

        toggleBtn.innerText =
          historyExpanded

            ? 'Ver menos ⬆️'

            : 'Ver mais dias ⬇️';
      }
    }


    renderHistory();


    if (
      toggleBtn &&
      history.length >
      INITIAL_HISTORY_COUNT
    ) {

      toggleBtn.style.display =
        'block';


      toggleBtn.onclick = () => {

        historyExpanded =
          !historyExpanded;


        renderHistory();

      };
    }


    /* =========================
        ⚔️ DUELO — RENDERIZAÇÃO
    ========================= */
    const duelUserSelect =
      document.getElementById(
        'duelUserSelect'
      );


    if (
      duelUserSelect &&
      isMe
    ) {

      duelUserSelect.innerHTML =
        '<option value="">Selecione um usuário do ranking</option>';


      ranking
        .filter(
          r =>
            r.user?._id !==
            user._id
        )

        .forEach(r => {

          const opt =
            document.createElement(
              'option'
            );


          opt.value =
            r.user._id;


          opt.textContent =
            `${r.position}º - ${r.user.name}`;


          duelUserSelect.appendChild(
            opt
          );

        });


      duelUserSelect.onchange =
        async e => {

          const targetUserId =
            e.target.value;


          const duelContainer =
            document.getElementById(
              'profile-duel-container'
            );


          if (
            !duelContainer ||
            !targetUserId
          ) {
            return;
          }


          duelContainer.innerHTML =
            '<p style="opacity:.6">Carregando duelo…</p>';


          try {

            window.dispatchEvent(
              new CustomEvent(
                'reset-duel-phase'
              )
            );


            const [
              dRes,
              mBRes,
              mtRes
            ] =
              await Promise.all([

                api.getDuels(
                  targetUserId,
                  leagueId
                ),

                api.myBets(
                  leagueId
                ),

                api.listMatches(
                  leagueId
                )

              ]);


            const targetUser =
              ranking.find(
                r =>
                  r.user?._id ===
                  targetUserId
              );


            renderDuelInterface(

              dRes?.data?.groupMatches ||
                [],

              mBRes?.data?.groupMatches ||
                [],

              mtRes?.data ||
                [],

              targetUser?.user?.name ||
                'Usuário',

              'profile-duel-container'
            );


          } catch (err) {

            duelContainer.innerHTML =
              '<p style="color:red">Erro ao carregar duelo.</p>';

          }
        };
    }


    /* =========================
       6️⃣ COMPARAÇÃO
       (somente no meu perfil)
    ========================= */
    const compareSelect =
      document.getElementById(
        'compareUserSelect'
      );


    if (
      compareSelect &&
      isMe
    ) {

      compareSelect.innerHTML =
        '<option value="">Comparar com outro usuário</option>';


      ranking.forEach(r => {

        if (
          r.user?._id !==
          user._id
        ) {

          const opt =
            document.createElement(
              'option'
            );


          opt.value =
            r.user._id;


          opt.textContent =
            r.user.name;


          compareSelect.appendChild(
            opt
          );
        }

      });
    }


    async function loadCompareUser(
      userId,
      range
    ) {

      rankingRange =
        range;


      if (!userId) {

        compareHistory =
          null;

        compareRankingHistory =
          null;


        renderChart(range);
        renderRankingTimeline();

        return;
      }


      const res =
        await api.getUserPointsHistory(
          userId,
          leagueId
        );


      if (
        Array.isArray(res)
      ) {

        compareHistory =
          res;


        compareHistory.sort(
          (a, b) =>
            a.date.localeCompare(
              b.date
            )
        );
      }


      const rRes =
        await api.getUserRankingHistory(
          userId,
          leagueId
        );


      compareRankingHistory =
        Array.isArray(rRes)
          ? rRes
          : null;


      renderChart(range);
      renderRankingTimeline();
    }


    /* =========================
       🏆 Timeline de Ranking
    ========================= */
    function renderRankingTimeline() {

      const canvas =
        document.getElementById(
          'rankingTimelineChart'
        );


      if (
        !canvas ||
        !window.Chart
      ) {
        return;
      }


      if (
        !Array.isArray(
          rankingHistory
        ) ||
        rankingHistory.length === 0
      ) {
        return;
      }


      if (
        rankingTimelineChart
      ) {

        rankingTimelineChart.destroy();

        rankingTimelineChart =
          null;
      }


      const ordered =
        [...rankingHistory].sort(
          (a, b) =>
            a.date.localeCompare(
              b.date
            )
        );


      const data =
        rankingRange === 'all'

          ? ordered

          : ordered.slice(
              -Number(rankingRange)
            );


      const labels =
        data.map(
          r =>
            formatDDMM(
              r.date
            )
        );


      const mainPositions =
        data.map(r => {
          const v = Number(r.position);
          return Number.isInteger(v) && v >= 1 ? v : null;
        });


      if (
        !mainPositions.length
      ) {
        return;
      }


      const datasets = [

        {
          label:
            isMe
              ? 'Você'
              : 'Usuário',

          data:
            mainPositions,

          borderColor:
            '#1976d2',

          borderWidth:
            3,

          pointRadius:
            6,

          pointBackgroundColor:
            '#1976d2',

          stepped:
            true
        }

      ];


      let allPositions =
        [...mainPositions];


      if (
        Array.isArray(
          compareRankingHistory
        )
      ) {

        const map =
          new Map(
            compareRankingHistory.map(
              r => [

                r.date.split('T')[0],

                Number(
                  r.position
                )

              ]
            )
          );


        const comparePositions =
          data.map(r => {

            const v =
              map.get(
                r.date.split('T')[0]
              );


            return Number.isInteger(v) &&
              v >= 1

              ? v

              : null;

          });


        datasets.push({

          label:
            'Outro usuário',

          data:
            comparePositions,

          borderDash:
            [6, 6],

          borderColor:
            '#d32f2f',

          borderWidth:
            3,

          pointRadius:
            5,

          stepped:
            true
        });


        allPositions =
          allPositions.concat(
            comparePositions.filter(
              v =>
                Number.isInteger(v)
            )
          );
      }


      const maxRank =
        Math.max(
          2,
          ...allPositions
        );


      rankingTimelineChart =
        new Chart(
          canvas,
          {

            type:
              'line',


            data: {

              labels,

              datasets

            },


            options: {

              responsive:
                true,

              maintainAspectRatio:
                false,


              layout: {

                padding: {

                  top:
                    10,

                  bottom:
                    10

                }

              },


              scales: {

                y: {

                  reverse:
                    true,

                  suggestedMin:
                    0.5,

                  suggestedMax:
                    maxRank + 0.5,

                  beginAtZero:
                    false,


                  ticks: {

                    stepSize:
                      1,

                    precision:
                      0,


                    callback:
                      v =>

                        Number.isInteger(v) &&
                        v >= 1

                          ? `${v}º`

                          : ''

                  }

                }

              }

            }

          }
        );
    }


    /* =========================
       7️⃣ Gráfico de Pontos
    ========================= */
    const canvas =
      document.getElementById(
        'historyChart'
      );


    if (
      !canvas ||
      !window.Chart
    ) {
      return;
    }


    function renderChart(
      range
    ) {

      const slice =
        range === 'all'

          ? history

          : history.slice(
              -Number(range)
            );


      const labels =
        slice.map(
          h =>
            formatDDMM(
              h.date
            )
        );


      const datasets = [

        {

          label:
            isMe
              ? 'Você'
              : user.name,

          data:
            slice.map(
              h =>
                Number(
                  h.points ||
                  0
                )
            ),

          tension:
            0,

          fill:
            false,

          borderWidth:
            3,

          pointRadius:
            4,

          borderColor:
            '#1976d2'
        }

      ];


      if (
        compareHistory &&
        compareHistory.length
      ) {

        const compareMap =
          new Map(
            compareHistory.map(
              h => [

                h.date.split('T')[0],

                Number(
                  h.points ||
                  0
                )

              ]
            )
          );


        datasets.push({

          label:
            'Outro usuário',

          data:
            slice.map(
              h =>

                compareMap.get(
                  h.date.split('T')[0]
                ) ??
                null
            ),

          tension:
            0,

          fill:
            false,

          borderWidth:
            3,

          pointRadius:
            3,

          borderColor:
            '#d32f2f'
        });
      }


      if (
        profileChart
      ) {

        profileChart.destroy();

      }


      profileChart =
        new Chart(
          canvas,
          {

            type:
              'line',


            data: {

              labels,

              datasets

            },


            options: {

              responsive:
                true,

              maintainAspectRatio:
                false,


              scales: {

                y: {

                  beginAtZero:
                    true

                }

              }

            }

          }
        );
    }


    let currentRange =
      7;


    renderChart(
      currentRange
    );


    renderRankingTimeline();


    document
      .querySelectorAll(
        '.chart-btn'
      )
      .forEach(
        btn => {

          btn.onclick = () => {

            document
              .querySelectorAll(
                '.chart-btn'
              )
              .forEach(
                b =>
                  b.classList.remove(
                    'active'
                  )
              );


            btn.classList.add(
              'active'
            );


            currentRange =
              btn.dataset.range;


            rankingRange =
              btn.dataset.range;


            renderChart(
              currentRange
            );


            renderRankingTimeline();

          };

        }
      );


    if (
      compareSelect &&
      isMe
    ) {

      compareSelect.onchange =
        e =>

          loadCompareUser(
            e.target.value,
            currentRange
          );

    }


  } catch (err) {

    console.error(
      'Erro no perfil:',
      err
    );

  }
}