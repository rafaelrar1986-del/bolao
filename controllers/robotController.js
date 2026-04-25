const axios = require('axios');
const Match = require('../models/Match');
const Settings = require('../models/Settings');
const User = require('../models/User');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');

/**
 * Mapeia os status da API para os Enums do seu MatchSchema
 */
const mapStatus = (apiStatus) => {
    const statusMap = {
        'notstarted': 'scheduled',
        'inprogress': '1_tempo',
        '1st_half': '1_tempo',
        'ht': 'intervalo',
        'halftime': 'intervalo',
        '2nd_half': '2_tempo',
        'extra_time': 'prorrogacao',
        'penalties': 'penaltis',
        'finished': 'finished',
        'cancelled': 'cancelled',
        'postponed': 'postponed'
    };
    return statusMap[apiStatus] || 'scheduled';
};

/**
 * BUSCA DE LIGAS (DINÂMICA)
 */
exports.getAvailableLeagues = async (req, res) => {
    try {
        const API_KEY = process.env.API_FOOTBALL_KEY; 
        
        const response = await axios.get('https://sports.bzzoiro.com/api/leagues/', {
            headers: { 'Authorization': `Token ${API_KEY}` }
        });

        res.json({
            success: true,
            results: response.data.results 
        });
    } catch (error) {
        console.error('Erro ao buscar ligas na API:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao carregar lista de ligas da API externa.' 
        });
    }
};

/**
 * SINCRONIZAÇÃO DE PARTIDAS (ATUALIZADO: BLOQUEIO + VISIBILIDADE + AUDITORIA CSV)
 */
exports.fetchAndSyncMatches = async (req, res) => {
    try {
        const { leagueId, dateFrom, dateTo, phaseType, knockoutPhase, unifyGroups } = req.body;
        const API_KEY = process.env.API_FOOTBALL_KEY;

        if (!leagueId || !dateFrom || !dateTo) {
            return res.status(400).json({ 
                success: false, 
                message: 'Parâmetros leagueId, dateFrom e dateTo são obrigatórios.' 
            });
        }

        let nextUrl = `https://sports.bzzoiro.com/api/events/?date_from=${dateFrom}&date_to=${dateTo}&league=${leagueId}`;
        let allResults = [];

        while (nextUrl) {
            const response = await axios.get(nextUrl, {
                headers: { Authorization: `Token ${API_KEY}` }
            });

            if (response.data && response.data.results) {
                allResults = allResults.concat(response.data.results);
            }
            nextUrl = response.data.next; 
        }

        if (allResults.length === 0) {
            return res.json({ 
                success: true, 
                message: 'Nenhum jogo encontrado.', 
                details: { criados: 0, atualizados: 0 } 
            });
        }

        let updatedCount = 0;
        let createdCount = 0;

        for (const item of allResults) {
            const eventDate = new Date(item.event_date);
            const dateStr = eventDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            const timeStr = eventDate.toLocaleTimeString('pt-BR', { 
                timeZone: 'America/Sao_Paulo', 
                hour: '2-digit', 
                minute: '2-digit' 
            });

            const currentLeagueId = item.league ? Number(item.league.id) : Number(leagueId);
            const currentLeagueName = item.league ? item.league.name : "";

            // --- LÓGICA DE AGRUPAMENTO ---
            let groupValue;
            if (phaseType === 'knockout') {
                groupValue = knockoutPhase; 
            } else if (unifyGroups) {
                groupValue = knockoutPhase || currentLeagueName || 'Classificação Geral';
            } else {
                groupValue = `Rodada ${item.round_number}`;
            }

            const teamA_ID = item.home_team_obj?.id || item.home_id;
            const teamB_ID = item.away_team_obj?.id || item.away_id;

            let match = await Match.findOne({ apiId: item.id });
            const newMappedStatus = mapStatus(item.status);

            // ============================================================
            // 🛡️ LÓGICA DE TRANSIÇÃO: BLOQUEIO, VISIBILIDADE E AUDITORIA
            // ============================================================
            if (match && match.status === 'scheduled' && 
                (newMappedStatus !== 'scheduled' && newMappedStatus !== 'cancelled')) {
                
                const configId = `league_${currentLeagueId}`;
                
                // 1. Tranca a grade e libera o ranking no banco
                await Settings.findByIdAndUpdate(configId, {
                    $addToSet: { lockedPhases: groupValue },
                    $set: { statsLocked: false } 
                });

                console.log(`[ROBÔ] 🔒 Grade "${groupValue}" trancada na liga ${currentLeagueId}. Gerando auditoria...`);
                
                // 2. Processo de Auditoria (CSV + E-mail via Brevo)
                try {
                    // Gera o arquivo físico do CSV
                    const csvFile = await auditService.generateAuditCSV(currentLeagueId, groupValue);
                    
                    if (csvFile) {
                        // Busca e-mails de quem participa desta liga
                        const users = await User.find({ leagues: Number(currentLeagueId) }, 'email');
                        const emailList = users.map(u => u.email).filter(e => !!e);

                        if (emailList.length > 0) {
                            const subject = `🔒 Auditoria Oficial: Grade ${groupValue} Trancada`;
                            const message = `A bola rolou para a fase: ${groupValue}!\n\nConforme as regras do Bolão, os palpites para esta grade foram trancados e a visualização no site está liberada.\n\nSegue em anexo o arquivo CSV contendo a cópia de segurança de todos os palpites para conferência pública.`;

                            // Dispara o broadcast usando seu emailService (Brevo)
                            await emailService.sendBroadcastEmail(emailList, subject, message, csvFile);
                            console.log(`[ROBÔ] 📧 Auditoria enviada para ${emailList.length} usuários.`);
                        }
                    }
                } catch (auditErr) {
                    console.error("❌ Erro no processo de auditoria pós-bloqueio:", auditErr.message);
                }
            }
            // ============================================================

            const updateData = {
                apiId: item.id,
                leagueId: currentLeagueId,
                leagueName: currentLeagueName,
                teamA: item.home_team,
                teamB: item.away_team,
                group: groupValue, 
                phase: phaseType || 'group', 
                date: dateStr,
                time: timeStr,
                status: newMappedStatus,
                scoreA: item.home_score,
                scoreB: item.away_score,
                penaltiesA: item.penalty_shootout?.home ?? null,
                penaltiesB: item.penalty_shootout?.away ?? null,
                apiStatus: item.period || 'NS',
                minute: item.current_minute ? `${item.current_minute}'` : "",
                logoA: teamA_ID ? `https://sports.bzzoiro.com/img/team/${teamA_ID}/?token=${API_KEY}` : (match?.logoA || ''),
                logoB: teamB_ID ? `https://sports.bzzoiro.com/img/team/${teamB_ID}/?token=${API_KEY}` : (match?.logoB || '')
            };

            if (!match) {
                const lastMatch = await Match.findOne().sort({ matchId: -1 });
                const nextId = lastMatch && lastMatch.matchId ? lastMatch.matchId + 1 : 1;
                
                match = new Match({
                    ...updateData,
                    matchId: nextId
                });
                
                await match.save();
                createdCount++;
            } else {
                if (!match.processed) {
                    Object.assign(match, updateData);
                    await match.save();
                    updatedCount++;
                }
            }
        }

        res.json({
            success: true,
            message: `Sincronização concluída! ${allResults.length} jogos processados.`,
            details: { criados: createdCount, atualizados: updatedCount }
        });

    } catch (error) {
        console.error('Erro no RobotController:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao processar a sincronização da API.',
            error: error.message 
        });
    }
};
