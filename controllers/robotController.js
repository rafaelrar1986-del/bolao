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
        
        const response = await axios.get('https://sports.bzzoiro.com/api/v2/leagues/', {
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

// =============================
// DICIONÁRIO DE TRADUÇÃO
// =============================

const teamTranslations = {

    // Américas
    'Argentina': 'Argentina',
    'Brazil': 'Brasil',
    'Canada': 'Canadá',
    'Chile': 'Chile',
    'Colombia': 'Colômbia',
    'Costa Rica': 'Costa Rica',
    'Ecuador': 'Equador',
    'Mexico': 'México',
    'Panama': 'Panamá',
    'Peru': 'Peru',
    'Paraguay': 'Paraguai',
    'Uruguay': 'Uruguai',
    'United States': 'Estados Unidos',

    // Europa
    'Austria': 'Áustria',
    'Belgium': 'Bélgica',
    'Croatia': 'Croácia',
    'Czech Republic': 'Chéquia',
    'Denmark': 'Dinamarca',
    'England': 'Inglaterra',
    'France': 'França',
    'Germany': 'Alemanha',
    'Greece': 'Grécia',
    'Hungary': 'Hungria',
    'Iceland': 'Islândia',
    'Italy': 'Itália',
    'Netherlands': 'Países Baixos',
    'Northern Ireland': 'Irlanda do Norte',
    'Norway': 'Noruega',
    'Poland': 'Polônia',
    'Portugal': 'Portugal',
    'Republic of Ireland': 'Irlanda',
    'Romania': 'Romênia',
    'Russia': 'Rússia',
    'Scotland': 'Escócia',
    'Serbia': 'Sérvia',
    'Slovakia': 'Eslováquia',
    'Slovenia': 'Eslovênia',
    'Spain': 'Espanha',
    'Sweden': 'Suécia',
    'Switzerland': 'Suíça',
    'Turkey': 'Turquia',
    'Ukraine': 'Ucrânia',
    'Wales': 'País de Gales',

    // África
    'Algeria': 'Argélia',
    'Angola': 'Angola',
    'Cameroon': 'Camarões',
    'DR Congo': 'RD do Congo',
    'Egypt': 'Egito',
    'Ghana': 'Gana',
    'Ivory Coast': 'Costa do Marfim',
    'Morocco': 'Marrocos',
    'Nigeria': 'Nigéria',
    'Senegal': 'Senegal',
    'South Africa': 'África do Sul',
    'Tunisia': 'Tunísia',

    // Ásia e Oceania
    'Australia': 'Austrália',
    'China': 'China',
    'Iran': 'Irã',
    'Japan': 'Japão',
    'New Zealand': 'Nova Zelândia',
    'North Korea': 'Coreia do Norte',
    'Saudi Arabia': 'Arábia Saudita',
    'South Korea': 'Coreia do Sul',
    'Qatar': 'Catar',
    'United Arab Emirates': 'Emirados Árabes Unidos'
};

// =============================
// FUNÇÃO DE TRADUÇÃO
// =============================

function translateTeamName(name) {
    return teamTranslations[name] || name;
}

exports.fetchAndSyncMatches = async (req, res) => {
    try {
        // Recebemos os parâmetros do admin.js
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

        // Paginação da API
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

            const dateStr = eventDate.toLocaleDateString('pt-BR', { 
                timeZone: 'America/Sao_Paulo' 
            });

            const timeStr = eventDate.toLocaleTimeString('pt-BR', { 
                timeZone: 'America/Sao_Paulo',
                hour: '2-digit',
                minute: '2-digit'
            });

            const currentLeagueId = item.league 
                ? Number(item.league.id) 
                : Number(leagueId);

            const currentLeagueName = item.league 
                ? item.league.name 
                : "";

            // =========================================
            // LÓGICA DE AGRUPAMENTO E RODADAS
            // =========================================

            let groupValue;
            let phaseNameValue = null;

            if (phaseType === 'knockout') {

                groupValue = knockoutPhase;
                phaseNameValue = knockoutPhase;

            } else if (unifyGroups) {

                // Pontos corridos
                groupValue = knockoutPhase || currentLeagueName || 'Classificação Geral';

                phaseNameValue = item.round_number
                    ? `Rodada ${item.round_number}`
                    : null;

            } else {

                // Fase de grupos
                let apiGroup = item.group_name || `Rodada ${item.round_number}`;

                // Traduz "Group X" -> "Grupo X"
                groupValue = apiGroup.replace(/^Group\s+/i, 'Grupo ');

                // =========================================
                // SE EXISTIR GROUP_NAME => phaseName = Grupos
                // SENÃO => Rodada X
                // =========================================
                if (item.group_name) {
                    phaseNameValue = 'Grupos';
                } else {
                    phaseNameValue = item.round_number
                        ? `Rodada ${item.round_number}`
                        : null;
                }
            } // 👈 Chave corrigida aqui! Fechando o bloco 'else' principal do agrupamento.

            const teamA_ID = item.home_team_obj?.id || item.home_id;
            const teamB_ID = item.away_team_obj?.id || item.away_id;

            let match = await Match.findOne({ apiId: item.id });

            const updateData = {

                apiId: item.id,

                leagueId: currentLeagueId,
                leagueName: currentLeagueName,

                // =========================================
                // TRADUÇÃO DOS TIMES
                // =========================================

                teamA: translateTeamName(item.home_team),
                teamB: translateTeamName(item.away_team),

                group: groupValue,

                phase: phaseType || 'group',

                // suporte para bloqueio por rodada unificada
                phaseName: phaseNameValue,

                date: dateStr,
                time: timeStr,

                status: mapStatus(item.status),

                scoreA: item.home_score,
                scoreB: item.away_score,

                penaltiesA: item.penalty_shootout?.home ?? null,
                penaltiesB: item.penalty_shootout?.away ?? null,

                apiStatus: item.period || 'NS',

                minute: item.current_minute
                    ? `${item.current_minute}'`
                    : "",

                // Mantém logos existentes se API falhar
                logoA: teamA_ID
                    ? `https://sports.bzzoiro.com/img/team/${teamA_ID}/?token=${API_KEY}`
                    : (match?.logoA || ''),

                logoB: teamB_ID
                    ? `https://sports.bzzoiro.com/img/team/${teamB_ID}/?token=${API_KEY}`
                    : (match?.logoB || '')
            };

            if (!match) {

                const lastMatch = await Match.findOne()
                    .sort({ matchId: -1 });

                const nextId = lastMatch && lastMatch.matchId
                    ? lastMatch.matchId + 1
                    : 1;

                match = new Match({
                    ...updateData,
                    matchId: nextId
                });

                await match.save();

                createdCount++;

            } else {

                // Só atualiza se ainda não foi processada
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
            details: {
                criados: createdCount,
                atualizados: updatedCount
            }
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
