const Bet = require('../models/Bet');
const Match = require('../models/Match');
const fs = require('fs');
const path = require('path');

exports.generateAuditCSV = async (leagueId, groupName) => {
    const matches = await Match.find({ 
        leagueId: Number(leagueId), 
        group: groupName 
    }).sort({ matchId: 1 }).lean();

    if (matches.length === 0) return null;

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
            const p = (bet.groupMatches || []).find(gm => gm.matchId === m.matchId);
            if (!p) return "---";
            if (p.winner === 'A') return m.teamA;
            if (p.winner === 'B') return m.teamB;
            return "Empate";
        });
        csv += row + palpites.join(";") + "\n";
    });

    // Criar arquivo temporário para o Brevo ler
    const fileName = `Auditoria_${groupName.replace(/\s/g, '_')}.csv`;
    const filePath = path.join('/tmp', fileName); // No Windows pode usar path.join(__dirname, fileName)
    
    fs.writeFileSync(filePath, csv);

    return {
        path: filePath,
        originalname: fileName
    };
};
