import { rankingState, getRankingLoader } from './state.js';
import { clearAllSimulationRequestTimers } from './simulation.js';
import { toast } from '../ui.js';
import { isMobile, parseMatchTime } from './helpers.js';

window.handleShareRanking = async function() {
    const type = window.__CURRENT_RANK_TAB__ || 'official';
    const entries = window.__RANKING_CACHE__ || [];
    
    if (!entries || entries.length === 0) {
        if (typeof toast === 'function') toast("Aguarde o carregamento do ranking...", "info");
        return;
    }

    const titles = {
        official: "🏆 *RANKING OFICIAL*",
        partial: "⏳ *RANKING PARCIAL (LIVE)*",
        strategy: "💡 *PROJEÇÃO DE ESTRATÉGIA*"
    };

    const leagueName = document.querySelector('.league-title')?.innerText || "Bolão 2026";
    let shareText = `*${leagueName.toUpperCase()}*\n${titles[type]}\n\n`;

    entries.slice(0, 5).forEach((e, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '▪️';
        const name = e.name || e.user?.name || '---';
        const pts = e.totalPoints || e.points || 0;
        shareText += `${medal} ${name}: ${pts} pts\n`;
    });

    shareText += `\nVeja a classificação completa:\n${window.location.origin}`;

    try {
        if (navigator.share) {
            await navigator.share({
                title: leagueName,
                text: shareText
            });
        } else {
            await navigator.clipboard.writeText(shareText);
            if (typeof toast === 'function') toast("Ranking copiado! ✅", "success");
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error("Erro ao compartilhar:", err);
        }
    }
};

window.getUserRankingSummary = function (userId) {
    const cache = window.__OFFICIAL_RANKING_CACHE__ || window.__RANKING_CACHE__;
    if (!cache) return null;
    const idx = cache.findIndex(r => (r.userId || r._id || r.user?._id || r.user?.id) === userId);
    if (idx === -1) return null;
    return { position: cache[idx].position, points: cache[idx].totalPoints || cache[idx].points || 0 };
};


