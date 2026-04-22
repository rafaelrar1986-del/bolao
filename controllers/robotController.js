const axios = require('axios');
const Match = require('../models/Match');

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
 * Usa o process.env.API_FOOTBALL_KEY para autorização
 */
exports.getAvailableLeagues = async (req, res) => {
    try {
        // Puxa a chave do .env para garantir que a API aceite a chamada
        const API_KEY = process.env.API_FOOTBALL_KEY; 
        
        const response = await axios.get('https://sports.bzzoiro.com/api/leagues/', {
            headers: { 'Authorization': `Token ${API_KEY}` }
        });

        // Retorna a lista de ligas (results) para o Frontend
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
 * SINCRONIZAÇÃO DE PARTIDAS
 */
exports.fetchAndSyncMatches = async (req, res) => {
    try {
        const { leagueId, dateFrom, dateTo, phaseType, knockoutPhase } = req.body;
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
            const groupValue = phaseType === 'knockout' ? knockoutPhase : `Rodada ${item.round_number}`;

            const teamA_ID = item.home_team_obj?.id || item.home_id;
            const teamB_ID = item.away_team_obj?.id || item.away_id;

            let match = await Match.findOne({ apiId: item.id });

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
                status: mapStatus(item.status),
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
                // Proteção: só atualiza se a partida não foi finalizada/processada
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
