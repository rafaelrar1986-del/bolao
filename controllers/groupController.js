const Match = require('../models/Match');

// Caches organizados por LeagueID
let cacheOficial = {};
let cacheParcial = {};
let lastCacheOficial = {};
let lastCacheParcial = {};
const CACHE_DURATION = 30000;

const getGroupStandings = async (req, res) => {
  const now = Date.now();
  const isLiveRequest = req.query.live === 'true';
  
  // Ajuste: Fallback para a liga 1 caso não venha no query
  let leagueId = req.query.leagueId ? Number(req.query.leagueId) : 1;

  // 1. Verificação de Cache por Liga (Prevenção de undefined)
  if (!isLiveRequest && cacheOficial[leagueId] && (now - lastCacheOficial[leagueId] < CACHE_DURATION)) {
    return res.json(cacheOficial[leagueId]);
  }
  if (isLiveRequest && cacheParcial[leagueId] && (now - lastCacheParcial[leagueId] < CACHE_DURATION)) {
    return res.json(cacheParcial[leagueId]);
  }

  try {
    // 2. Busca partidas apenas da liga solicitada
    console.log(`[Standings] Calculando liga: ${leagueId} | Live: ${isLiveRequest}`);

    const allMatches = await Match.find({ leagueId, phase: 'group' }).lean();
    
    if (!allMatches || allMatches.length === 0) {
      // Se não houver partidas, retornamos um objeto vazio
      return res.json({});
    }

    const standings = {};

    // 3. Inicializar times
    allMatches.forEach(m => {
      [m.teamA, m.teamB].forEach(t => {
        if (t && !standings[t]) {
          standings[t] = { 
            name: t, 
            group: m.group, 
            pj: 0, v: 0, e: 0, d: 0, 
            gp: 0, gc: 0, sg: 0, pts: 0, 
            qualified: false 
          };
        }
      });
    });

    // 4. Filtrar partidas conforme o modo (Live ou Oficial)
    const activeMatches = allMatches.filter(m => 
      isLiveRequest ? m.status !== 'scheduled' : m.status === 'finished'
    );

    // 5. Processar tabela
    activeMatches.forEach(m => {
      const { teamA, teamB, scoreA, scoreB } = m;
      if (typeof scoreA === 'number' && typeof scoreB === 'number') {
        const sA = standings[teamA];
        const sB = standings[teamB];
        
        if (sA && sB) {
          sA.pj++; sB.pj++;
          sA.gp += scoreA; sA.gc += scoreB;
          sB.gp += scoreB; sB.gc += scoreA;
          
          if (scoreA > scoreB) { 
            sA.v++; sA.pts += 3; sB.d++; 
          } else if (scoreB > scoreA) { 
            sB.v++; sB.pts += 3; sA.d++; 
          } else { 
            sA.e++; sA.pts += 1; sB.e++; sB.pts += 1; 
          }
          sA.sg = sA.gp - sA.gc; 
          sB.sg = sB.gp - sB.gc;
        }
      }
    });

    // 6. Agrupar por Grupo
    const groupedResults = {};
    Object.values(standings).forEach(t => {
      if (!groupedResults[t.group]) groupedResults[t.group] = [];
      groupedResults[t.group].push(t);
    });

    // 7. Ordenação (Regras Oficiais: Confronto Direto Primeiro)
    for (const groupName in groupedResults) {
      groupedResults[groupName].sort((a, b) => {
        // Regra Base: Pontos gerais em todas as partidas do grupo
        if (b.pts !== a.pts) return b.pts - a.pts;

        // ==========================================
        // PREPARAÇÃO PARA O PRIMEIRO PASSO
        // Isolar apenas os confrontos diretos entre A e B
        // ==========================================
        const h2hMatches = activeMatches.filter(m => 
          (m.teamA === a.name && m.teamB === b.name) || 
          (m.teamA === b.name && m.teamB === a.name)
        );

        let h2hPtsA = 0, h2hPtsB = 0;
        let h2hSgA = 0, h2hSgB = 0;
        let h2hGpA = 0, h2hGpB = 0;

        h2hMatches.forEach(m => {
          if (typeof m.scoreA === 'number' && typeof m.scoreB === 'number') {
            const golsA = m.teamA === a.name ? m.scoreA : m.scoreB;
            const golsB = m.teamA === b.name ? m.scoreA : m.scoreB;

            // Gols Pró (H2H)
            h2hGpA += golsA;
            h2hGpB += golsB;

            // Saldo de Gols (H2H)
            h2hSgA += (golsA - golsB);
            h2hSgB += (golsB - golsA);

            // Pontos (H2H)
            if (golsA > golsB) h2hPtsA += 3;
            else if (golsB > golsA) h2hPtsB += 3;
            else { h2hPtsA += 1; h2hPtsB += 1; }
          }
        });

        // ==========================================
        // PRIMEIRO PASSO (Entre as equipes envolvidas)
        // ==========================================
        
        // 1. Maior número de pontos obtidos nos confrontos diretos
        if (h2hPtsB !== h2hPtsA) return h2hPtsB - h2hPtsA;

        // 2. Saldo de gols superior nos confrontos diretos
        if (h2hSgB !== h2hSgA) return h2hSgB - h2hSgA;

        // 3. Maior número de gols marcados nos confrontos diretos
        if (h2hGpB !== h2hGpA) return h2hGpB - h2hGpA;

        // ==========================================
        // SEGUNDO PASSO (Se continuarem empatados)
        // ==========================================
        
        // 4. Melhor saldo de gols em todas as partidas do grupo
        if (b.sg !== a.sg) return b.sg - a.sg;

        // 5. Maior número de gols marcados em todas as partidas do grupo
        if (b.gp !== a.gp) return b.gp - a.gp;

        // ==========================================
        // CRITÉRIO FINAL (Segurança do Sistema)
        // ==========================================
        // Se empatarem em TUDO (inclusive no geral), usa ordem alfabética 
        // para o JavaScript não bugar a renderização da tabela.
        return a.name.localeCompare(b.name);
      });
    }

    // 8. Melhores Terceiros (Regra Copa 2026: 12 grupos -> 8 melhores)
    const allThirdPlaces = Object.values(groupedResults)
      .map(g => g[2]) // Pega o 3º colocado de cada grupo (índice 2 do array)
      .filter(Boolean) // Garante que não vai dar erro se o grupo estiver vazio
      .sort((a, b) => {
        // 1. Maior número de pontos obtidos em todas as partidas do grupo
        if (b.pts !== a.pts) return b.pts - a.pts;

        // 2. Saldo de gols resultante de todas as partidas do grupo
        if (b.sg !== a.sg) return b.sg - a.sg;

        // 3. Maior número de gols marcados em todas as partidas do grupo
        if (b.gp !== a.gp) return b.gp - a.gp;

        // CRITÉRIO DE SEGURANÇA (Caso de Empate Absoluto)
        return a.name.localeCompare(b.name);
      });

    const best8Names = allThirdPlaces.slice(0, 8).map(t => t.name);

    // 9. Marcar Qualificados
    for (const g in groupedResults) {
      groupedResults[g].forEach((t, i) => {
        t.qualified = (i < 2 || (i === 2 && best8Names.includes(t.name)));
      });
    }

    // 10. Salvar Cache
    if (isLiveRequest) { 
      cacheParcial[leagueId] = groupedResults; 
      lastCacheParcial[leagueId] = now; 
    } else { 
      cacheOficial[leagueId] = groupedResults; 
      lastCacheOficial[leagueId] = now; 
    }

    res.json(groupedResults);
  } catch (error) {
    console.error(`[Error Standings] Liga ${leagueId}:`, error);
    res.status(500).json({ error: 'Erro ao processar classificação.' });
  }
};

module.exports = { getGroupStandings };