/* =====================
    🏆 MODAL DO RANKING SIMULADO
===================== */
window.showSimulatedRankingModal = function() {
    let ranking = window.__LAST_SIMULATED_RANKING__;
    let isPureSimulation = true;

    if (!ranking || ranking.length === 0) {
        ranking = window.__OFFICIAL_RANKING_CACHE__ || window.__RANKING_CACHE__ || [];
        isPureSimulation = false;
    }
    
    if (!ranking || ranking.length === 0) {
        const msg = 'Nenhum dado de ranking ativo ou disponível no momento.';
        if (window.Swal) Swal.fire('Aviso', msg, 'info');
        else alert(msg);
        return;
    }

    const select = document.getElementById('strategy-user-select');
    let activeUserId = select ? select.value : null;
    const currentLoggedId = window.currentUser ? (window.currentUser._id || window.currentUser.id) : null;
    
    if (!activeUserId) {
        activeUserId = currentLoggedId;
    }

    const mobile = isMobile();

    if (mobile && window.Swal && !document.getElementById('swal-fullscreen-fix')) {
        const style = document.createElement('style');
        style.id = 'swal-fullscreen-fix';
        style.innerHTML = `
            @media (max-width: 768px) {
                .swal2-popup.swal2-fullscreen {
                    background: #1a1a2e !important;
                    border-radius: 0 !important;
                    padding: 20px 15px !important;
                    display: flex !important;
                    flex-direction: column !important;
                }
                .swal2-title { padding-top: 5px !important; margin: 0 !important; }
                .swal2-html-container {
                    flex: 1 !important;
                    display: flex !important;
                    flex-direction: column !important;
                    margin: 10px 0 5px 0 !important;
                    overflow: hidden !important;
                    width: 100% !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    const listHtml = ranking.map(user => {
        const uId = user.userId || user.id || user._id || user.user?._id || user.user?.id;
        const isMe = currentLoggedId && uId === currentLoggedId;
        const isTarget = uId === activeUserId;
        
        let bg = 'rgba(255,255,255,0.03)';
        let border = '1px solid rgba(255,255,255,0.05)';
        let shadow = 'none';
        let nameColor = 'white';
        let weight = '600';
        let badgeHtml = '';
        let scale = '1';

        if (isMe) {
            bg = 'linear-gradient(90deg, rgba(0, 255, 255, 0.15), rgba(0, 255, 255, 0.03))';
            border = '1px solid rgba(0, 255, 255, 0.4)';
            shadow = '0 0 15px rgba(0, 255, 255, 0.25)';
            nameColor = '#00ffff';
            weight = '800';
            scale = mobile ? '1' : '1.02';
            badgeHtml = `<span style="background: #00ffff; color: #1a1a2e; font-size: 0.55rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; margin-left: 8px; letter-spacing: 0.5px; box-shadow: 0 0 8px #00ffff;">VOCÊ</span>`;
        } else if (isTarget) {
            bg = 'rgba(46, 204, 113, 0.12)';
            border = '1px solid rgba(46, 204, 113, 0.4)';
            shadow = '0 0 12px rgba(46, 204, 113, 0.15)';
            nameColor = '#2ecc71';
            weight = '800';
            scale = mobile ? '1' : '1.01';
            badgeHtml = `<span style="background: rgba(46, 204, 113, 0.2); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.4); font-size: 0.55rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; margin-left: 8px;">ALVO</span>`;
        }

        const pos = user.position || user.rank || '?';
        const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `<span style="opacity: 0.5;">${pos}º</span>`;
        const name = user.name || user.user?.name || '---';
        const pts = user.points !== undefined ? user.points : (user.totalPoints !== undefined ? user.totalPoints : 0);
        
        return `
        <div style="display: flex; justify-content: space-between; padding: 12px; background: ${bg}; border: ${border}; box-shadow: ${shadow}; border-radius: 10px; margin-bottom: 8px; font-size: 0.85rem; align-items: center; transform: scale(${scale});">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="min-width: 25px; text-align: center; font-weight: bold; font-size: 1.1rem;">${medal}</div>
                <div style="display: flex; align-items: center;">
                    <div style="font-weight: ${weight}; color: ${nameColor};">${name}</div>
                    ${badgeHtml}
                </div>
            </div>
            <div style="font-weight: 900; color: #00ffff; font-family: monospace; font-size: 1rem;">${pts} <span style="font-size: 0.6rem; color: rgba(255,255,255,0.4);">pts</span></div>
        </div>
        `;
    }).join('');

    const subTitle = isPureSimulation 
        ? 'Ranking projetado com os cenários simulados aplicados.' 
        : 'Exibindo classificação atual estável (nenhuma alteração simulada computada).';

    if (window.Swal) {
        Swal.fire({
            title: '📊 Ranking Projetado',
            html: `
                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.6); margin-bottom: 12px;">
                    ${subTitle}
                </div>
                <div style="max-height: ${mobile ? 'calc(100vh - 170px)' : '50vh'}; overflow-y: auto; text-align: left; padding-right: 5px; margin-bottom: 10px; flex: 1;" class="custom-scrollbar">
                    ${listHtml}
                </div>
            `,
            background: '#1a1a2e',
            color: 'white',
            confirmButtonColor: '#2ecc71',
            confirmButtonText: 'Fechar Simulação',
            grow: mobile ? 'fullscreen' : false
        });
    } else {
        let fallbackModal = document.getElementById('fallback-simulated-modal');
        if (!fallbackModal) {
            fallbackModal = document.createElement('div');
            fallbackModal.id = 'fallback-simulated-modal';
            fallbackModal.style = mobile
                ? 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:#1a1a2e; z-index:99999; display:flex; flex-direction:column; padding:20px 15px; box-sizing:border-box; color:white; font-family:system-ui,-apple-system,sans-serif;'
                : 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; color:white; font-family:system-ui,-apple-system,sans-serif;';
            document.body.appendChild(fallbackModal);
        }

        const innerContainerStyle = mobile
            ? 'display:flex; flex-direction:column; height:100%; width:100%; box-sizing:border-box; overflow:hidden;'
            : 'background:#1a1a2e; border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:25px; max-width:480px; width:100%; box-shadow:0 10px 30px rgba(0,0,0,0.5); box-sizing:border-box;';

        const listStyle = mobile
            ? 'flex: 1; overflow-y: auto; margin-bottom: 15px; padding-right: 2px;'
            : 'max-height:40vh; overflow-y:auto; margin-bottom:20px; padding-right:4px;';

        fallbackModal.innerHTML = `
            <div style="${innerContainerStyle}">
                <h3 style="margin-top:0; color:#2ecc71; text-align:center; font-size:1.3rem;">📊 Ranking Projetado</h3>
                <p style="font-size:0.8rem; color:rgba(255,255,255,0.6); text-align:center; margin-bottom:18px;">${subTitle}</p>
                <div style="${listStyle}">
                    ${listHtml}
                </div>
                <button onclick="document.getElementById('fallback-simulated-modal').remove()" style="width:100%; background:#2ecc71; color:white; border:none; padding:14px; border-radius:8px; font-weight:800; cursor:pointer; text-transform:uppercase; margin-top:auto;">Fechar Simulação</button>
            </div>
        `;
        fallbackModal.style.display = 'flex';
    }
};

/* =====================
    🎯 MODAL DE JOGOS DECISIVOS (SECAGEM DO MILAGRE)
===================== */
window.showCriticalMatchesModal = function() {
    
    // Ordem de Dia e Hora 100% Crescente (00:00 -> 23:59) herdando o Helper Global
    const matches = (window.__CRITICAL_MATCHES__ || []).slice().sort((a, b) => {
        const tA = parseMatchTime(a);
        const tB = parseMatchTime(b);
        if (tA > 0 && tB > 0) {
            if (tA !== tB) return tA - tB; 
        }
        const idA = a.matchId || a.id || 0;
        const idB = b.matchId || b.id || 0;
        return idA - idB;
    });
    
    if (matches.length === 0) {
        const msg = 'Não há jogos com secagem direta encontrados no momento.';
        if (window.Swal) Swal.fire('Aviso', msg, 'info');
        else alert(msg);
        return;
    }

    const mobile = isMobile();

    const listHtml = matches.map(m => {
        const teamsArray = m.teams ? m.teams.split(/ x | X | vs | VS /) : [];
        const teamA = teamsArray[0]?.trim() || 'Time A';
        const teamB = teamsArray[1]?.trim() || 'Time B';

        let choiceName = 'Empate';
        if (m.miracleChoice?.toLowerCase() === 'a') choiceName = teamA;
        if (m.miracleChoice?.toLowerCase() === 'b') choiceName = teamB;

        // 🚀 Extração Segura da Secagem no Modal (suporta string ou objeto)
        const rivals = m.opponentsToWatch && m.opponentsToWatch.length > 0 
            ? m.opponentsToWatch.map(op => typeof op === 'string' ? op : (op.name || 'Desconhecido')).join(', ') 
            : 'Ninguém';

        const matchDate = m.date || '';
        const matchTime = m.time ? `às ${m.time}` : '';

        return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,218,68,0.2); border-left: 4px solid #ffda44; border-radius: 8px; padding: 12px; margin-bottom: 10px; text-align: left;">
            <div style="font-size: 0.65rem; color: rgba(255,255,255,0.5); margin-bottom: 6px; text-transform: uppercase; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                <i class="far fa-calendar-alt"></i> ${matchDate} ${matchTime}
            </div>
            <div style="font-weight: 800; color: white; font-size: 0.9rem; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 5px;">${m.teams}</div>
            <div style="font-size: 0.75rem; color: #00ffff; margin-bottom: 4px; display: flex; align-items: center; gap: 5px;">
                <i class="fas fa-check-circle"></i> Precisamos que dê: <strong style="color: #ffda44; text-transform: uppercase;">${choiceName}</strong>
            </div>
            <div style="font-size: 0.7rem; color: #ff6b6b; display: flex; align-items: start; gap: 5px; margin-top: 6px;">
                <i class="fas fa-skull-crossbones" style="margin-top: 2px;"></i> 
                <span>Secando: <strong style="color: white;">${rivals}</strong></span>
            </div>
        </div>
        `;
    }).join('');

    if (window.Swal) {
        Swal.fire({
            title: '⚡ Alvos de Secagem',
            html: `
                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.7); margin-bottom: 15px; text-align: center;">
                    Estes são os confrontos onde você vai tirar a diferença direta contra os seus rivais.
                </div>
                <div style="max-height: ${mobile ? 'calc(100vh - 180px)' : '45vh'}; overflow-y: auto; padding-right: 5px;" class="custom-scrollbar">
                    ${listHtml}
                </div>
            `,
            background: '#1a1a2e',
            color: 'white',
            confirmButtonColor: '#ffda44',
            confirmButtonText: 'Bora secar!',
            grow: mobile ? 'fullscreen' : false
        });
    } else {
        let fallbackModal = document.getElementById('fallback-critical-modal');
        if (!fallbackModal) {
            fallbackModal = document.createElement('div');
            fallbackModal.id = 'fallback-critical-modal';
            fallbackModal.style = mobile
                ? 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:#1a1a2e; z-index:99999; display:flex; flex-direction:column; padding:20px 15px; box-sizing:border-box; color:white; font-family:system-ui,-apple-system,sans-serif;'
                : 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; color:white; font-family:system-ui,-apple-system,sans-serif;';
            document.body.appendChild(fallbackModal);
        }

        const innerContainerStyle = mobile
            ? 'display:flex; flex-direction:column; height:100%; width:100%; box-sizing:border-box; overflow:hidden;'
            : 'background:#1a1a2e; border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:25px; max-width:480px; width:100%; box-shadow:0 10px 30px rgba(0,0,0,0.5); box-sizing:border-box;';

        const listStyle = mobile
            ? 'flex: 1; overflow-y: auto; margin-bottom: 15px; padding-right: 2px;'
            : 'max-height:40vh; overflow-y:auto; margin-bottom:20px; padding-right:4px;';

        fallbackModal.innerHTML = `
            <div style="${innerContainerStyle}">
                <h3 style="margin-top:0; color:#ffda44; text-align:center; font-size:1.3rem;">⚡ Alvos de Secagem</h3>
                <p style="font-size:0.8rem; color:rgba(255,255,255,0.6); text-align:center; margin-bottom:18px;">Estes são os confrontos onde você vai tirar a diferença.</p>
                <div style="${listStyle}" class="custom-scrollbar">
                    ${listHtml}
                </div>
                <button onclick="document.getElementById('fallback-critical-modal').remove()" style="width:100%; background:#ffda44; color:#1a1a2e; border:none; padding:14px; border-radius:8px; font-weight:900; cursor:pointer; text-transform:uppercase; margin-top:auto;">Bora Secar!</button>
            </div>
        `;
        fallbackModal.style.display = 'flex';
    }
};

