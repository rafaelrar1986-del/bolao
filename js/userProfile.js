import { api } from './api.js';
import { renderChampionshipRulesCard } from './championshipRulesView.js';
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
let currentUserName = '';

/* ============================================================
   HELPERS
   ============================================================ */
function formatDDMM(dateStr) {
    const d = new Date(dateStr);

    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}


/* ============================================================
   ENTRY — PERFIL PÚBLICO
   ============================================================ */
export async function initUserProfile(userId) {

    if (!userId) return;

    window.dispatchEvent(
        new Event('reset-duel-phase')
    );

    const duelWrapper =
        document.getElementById(
            'duel-section-wrapper'
        );

    const duelList =
        document.getElementById(
            'duel-bets-list'
        );

    if (duelWrapper) {
        duelWrapper.style.display = 'none';
    }

    if (duelList) {

        duelList.innerHTML = `
            <div class="loading-state">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Carregando comparativo...</span>
            </div>
        `;
    }

    const token =
        localStorage.getItem('token');

    if (!token) return;


    try {

        const leagueId =
            localStorage.getItem(
                'selectedLeagueId'
            ) || '1';


        /* ============================================================
           CARREGA TODOS OS DADOS
        ============================================================ */
        const results =
            await Promise.allSettled([

                api.getUserProfile(
                    userId
                ),

                api.leaderboard(
                    leagueId,
                    'official'
                ),

                api.getDuels(
                    userId,
                    leagueId
                ),

                api.myBets(
                    leagueId
                ),

                api.listMatches(
                    leagueId
                ),

                api.getUserPointsHistory(
                    userId,
                    leagueId
                ),

                api.getUserRankingHistory(
                    userId,
                    leagueId
                ),

                api.getMatchRules(
                    leagueId
                ),

                api.get(
                    `/api/matches/stats?leagueId=${encodeURIComponent(leagueId)}`
                )

            ]);


        const [
            uRes,
            lbRes,
            duelRes,
            myBetsRes,
            matchesRes,
            histRes,
            rankRes,
            rulesRes,
            statsRes
        ] =
            results.map(
                r =>
                    r.status === 'fulfilled'
                        ? r.value
                        : null
            );


        /* ============================================================
           USUÁRIO
        ============================================================ */
        const user =
            uRes?.data?.user;

        if (!user?._id) {

            console.error(
                'Erro ao carregar perfil do usuário'
            );

            return;
        }


        currentUserName =
            user.name;


        /* ============================================================
           RANKING
        ============================================================ */
        const ranking =
            lbRes?.data || [];


        const rankedUser =
            ranking.find(
                r =>
                    r.user?._id ===
                    user._id
            );


        /* ============================================================
           REGRAS DO ADMIN
           
           getMatchRules() retorna:
           {
             success: true,
             data: {
               scoringRules,
               championshipRules,
               podium
             }
           }
        ============================================================ */
        const rules =
            rulesRes?.data?.scoringRules ||
            {};

        const champRules =
            rulesRes?.data?.championshipRules ||
            {};

        const podiumTeams =
            rulesRes?.data?.podium ||
            [];


        /* ============================================================
           STATS DAS PARTIDAS
        ============================================================ */
        const matchStats =
            statsRes?.data ||
            null;


        /* ============================================================
           DADOS DO DUELO
        ============================================================ */
        const visitedBets =
            duelRes?.data?.groupMatches ||
            [];

        const myBets =
            myBetsRes?.data?.groupMatches ||
            [];

        const allMatches =
            matchesRes?.data ||
            [];


        /* ============================================================
           NOME
        ============================================================ */
        const profileName =
            document.getElementById(
                'userProfileName'
            );

        if (profileName) {

            profileName.innerText =
                `Perfil de ${user.name}`;
        }


        /* ============================================================
           TABS
        ============================================================ */
        injectProfileTabs(
            visitedBets,
            myBets,
            allMatches,
            user.name
        );


        /* ============================================================
           SCORE CARD
        ============================================================ */
        if (rankedUser) {

            const breakdown = {

                groups:
                    Number(
                        rankedUser.groupPhasePoints ||
                        0
                    ),

                knockout:
                    Number(
                        rankedUser.knockoutPoints ||
                        0
                    ),

                podium:
                    Number(
                        rankedUser.podiumPoints ||
                        0
                    ),

                bonus:
                    Number(
                        rankedUser.bonusPoints ||
                        0
                    ),

                extras:
                    Number(
                        rankedUser.extrasPoints ||
                        0
                    )
            };


            const totalPoints =
                Number(
                    rankedUser.totalPoints
                ) ||
                (
                    breakdown.groups +
                    breakdown.knockout +
                    breakdown.podium +
                    breakdown.bonus +
                    breakdown.extras
                );


            /* ========================================================
               ACURÁCIA
            ======================================================== */
            let accuracy = null;


            if (matchStats) {

                const groupFinished =
                    Number(
                        matchStats.group?.finished ||
                        0
                    );


                const groupPointsPerMatch =
                    Number(
                        matchStats.group?.pointsPerMatch ||
                        0
                    );


                const knockoutFinished =
                    Number(
                        matchStats.knockout?.finished ||
                        0
                    );


                const knockoutPointsPerMatch =
                    Number(
                        matchStats.knockout?.pointsPerMatch ||
                        0
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
                                        rankedUser.groupPhasePoints ||
                                        0
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
                                        rankedUser.knockoutPoints ||
                                        0
                                    ) /
                                    knockoutPossible
                                ) * 100
                            )

                            : null
                };
            }


            renderUserScoreCard({

                container:
                    document.getElementById(
                        'userProfileScoreCard'
                    ),

                user: {

                    name:
                        user.name,

                    points:
                        totalPoints,

                    breakdown
                },

                position:
                    rankedUser.position,

                accuracy

            });
        }


            // Regras de pontuação: renderização centralizada baseada no novo Criador de Regras.
    const rulesViewContainer = document.getElementById('userProfileRulesInfo');
    if (rulesViewContainer) {
      renderChampionshipRulesCard(
        rulesViewContainer,
        rulesRes?.data || {},
        { includeHelp: true }
      );
    }




        /* ============================================================
           COMPARAÇÃO
        ============================================================ */
        const compareSelect =
            document.getElementById(
                'userCompareUserSelect'
            );


        if (compareSelect) {

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


            compareSelect.onchange =
                e =>
                    loadCompareUser(
                        e.target.value,
                        rankingRange
                    );
        }


        /* ============================================================
           HISTÓRICO
        ============================================================ */
        history =
            Array.isArray(histRes)
                ? histRes
                : [];


        if (Array.isArray(history)) {

            history.sort(
                (a, b) =>
                    a.date.localeCompare(
                        b.date
                    )
            );
        }


        rankingHistory =
            Array.isArray(rankRes)
                ? rankRes
                : null;


        renderHistory(
            history
        );

        renderChart();

        renderRankingTimeline();


        /* ============================================================
           BOTÕES DE RANGE
        ============================================================ */
        document
            .querySelectorAll(
                '.chart-btn'
            )
            .forEach(btn => {

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


                    rankingRange =
                        btn.dataset.range;


                    renderChart();

                    renderRankingTimeline();
                };
            });


    } catch (e) {

        console.error(
            'Erro no perfil público:',
            e
        );
    }
}


