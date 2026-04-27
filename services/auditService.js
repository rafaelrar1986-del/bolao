const Bet = require('../models/Bet');
const Match = require('../models/Match');
const fs = require('fs');
const path = require('path');

exports.generateAuditCSV = async (leagueId, groupName) => {
    console.log(`\n[DEBUG AUDITORIA] 🚀 Iniciando geração para Liga: ${leagueId}, Identificador: "${groupName}"`);

    try {
        // 1. Busca partidas - Filtra por Liga e por Grupo ou Fase
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
            console.error(`[DEBUG AUDITORIA] ❌ ERRO: Nenhuma partida encontrada no banco para "${groupName}".`);
            return null;
        }
        console.log(`[DEBUG AUDITORIA] ✅ ${matches.length} partidas encontradas.`);

        // 2. Busca apostas da liga específica
        console.log(`[DEBUG AUDITORIA] 🔍 Buscando apostas para leagueId: "${leagueId}"`);
        const allBets = await Bet.find({ leagueId: String(leagueId) })
            .populate('user', 'name email')
            .lean();

        console.log(`[DEBUG AUDITORIA] 📊 Total de documentos de aposta: ${allBets.length}`);

        // 3. Montagem do CSV com suporte a UTF-8 (acentuação correta no Excel)
        let csv = "\ufeffParticipante;Email;"; 
        csv += matches.map(m => `${m.teamA} x ${m.teamB}`).join(";") + "\n";

        let usersWithBetsCount = 0;
        allBets.forEach(bet => {
            if (!bet.user) return; // Ignora se não houver usuário vinculado

            let row = `${bet.user.name};${bet.user.email};`;
            
            const linhaPalpites = matches.map(m => {
                // Localiza o palpite do usuário para esta partida específica
                const p = (bet.groupMatches || []).find(gm => String(gm.matchId) === String(m.matchId));
                
                if (!p) return "---";

                let infoResultado = "";

                // Converte 'A', 'B' ou 'draw' para o nome real do time ou "Empate"
                if (p.winner === 'A') {
                    infoResultado = m.teamA;
                } else if (p.winner === 'B') {
                    infoResultado = m.teamB;
                } else if (p.winner === 'draw' || p.winner === 'Empate') {
                    infoResultado = "Empate";
                }

                // Se houver informação de classificado (Mata-Mata), adicionamos ao texto
                // Mesmo que o usuário tenha escolhido Time A vencer e Time B passar, o CSV mostrará ambos.
                if (p.qualifier) {
                    const nomeClassificado = p.qualifier === 'A' ? m.teamA : m.teamB;
                    return `${infoResultado} (Passa: ${nomeClassificado})`;
                }

                return infoResultado || "---";
            });

            csv += row + linhaPalpites.join(";") + "\n";
            usersWithBetsCount++;
        });

        console.log(`[DEBUG AUDITORIA] 📝 CSV processado com ${usersWithBetsCount} participantes.`);

        // 4. Criação do arquivo físico no diretório temporário
        const safeName = groupName.replace(/\s/g, '_').replace(/[^\w]/gi, '');
        const fileName = `Auditoria_${safeName}.csv`;
        const filePath = path.join('/tmp', fileName); 
        
        console.log(`[DEBUG AUDITORIA] 📂 Gravando arquivo em: ${filePath}`);
        fs.writeFileSync(filePath, csv);

        // Verificação de integridade
        const stats = fs.statSync(filePath);
        console.log(`[DEBUG AUDITORIA] 📁 Arquivo criado. Tamanho: ${stats.size} bytes.`);

        return {
            path: filePath,
            originalname: fileName
        };

    } catch (error) {
        console.error(`[DEBUG AUDITORIA] 💥 FALHA CRÍTICA NO SERVICE:`, error);
        return null;
    }
};