/* =====================
    🔄 RESET DA SIMULAÇÃO E TOGGLE DO MILAGRE
===================== */
window.resetSimulations = function() {
    clearAllSimulationRequestTimers();
    rankingState.strategyRequestGeneration++;
    rankingState.simulatedResults = {};
    rankingState.isMiracleActive = false; 

    if (typeof toast === 'function') {
        toast('Simulação reiniciada!', 'info');
    }

    const select = document.getElementById('strategy-user-select');
    const selectedId = select ? select.value : null;
    const selectedName = select?.options[select.selectedIndex]?.text.split(' - ')[1] || "SEU";
    
    const loadRanking = getRankingLoader();
    if (loadRanking) loadRanking(selectedId, selectedName);
};

window.toggleMiracleMode = function() {
    clearAllSimulationRequestTimers();
    rankingState.strategyRequestGeneration++;
    rankingState.isMiracleActive = !rankingState.isMiracleActive;
    
    if (rankingState.isMiracleActive) {
        rankingState.strategyMode = 'simulacao';
        document.querySelectorAll('.segment-btn').forEach(b => {
            b.classList.remove('active');
            if (b.dataset.mode === 'simulacao') b.classList.add('active');
        });
        const desc = document.getElementById('toggle-description');
        if (desc) desc.innerText = 'Simule nos cards abaixo e cheque seu Ranking!';
    } else {
        rankingState.simulatedResults = {};
    }

    if (typeof toast === 'function') {
        toast(rankingState.isMiracleActive ? 'Calculando a Rota de Ouro... ✨' : 'Motor do Milagre Desativado.', rankingState.isMiracleActive ? 'success' : 'info');
    }

    const select = document.getElementById('strategy-user-select');
    const selectedId = select ? select.value : null;
    const selectedName = select?.options[select.selectedIndex]?.text.split(' - ')[1] || "SEU";
    
    const loadRanking = getRankingLoader();
    if (loadRanking) loadRanking(selectedId, selectedName);
};