/* ============================================================
   COMPARAÇÃO: BUSCAR DADOS
============================================================ */
async function loadCompareUser(
    userId,
    range
) {

    rankingRange =
        range;


    const leagueId =
        localStorage.getItem(
            'selectedLeagueId'
        ) || '1';


    if (!userId) {

        compareHistory =
            null;

        compareRankingHistory =
            null;

        renderChart();

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


    renderChart();

    renderRankingTimeline();
}


/* ============================================================
   TABS
============================================================ */
function injectProfileTabs(
    v,
    m,
    a,
    targetName
) {

    const nav =
        document.getElementById(
            'userProfileHeaderNav'
        );


    const statsWrapper =
        document.getElementById(
            'stats-section-wrapper'
        );


    const duelWrapper =
        document.getElementById(
            'duel-section-wrapper'
        );


    const duelList =
        document.getElementById(
            'duel-bets-list'
        );


    nav.innerHTML = `

        <div class="profile-tabs">

            <div
                class="tab-slider"
                id="tab-active-bg"
            ></div>


            <button
                class="tab-pill active"
                data-index="0"
                data-target="stats"
            >
                📊 Status
            </button>


            <button
                class="tab-pill"
                data-index="1"
                data-target="duel"
            >
                ⚔️ Duelo
            </button>

        </div>

    `;


    const slider =
        document.getElementById(
            'tab-active-bg'
        );


    if (slider) {

        slider.style.transform =
            'translateX(0%)';
    }


    statsWrapper.style.display =
        'block';


    duelWrapper.style.display =
        'none';


    duelList.innerHTML = `

        <div class="loading-state">

            <i class="fas fa-spinner fa-spin"></i>

            <span>
                Carregando comparativo...
            </span>

        </div>

    `;


    nav
        .querySelectorAll(
            '.tab-pill'
        )
        .forEach(btn => {

            btn.onclick = () => {

                const index =
                    Number(
                        btn.dataset.index
                    );


                const target =
                    btn.dataset.target;


                if (slider) {

                    slider.style.transform =
                        `translateX(${index * 100}%)`;
                }


                nav
                    .querySelectorAll(
                        '.tab-pill'
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


                statsWrapper.style.display =
                    target === 'stats'
                        ? 'block'
                        : 'none';


                duelWrapper.style.display =
                    target === 'duel'
                        ? 'block'
                        : 'none';


                if (
                    target === 'duel'
                ) {

                    window.dispatchEvent(
                        new Event(
                            'reset-duel-phase'
                        )
                    );


                    duelList.innerHTML =
                        '';


                    renderDuelInterface(
                        v,
                        m,
                        a,
                        targetName
                    );
                }
            };
        });
}


/* ============================================================
   HISTÓRICO
============================================================ */
function renderHistory(
    historyData
) {

    const historyList =
        document.getElementById(
            'userProfileHistoryList'
        );


    const toggleBtn =
        document.getElementById(
            'userToggleHistoryBtn'
        );


    if (!historyList) return;


    historyList.innerHTML =
        '';


    const data =
        historyExpanded
            ? historyData
            : historyData.slice(
                -INITIAL_HISTORY_COUNT
            );


    let lastTotal =
        historyExpanded

            ? 0

            : (
                historyData.length >
                INITIAL_HISTORY_COUNT

                    ? Number(
                        historyData[
                            historyData.length -
                            data.length -
                            1
                        ]?.points || 0
                    )

                    : 0
              );


    [...data].forEach(
        h => {

            const currentTotal =
                Number(
                    h.points || 0
                );


            const dailyPoints =
                currentTotal -
                lastTotal;


            lastTotal =
                currentTotal;


            let icon =
                '⚪';

            let cls =
                'neutral';


            if (
                dailyPoints > 0
            ) {

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

                    <div
                        class="history-date"
                    >
                        ${formatDDMM(
                            h.date
                        )}
                    </div>


                    <div
                        class="history-bottom"
                    >

                        <div
                            class="history-icon"
                        >
                            ${icon}
                        </div>


                        <div
                            class="history-points"
                        >
                            +${dailyPoints}
                        </div>

                    </div>

                </div>

            `;
        }
    );


    if (toggleBtn) {

        toggleBtn.innerText =
            historyExpanded
                ? 'Ver menos ⬆️'
                : 'Ver mais dias ⬇️';


        toggleBtn.style.display =
            historyData.length >
            INITIAL_HISTORY_COUNT
                ? 'block'
                : 'none';


        toggleBtn.onclick = () => {

            historyExpanded =
                !historyExpanded;


            renderHistory(
                historyData
            );
        };
    }
}


/* ============================================================
   GRÁFICO DE PONTOS
============================================================ */
function renderChart() {

    const canvas =
        document.getElementById(
            'userHistoryChart'
        );


    if (
        !canvas ||
        !window.Chart
    ) {
        return;
    }


    const slice =
        rankingRange === 'all'

            ? history

            : history.slice(
                -Number(
                    rankingRange
                )
            );


    if (profileChart) {

        profileChart.destroy();
    }


    const ctx =
        canvas.getContext(
            '2d'
        );


    const gradient =
        ctx.createLinearGradient(
            0,
            0,
            0,
            400
        );


    gradient.addColorStop(
        0,
        'rgba(25, 118, 210, 0.3)'
    );


    gradient.addColorStop(
        1,
        'rgba(25, 118, 210, 0)'
    );


    const datasets = [

        {

            label:
                currentUserName,

            data:
                slice.map(
                    h =>
                        Number(
                            h.points ||
                            0
                        )
                ),

            tension:
                0.4,

            borderColor:
                '#1976d2',

            borderWidth:
                3,

            pointRadius:
                4,

            backgroundColor:
                gradient,

            fill:
                true
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

                        h.date.split(
                            'T'
                        )[0],

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
                            h.date.split(
                                'T'
                            )[0]
                        ) ??
                        null
                ),

            tension:
                0.4,

            borderColor:
                '#d32f2f',

            borderWidth:
                3,

            pointRadius:
                3,

            fill:
                false,

            borderDash:
                [6, 6]
        });
    }


    profileChart =
        new Chart(
            canvas,
            {

                type:
                    'line',


                data: {

                    labels:
                        slice.map(
                            h =>
                                formatDDMM(
                                    h.date
                                )
                        ),

                    datasets
                },


                options: {

                    responsive:
                        true,

                    maintainAspectRatio:
                        false,


                    plugins: {

                        legend: {

                            display:
                                !!compareHistory
                        }
                    },


                    scales: {

                        y: {

                            beginAtZero:
                                true,

                            grid: {

                                color:
                                    '#f0f0f0'
                            }
                        },


                        x: {

                            grid: {

                                display:
                                    false
                            }
                        }

                    }

                }

            }
        );
}


/* ============================================================
   TIMELINE DE RANKING
============================================================ */
function renderRankingTimeline() {

    const canvas =
        document.getElementById(
            'userRankingTimelineChart'
        );


    if (
        !canvas ||
        !window.Chart ||
        !rankingHistory
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
                -Number(
                    rankingRange
                )
            );


    const labels =
        data.map(
            r =>
                formatDDMM(
                    r.date
                )
        );


    const positions =
        data.map(
            r => {
                const v = Number(r.position);
                return Number.isInteger(v) && v >= 1 ? v : null;
            }
        );


    if (
        !positions.length
    ) {
        return;
    }


    const datasets = [

        {

            label:
                currentUserName,

            data:
                positions,

            borderColor:
                '#1976d2',

            borderWidth:
                3,

            pointRadius:
                6,

            pointBackgroundColor:
                '#1976d2',

            stepped:
                true,

            tension:
                0
        }

    ];


    let allPositions =
        [...positions];


    if (
        Array.isArray(
            compareRankingHistory
        )
    ) {

        const map =
            new Map(
                compareRankingHistory.map(
                    r => [

                        r.date.split(
                            'T'
                        )[0],

                        Number(
                            r.position
                        )

                    ]
                )
            );


        const comparePositions =
            data.map(
                r => {

                    const v =
                        map.get(
                            r.date.split(
                                'T'
                            )[0]
                        );


                    return Number.isInteger(
                        v
                    ) &&
                    v >= 1

                        ? v

                        : null;
                }
            );


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
                        Number.isInteger(
                            v
                        )
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


                    plugins: {

                        legend: {

                            display:
                                !!compareRankingHistory
                        }
                    },


                    scales: {

                        y: {

                            reverse:
                                true,

                            suggestedMin:
                                0.5,

                            suggestedMax:
                                maxRank +
                                0.5,

                            beginAtZero:
                                false,


                            ticks: {

                                stepSize:
                                    1,

                                precision:
                                    0,


                                callback:
                                    v =>

                                        Number.isInteger(
                                            v
                                        ) &&
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