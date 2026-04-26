const Bet = require('../models/Bet');
const Match = require('../models/Match');
const fs = require('fs');
const path = require('path');

exports.generateAuditCSV = async (leagueId, groupName) => {
    // --- CORREÇÃO DA BUSCA ---
    // Agora ele busca jogos da liga onde o identificador (Rodada ou Grupo) coincida
    const matches = await Match.find({ 
        leagueId: Number(leagueId),
        $or: [
            { group: groupName },
            { phaseName: groupName }
        ]
    }).sort({ matchId: 1 }).lean();

    // Se não achar jogos com esse nome, o e-mail não seria enviado. 
    // Com a busca $or acima, ele vai achar tanto "Grupo A" quanto "Rodada 6".
    if (matches.length === 0) {
        console.log(`[AUDITORIA] Nenhum jogo encontrado para a liga ${leagueId} com identificador ${groupName}`);
        return null;
    }

    const allBets = await Bet.find({ leagueId: String(leagueId) })
        .populate('user', 'name email')
        .lean();

    // Montagem do CSV (Ponto e vírgula para Excel PT-BR)
    let csv = "\ufeffParticipante;Email;"; 
    csv += matches.map(m => `${m.teamA} x ${m.teamB}`).join(";") + "\n";

    allBets.forEach(bet => {
        if (!bet.user) return;
        let row = `${bet.user.name};${bet.user.email};`;
        const palpites = matches.map(m => {
            // Busca o palpite dentro do array de groupMatches do usuário
            const p = (bet.groupMatches || []).find(gm => gm.matchId === m.matchId);
            if (!p) return "---";
            
            // Lógica de exibição do palpite no CSV
            if (p.winner === 'A') return m.teamA;
            if (p.winner === 'B') return m.teamB;
            if (p.winner === 'Empate' || p.winner === 'draw') return "Empate";
            
            // Caso seu sistema use placares (scoreA/scoreB) no palpite
            if (p.scoreA !== undefined && p.scoreB !== undefined) {
                return `${p.scoreA} x ${p.scoreB}`;
            }
            
            return "---";
        });
        csv += row + palpites.join(";") + "\n";
    });

    // Criar arquivo temporário sanitizando o nome para evitar erros de caractere no anexo
    const safeFileName = groupName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `Auditoria_${safeFileName}.csv`;
    const filePath = path.join('/tmp', fileName); 
    
    try {
        fs.writeFileSync(filePath, csv);
    } catch (fsErr) {
        console.error("❌ Erro ao escrever arquivo de auditoria:", fsErr.message);
        return null;
    }

    return {
        path: filePath,
        originalname: fileName
    };
};
