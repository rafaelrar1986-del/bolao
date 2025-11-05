// js/app.js

// --- Importações principais (não quebrem se algum módulo expor nomes diferentes) ---
import { checkAuthAndStart } from "./auth.js";
import { setupTabs, showToast } from "./ui.js";

// Imports "flexíveis": pegamos todos os exports e escolhemos a função existente
import * as MyBets from "./myBets.js";
import * as Ranking from "./ranking.js";
import * as AllBets from "./allBets.js";
import * as Admin from "./admin.js";

// Helper para chamar função se existir, sem quebrar a página
function callIfExists(obj, candidates = [], ...args) {
  for (const name of candidates) {
    if (typeof obj[name] === "function") {
      try {
        return obj[name](...args);
      } catch (e) {
        console.error(`[app] Erro ao executar ${name}:`, e);
        showToast?.("error", `Erro ao carregar: ${name}`);
      }
    }
  }
  // silencioso se nenhuma função existir
}

// Carregar conteúdo padrão das abas após autenticação
function loadDefaultTabs(isAdmin) {
  // Meus Palpites
  callIfExists(MyBets, ["initMyBets", "loadMyBets", "mountMyBets"]);

  // Ranking
  callIfExists(Ranking, ["initRanking", "loadRanking", "mountRanking"]);

  // Todos os Palpites
  callIfExists(AllBets, ["initAllBets", "loadAllBetsUI", "mountAllBets"]);

  // Administração (somente se admin)
  if (isAdmin) {
    callIfExists(Admin, ["initAdminUI", "loadAdminUI", "mountAdmin"]);
  }
}

// Observa troca de abas para recarregar conteúdo quando necessário
function attachTabObservers(isAdmin) {
  const tabMap = {
    "my-bets": () => callIfExists(MyBets, ["initMyBets", "loadMyBets", "mountMyBets"]),
    "ranking": () => callIfExists(Ranking, ["initRanking", "loadRanking", "mountRanking"]),
    "all-bets": () => callIfExists(AllBets, ["initAllBets", "loadAllBetsUI", "mountAllBets"]),
    "admin": () => isAdmin && callIfExists(Admin, ["initAdminUI", "loadAdminUI", "mountAdmin"]),
  };

  document.querySelectorAll(".tab").forEach((el) => {
    el.addEventListener("click", () => {
      const tab = el.dataset.tab;
      if (tab && tabMap[tab]) {
        tabMap[tab]();
      }
    });
  });
}

// Exporte a função esperada pelo index.html
export function initApp() {
  const start = () => {
    // checkAuthAndStart cuida de validar token e obter /auth/me
    checkAuthAndStart({
      onLogin: (user) => {
        const isAdmin = !!user?.isAdmin;

        // Monta as abas (mostra/esconde a de Admin conforme backend)
        setupTabs(isAdmin);

        // Carrega conteúdo inicial
        loadDefaultTabs(isAdmin);

        // Observa mudança de abas para recarregar o conteúdo certo
        attachTabObservers(isAdmin);
      },
      onLogout: () => {
        // Se quiser, pode redirecionar ou resetar UI aqui
        showToast?.("info", "Sessão encerrada");
        setupTabs(false);
      },
      onError: (err) => {
        console.error("[app] Erro de autenticação:", err);
        setupTabs(false);
        // Mesmo sem login, se houver abas públicas, elas podem ser inicializadas aqui
        callIfExists(Ranking, ["initRanking", "loadRanking", "mountRanking"]);
      },
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
