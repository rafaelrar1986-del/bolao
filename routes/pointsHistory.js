const express = require('express');
const router = express.Router();

const PointsHistory = require('../models/PointsHistory');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

/* =============================
    🔹 LISTA DE USUÁRIOS
============================= */
router.get('/users/list', protect, async (req, res) => {
  try {
    const users = await User
      .find({}, '_id name')
      .sort({ name: 1 });

    res.json(users);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ message: 'Erro ao listar usuários' });
  }
});

/* =============================
    🔹 RANKING HISTÓRICO GLOBAL (Calculado na hora por Liga)
============================= */
router.get('/ranking', protect, async (req, res) => {
  try {
    const { leagueId } = req.query;
    if (!leagueId) {
      return res.status(400).json({ message: 'leagueId é obrigatório' });
    }

    // 1. Pega todas as datas e usuários vinculados a esta liga
    const dates = await PointsHistory.distinct('date', { leagueId });
    dates.sort((a, b) => new Date(a) - new Date(b));
    
    const users = await User.find({}, '_id name').lean();
    
    // Objeto para guardar o histórico de cada um
    const results = users.map(u => ({
      user: { _id: u._id, name: u.name },
      history: []
    }));

    // 2. Para cada data, calculamos as posições de TODO MUNDO
    for (const date of dates) {
      const dayHistory = await PointsHistory.find({ date, leagueId }).lean();
      
      // Ordena por pontos
      dayHistory.sort((a, b) => b.points - a.points);

      let lastPoints = null;
      let position = 0;
      let index = 0;

      // Cálculo de ranking esportivo (1, 1, 3...)
      const rankedDay = dayHistory.map((h) => {
        index++;
        if (lastPoints === null || h.points < lastPoints) {
          position = index;
          lastPoints = h.points;
        }
        return { userId: String(h.user), rank: position, points: h.points };
      });

      // 3. Distribui a posição do dia para o histórico de cada usuário no resultado
      results.forEach(userObj => {
        const found = rankedDay.find(d => d.userId === String(userObj.user._id));
        if (found) {
          userObj.history.push({
            date,
            position: found.rank,
            points: found.points
          });
        }
      });
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao processar ranking global');
  }
});

/* =============================
    🔹 COMPARAÇÃO ENTRE USUÁRIOS
============================= */
router.get('/compare/:userId', protect, async (req, res) => {
  try {
    const { otherUserId, leagueId } = req.query;

    if (!otherUserId || !leagueId) {
      return res.status(400).json({ message: 'otherUserId e leagueId são obrigatórios' });
    }

    const userHistory = await PointsHistory
      .find({ user: req.params.userId, leagueId })
      .sort({ date: 1 });

    const otherHistory = await PointsHistory
      .find({ user: otherUserId, leagueId })
      .sort({ date: 1 });

    res.json({
      user: userHistory,
      other: otherHistory
    });
  } catch (err) {
    console.error('Erro na comparação de histórico:', err);
    res.status(500).json({ message: 'Erro ao comparar histórico' });
  }
});

/* =============================
    🔹 HISTÓRICO POR USUÁRIO (E LIGA)
============================= */
router.get('/:userId', protect, async (req, res) => {
  try {
    const { leagueId } = req.query;
    if (!leagueId) {
      return res.status(400).json({ message: 'leagueId é obrigatório' });
    }

    const history = await PointsHistory
      .find({ user: req.params.userId, leagueId })
      .sort({ date: 1 });

    res.json(history);
  } catch (err) {
    console.error('Erro ao buscar histórico:', err);
    res.status(500).json({ message: 'Erro ao buscar histórico' });
  }
});

/* =============================
    🔹 RANKING HISTÓRICO INDIVIDUAL (COM EMPATE)
============================= */
router.get('/ranking/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { leagueId } = req.query;

    if (!leagueId) {
      return res.status(400).json({ message: 'leagueId é necessário' });
    }

    // Todas as datas únicas do histórico desta liga
    const dates = await PointsHistory.distinct('date', { leagueId });
    dates.sort((a, b) => new Date(a) - new Date(b));

    const timeline = [];

    for (const date of dates) {
      const dayHistory = await PointsHistory
        .find({ date, leagueId })
        .populate('user', '_id name')
        .lean();

      // Ordena por pontos (desc)
      dayHistory.sort((a, b) => b.points - a.points);

      let lastPoints = null;
      let position = 0;
      let index = 0;

      // Ranking esportivo real (1,1,3…)
      dayHistory.forEach((h) => {
        index++;
        if (lastPoints === null) {
          position = 1;
          lastPoints = h.points;
        } else if (h.points < lastPoints) {
          position = index; 
          lastPoints = h.points;
        }
        h.rank = position;
      });

      // Posição do usuário solicitado
      const me = dayHistory.find(
        h => String(h.user._id) === String(userId)
      );

      if (me) {
        timeline.push({
          date,
          position: me.rank,
          points: me.points
        });
      }
    }

    res.json(timeline);
  } catch (err) {
    console.error('Erro ao gerar ranking histórico:', err);
    res.status(500).json({ message: 'Erro ao gerar ranking histórico' });
  }
});

/* =====================================================
    🔹 DESTAQUES DA ÚLTIMA RODADA (Ganho de pontos real)
===================================================== */
router.get('/ticker/highlights', protect, async (req, res) => {
  try {
    const { leagueId } = req.query;
    if (!leagueId) {
      return res.status(400).json({ message: 'leagueId é necessário' });
    }

    // 1. Pega as duas últimas datas desta liga
    const dates = await PointsHistory.distinct('date', { leagueId });
    dates.sort((a, b) => new Date(b) - new Date(a));

    if (dates.length === 0) return res.json([]);

    const lastDate = dates[0];
    const prevDate = dates[1];

    // 2. Busca registros da última data
    const lastEntries = await PointsHistory.find({ date: lastDate, leagueId })
      .populate('user', 'name')
      .lean();

    // 3. Busca registros da data anterior
    const prevEntries = prevDate 
      ? await PointsHistory.find({ date: prevDate, leagueId }).lean() 
      : [];

    // 4. Calcula a diferença (ganho do dia)
    const results = lastEntries.map(current => {
      const previous = prevEntries.find(p => String(p.user) === String(current.user._id));
      
      const totalAtual = current.points || 0;
      const totalAnterior = previous ? previous.points : 0;
      const ganhoDoDia = totalAtual - totalAnterior;

      return {
        userName: current.user?.name || 'Anônimo',
        pointsLastRound: ganhoDoDia,
        date: lastDate
      };
    });

    // Ordena por quem mais ganhou pontos no dia
    results.sort((a, b) => b.pointsLastRound - a.pointsLastRound);

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao calcular destaques' });
  }
});

module.exports = router;
