const Match = require('../models/Match');

/**
 * Busca todas as ligas únicas que possuem partidas no banco
 */
exports.getActiveLeagues = async (req, res) => {
    try {
        // O aggregate vai agrupar por leagueId para não repetir a mesma liga
        const activeLeagues = await Match.aggregate([
            {
                $group: {
                    _id: "$leagueId", // Agrupa pelo ID da liga
                    leagueName: { $first: "$leagueName" }, // Pega o primeiro nome que encontrar
                    totalMatches: { $sum: 1 }, // Opcional: conta quantos jogos tem nela
                    logoA: { $first: "$logoA" } // Opcional: usa um logo de time como referência visual se quiser
                }
            },
            { $sort: { leagueName: 1 } } // Coloca em ordem alfabética
        ]);

        res.json({
            success: true,
            leagues: activeLeagues.map(l => ({
                id: l._id,
                name: l.leagueName,
                count: l.totalMatches
            }))
        });
    } catch (error) {
        console.error('Erro ao buscar ligas ativas:', error);
        res.status(500).json({ success: false, message: 'Erro ao carregar ligas.' });
    }
};
