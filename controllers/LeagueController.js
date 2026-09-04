const League = require('../models/League');
const Match = require('../models/Match');

/**
 * Busca os campeonatos ativos cadastrados no sistema.
 *
 * A fonte principal é League, pois um campeonato pode existir antes de
 * possuir qualquer partida. Para compatibilidade com instalações antigas,
 * também incorporamos ligas que ainda só existem em Match.
 */
exports.getActiveLeagues = async (req, res) => {
    try {
        const [registered, existing] = await Promise.all([
            League.find({ status: { $ne: 'archived' } })
                .select('leagueId name status')
                .sort({ name: 1 })
                .lean(),
            Match.aggregate([
                { $match: { leagueId: { $ne: null } } },
                {
                    $group: {
                        _id: '$leagueId',
                        leagueName: { $first: '$leagueName' },
                        totalMatches: { $sum: 1 }
                    }
                }
            ])
        ]);

        const matchCounts = new Map(
            existing.map(item => [String(item._id), {
                name: item.leagueName || `Liga ${item._id}`,
                count: Number(item.totalMatches || 0)
            }])
        );

        const seen = new Set();
        const leagues = [];

        for (const league of registered) {
            const id = String(league.leagueId);
            const fallback = matchCounts.get(id);
            leagues.push({
                id,
                name: league.name || fallback?.name || `Liga ${id}`,
                count: fallback?.count || 0
            });
            seen.add(id);
        }

        // Compatibilidade: campeonatos antigos que ainda não possuem registro
        // em League continuam disponíveis para os usuários.
        for (const item of existing) {
            const id = String(item._id);
            if (seen.has(id)) continue;
            leagues.push({
                id,
                name: item.leagueName || `Liga ${id}`,
                count: Number(item.totalMatches || 0)
            });
        }

        leagues.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

        res.json({
            success: true,
            leagues
        });
    } catch (error) {
        console.error('Erro ao buscar ligas ativas:', error);
        res.status(500).json({ success: false, message: 'Erro ao carregar ligas.' });
    }
};
