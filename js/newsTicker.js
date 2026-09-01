// newsTicker.js — Adaptado para a nova versão do frontend (usa api.js)
import { api } from './api.js';

let messages = [];
let currentIndex = 0;
let tickerTimer = null;
let tickerPaused = false;

/* ======================
    FUNÇÕES DE CONTROLE
====================== */
function stopTicker() {
  if (tickerTimer) {
    clearInterval(tickerTimer);
    tickerTimer = null;
  }
}

function startTicker(track) {
  function showMessage() {
    if (tickerPaused) return;
    const msg = messages[currentIndex];
    if (!msg) {
      currentIndex = 0;
      return;
    }
    track.classList.remove('show');
    setTimeout(() => {
      track.innerHTML = msg.html;
      track.classList.add('show');
      currentIndex = (currentIndex + 1) % messages.length;
    }, 200);
  }
  stopTicker();
  showMessage();
  tickerTimer = setInterval(showMessage, 4500);
}

/* ======================
    INIT
====================== */
export async function initNewsTicker() {
  const leagueId = localStorage.getItem('selectedLeagueId');
  const track = document.getElementById('newsTrack');
  const btnReact = document.getElementById('btn-react');
  const picker = document.getElementById('reactionPicker');

  // Se não houver liga, não tenta carregar para evitar erro 400
  if (!track || !leagueId) return;

  try {
    stopTicker();
    messages = [];
    currentIndex = 0;

    // --- 0️⃣ VERIFICAÇÃO DE STATUS ---
    let hasAlreadyBet = false;
    try {
      const myBetsData = await api.myBets(leagueId);
      hasAlreadyBet = myBetsData.success && myBetsData.hasSubmitted === true;
    } catch (e) {
      // Silencioso — usuário pode não estar logado ou não ter apostas
    }

    if (!hasAlreadyBet) {
      messages = [
        { html: '🚀 Preencha seus palpites para este torneio.' },
        { html: '💡 Não esqueça de <strong>Salvar</strong> no final da página.' },
        { html: '🏆 Defina seu <strong>Pódio</strong>' },
        { html: '⚽ Suas apostas só valem após o salvamento com sucesso.' }
      ];
      if (btnReact) btnReact.style.display = 'none';
      startTicker(track);
      return;
    }

    if (btnReact) btnReact.style.display = 'flex';

    /* ======================
        1️⃣ TOP 3 RANKING
    ====================== */
    try {
      const rankRes = await api.leaderboard(leagueId, 'official');
      const ranking = rankRes?.data || [];
      let currentRank = 1;
      let lastPoints = -1;
      ranking.slice(0, 3).forEach((r, i) => {
        const userName = r.user?.name;
        if (userName) {
          if (r.totalPoints !== lastPoints) {
            currentRank = i + 1;
            lastPoints = r.totalPoints;
          }
          messages.push({
            html: `🏆 <strong>${userName}</strong> está em ${currentRank}º lugar com ${r.totalPoints} pts`
          });
        }
      });
    } catch (e) {
      // Silencioso
    }

    /* ======================
        1.5️⃣ DESTAQUES
    ====================== */
    try {
      const highlights = await api.getTickerHighlights(leagueId);
      if (Array.isArray(highlights)) {
        highlights.forEach(h => {
          if (h.pointsLastRound >= 3) {
            messages.push({
              html: `<span style="color: #ffcc00;">🎯<strong>${h.userName}</strong> fez ${h.pointsLastRound} pontos nos jogos de ontem!</span>`
            });
          }
        });
      }
    } catch (e) {
      // Silencioso
    }

    /* ======================
        2️⃣ SUBIU / CAIU
    ====================== */
    try {
      const usersHistory = await api.getPointsHistoryRanking(leagueId);
      if (Array.isArray(usersHistory)) {
        usersHistory.forEach(u => {
          const h = u?.history;
          if (!Array.isArray(h) || h.length < 2) return;

          const last = h[h.length - 1];
          const prev = h[h.length - 2];
          const delta = prev.position - last.position;

          if (Math.abs(delta) >= 3) {
            const userName = u.user?.name;
            if (!userName) return;
            if (delta > 0) {
              messages.push({
                html: `🚀 <strong>${userName}</strong> subiu ${delta} posições!`
              });
            } else if (delta < 0) {
              messages.push({
                html: `📉 <strong>${userName}</strong> caiu ${Math.abs(delta)} posições`
              });
            }
          }
        });
      }
    } catch (e) {
      // Silencioso
    }

    /* ======================
        3️⃣ FRASES + REAÇÕES
    ====================== */
    try {
      const news = await api.getNews(leagueId);
      if (Array.isArray(news)) {
        news.forEach(n => {
          const userName = n.user?.name;
          if (!userName || !n?.text) return;
          const reactions = (n.reactions || []).map(r => `${r.emoji} ${r.count}`).join(' ');
          messages.push({
            newsId: n.id,
            html: `💬 <strong>${userName}:</strong> ${n.text} ${reactions ? `<span class="news-inline-reactions">${reactions}</span>` : ''}`
          });
        });
      }
    } catch (e) {
      // Silencioso
    }

    if (!messages.length) {
      messages.push({ html: '⚽ Acompanhe os resultados e suba no ranking!' });
    }

    startTicker(track);
    wireReactUI(btnReact, picker);

  } catch (err) {
    console.error('Erro ao inicializar NewsTicker:', err);
  }
}

/* ======================
    REAÇÕES E PICKER
====================== */
function wireReactUI(btnReact, picker) {
  if (!btnReact || !picker) return;
  btnReact.onclick = (e) => {
    e.stopPropagation();
    tickerPaused = !tickerPaused;
    if (tickerPaused) picker.removeAttribute('hidden');
    else picker.setAttribute('hidden', '');
  };
  picker.querySelectorAll('button[data-emoji]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const emoji = btn.dataset.emoji;
      const index = currentIndex === 0 ? messages.length - 1 : currentIndex - 1;
      const msg = messages[index];
      if (!msg?.newsId) return closePicker(picker);
      try {
        await api.reactNews(msg.newsId, emoji);
        initNewsTicker();
      } catch (err) {
        console.error("Erro ao reagir:", err);
      } finally {
        closePicker(picker);
      }
    };
  });
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target !== btnReact) closePicker(picker);
  });
}

function closePicker(picker) {
  picker.setAttribute('hidden', '');
  tickerPaused = false;
}
