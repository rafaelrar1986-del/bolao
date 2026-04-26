const Bet = require('../models/Bet');
const Match = require('../models/Match');
const fs = require('fs');
const path = require('path');

exports.generateAuditCSV = async (leagueId, groupName) => {
    console.log(`\n[DEBUG AUDITORIA] 🚀 Iniciando geração para Liga: ${leagueId}, Identificador: "${groupName}"`);

    try {
        // 1. Busca partidas - Logando a query para ver o que o Mongo está procurando
        const matchQuery = { 
            leagueId: Number(leagueId), 
            $or: [
                { group: groupName },
                { phaseName: groupName }
            ]
        };
        console.log(`[DEBUG AUDITORIA] 🔍 Buscando jogos com query:`, JSON.stringify(matchQuery));

        const matches = await Match.find(matchQuery).sort({ matchId: 1 }).lean();

        if (matches.length === 0) {
            console.error(`[DEBUG AUDITORIA] ❌ ERRO: Nenhuma partida encontrada no banco para "${groupName}". Verifique se o campo group ou phaseName no banco é idêntico.`);
            return null;
        }
        console.log(`[DEBUG AUDITORIA] ✅ ${matches.length} partidas encontradas.`);

        // 2. Busca apostas - Verificando o tipo do leagueId
        console.log(`[DEBUG AUDITORIA] 🔍 Buscando apostas para leagueId (String): "${leagueId}"`);
        const allBets = await Bet.find({ leagueId: String(leagueId) })
            .populate('user', 'name email')
            .lean();

        console.log(`[DEBUG AUDITORIA] 📊 Total de apostas recuperadas do banco: ${allBets.length}`);

        if (allBets.length === 0) {
            console.warn(`[DEBUG AUDITORIA] ⚠️ Nenhuma aposta (documento Bet) encontrada para a liga ${leagueId}. O CSV ficará apenas com o cabeçalho.`);
        }

        // 3. Montagem do CSV
        let csv = "\ufeffParticipante;Email;"; 
        csv += matches.map(m => `${m.teamA} x ${m.teamB}`).join(";") + "\n";

        let usersWithBetsCount = 0;
        allBets.forEach(bet => {
            if (!bet.user) {
                console.log(`[DEBUG AUDITORIA] 💡 Aposta ignorada: documento Bet sem usuário vinculado (ID: ${bet._id})`);
                return;
            }

            let row = `${bet.user.name};${bet.user.email};`;
            const palpites = matches.map(m => {
                // Compara matchId garantindo que ambos sejam String para não falhar
                const p = (bet.groupMatches || []).find(gm => String(gm.matchId) === String(m.matchId));
                
                if (!p) return "---";
                if (p.winner === 'A') return m.teamA;
                if (p.winner === 'B') return m.teamB;
                if (p.winner === 'Empate' || p.winner === 'draw') return "Empate";
                
                // Se for pontos corridos com placar
                if (p.scoreA !== undefined && p.scoreB !== undefined) return `${p.scoreA}x${p.scoreB}`;
                
                return "---";
            });

            csv += row + palpites.join(";") + "\n";
            usersWithBetsCount++;
        });

        console.log(`[DEBUG AUDITORIA] 📝 CSV processado com ${usersWithBetsCount} linhas de usuários.`);

        // 4. Criação do arquivo
        const safeName = groupName.replace(/\s/g, '_').replace(/[^\w]/gi, '');
        const fileName = `Auditoria_${safeName}.csv`;
        const filePath = path.join('/tmp', fileName); 
        
        console.log(`[DEBUG AUDITORIA] 📂 Gravando arquivo em: ${filePath}`);
        
        fs.writeFileSync(filePath, csv);

        // Verificação final de tamanho
        const stats = fs.statSync(filePath);
        console.log(`[DEBUG AUDITORIA] 📁 Arquivo criado com sucesso. Tamanho: ${stats.size} bytes.`);

        return {
            path: filePath,
            originalname: fileName
        };

    } catch (error) {
        console.error(`[DEBUG AUDITORIA] 💥 FALHA CRÍTICA NO SERVICE:`, error);
        return null;
    }
};
