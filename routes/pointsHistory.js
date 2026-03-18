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
    🔹 RANKING HISTÓRICO GLOBAL (Calculado na hora)
   ============================= */
router.get('/ranking', protect, async (req, res) => {
  try {
    // 1. Pega todas as datas e usuários
    const dates = await PointsHistory.distinct('date');
    dates.sort((a, b) => new Date(a) - new Date(b));
    
    const users = await User.find({}, '_id name').lean();
    
    // Objeto para guardar o histórico de cada um
    const results = users.map(u => ({
      user: { _id: u._id, name: u.name },
      history: []
    }));

    // 2. Para cada data, calculamos as posições de TODO MUNDO
    for (const date of dates) {
      const dayHistory = await PointsHistory.find({ date }).lean();
      
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
    const { otherUserId } = req.query;

    if (!otherUserId) {
      return res.status(400).json({ message: 'otherUserId é obrigatório' });
    }

    const userHistory = await PointsHistory
      .find({ user: req.params.userId })
      .sort({ date: 1 });

    const otherHistory = await PointsHistory
      .find({ user: otherUserId })
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
   🔹 HISTÓRICO POR USUÁRIO
============================= */
router.get('/:userId', protect, async (req, res) => {
  try {
    const history = await PointsHistory
      .find({ user: req.params.userId })
      .sort({ date: 1 });

    res.json(history);
  } catch (err) {
    console.error('Erro ao buscar histórico:', err);
    res.status(500).json({ message: 'Erro ao buscar histórico' });
  }
});

/* =============================
   🔹 RANKING HISTÓRICO (COM EMPATE)
   - Mesma pontuação → mesma posição
   - Ranking esportivo real (1,1,3…)
============================= */
router.get('/ranking/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;

    // Todas as datas únicas do histórico
    const dates = await PointsHistory.distinct('date');
    dates.sort((a, b) => new Date(a) - new Date(b));

    const timeline = [];

    for (const date of dates) {
      const dayHistory = await PointsHistory
        .find({ date })
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
    position = index; // 🔥 pula posições corretamente
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
          position: me.rank, // 👈 nome consistente com o frontend
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

/* =============================
    🔹 DESTAQUES DA ÚLTIMA RODADA (Para o News Ticker)
============================= */
router.get('/ticker/highlights', protect, async (req, res) => {
  try {
    // 1. Descobre qual é a última data gravada no histórico
    const lastEntry = await PointsHistory.findOne().sort({ date: -1 }).lean();
    if (!lastEntry) return res.json([]);

    const lastDate = lastEntry.date;

    // 2. Pega todos os pontos dessa data específica
    const highlights = await PointsHistory.find({ date: lastDate })
      .populate('user', 'name')
      .sort({ points: -1 })
      .lean();

    // 3. Formata para o frontend
    const results = highlights.map(h => ({
      userName: h.user?.name || 'Anônimo',
      pointsLastRound: h.points,
      date: lastDate
    }));

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao buscar destaques' });
  }
});
module.exports = router;
