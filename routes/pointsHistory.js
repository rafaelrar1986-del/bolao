const express = require('express');
const router = express.Router();

const PointsHistory = require('../models/PointsHistory');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

function toLeagueId(leagueId) {
  return leagueId != null ? String(leagueId).trim() : 'default';
}

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

    const lid = toLeagueId(leagueId);

    // Uma única consulta para toda a linha do tempo da liga.
    const history = await PointsHistory
      .find({ leagueId: lid })
      .sort({ date: 1, points: -1 })
      .populate('user', '_id name')
      .lean();

    const usersMap = new Map();

    for (const h of history) {
      if (!h.user) continue;

      const userId = String(h.user._id);
      if (!usersMap.has(userId)) {
        usersMap.set(userId, {
          user: { _id: h.user._id, name: h.user.name },
          history: []
        });
      }
    }

    // Cada registro diário já possui a posição persistida.
    // Para compatibilidade com registros antigos, calcula a posição
    // apenas quando ela estiver ausente.
    const byDate = new Map();

    for (const h of history) {
      const key = new Date(h.date).getTime();
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(h);
    }

    for (const [dateKey, entries] of byDate) {
      let ranked = entries;

      if (ranked.some(h => !Number.isInteger(Number(h.position)) || Number(h.position) < 1)) {
        ranked = [...entries].sort((a, b) => Number(b.points || 0) - Number(a.points || 0));

        let lastPoints = null;
        let position = 0;

        ranked.forEach((h, index) => {
          const points = Number(h.points || 0);
          if (lastPoints === null || points < lastPoints) {
            position = index + 1;
            lastPoints = points;
          }
          h.__position = position;
        });
      }

      for (const h of entries) {
        const userId = String(h.user._id);
        const position = Number.isInteger(Number(h.position)) && Number(h.position) >= 1
          ? Number(h.position)
          : h.__position;

        usersMap.get(userId)?.history.push({
          date: h.date,
          position,
          points: h.points
        });
      }
    }

    const results = Array.from(usersMap.values());

    results.forEach(item => {
      item.history.sort((a, b) => new Date(a.date) - new Date(b.date));
    });

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
      .find({ user: req.params.userId, leagueId: toLeagueId(leagueId) })
      .sort({ date: 1 });

    const otherHistory = await PointsHistory
      .find({ user: otherUserId, leagueId: toLeagueId(leagueId) })
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
      .find({ user: req.params.userId, leagueId: toLeagueId(leagueId) })
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

    const lid = toLeagueId(leagueId);

    // Uma única consulta para toda a linha do tempo da liga.
    const history = await PointsHistory
      .find({ leagueId: lid })
      .sort({ date: 1, points: -1 })
      .lean();

    const byDate = new Map();

    for (const h of history) {
      const key = new Date(h.date).getTime();
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(h);
    }

    const timeline = [];

    for (const [dateKey, entries] of byDate) {
      let target = entries.find(h => String(h.user) === String(userId));
      if (!target) continue;

      let position = Number(target.position);

      if (!Number.isInteger(position) || position < 1) {
        const ranked = [...entries].sort(
          (a, b) => Number(b.points || 0) - Number(a.points || 0)
        );

        let lastPoints = null;
        position = 0;

        ranked.forEach((h, index) => {
          const points = Number(h.points || 0);
          if (lastPoints === null || points < lastPoints) {
            position = index + 1;
            lastPoints = points;
          }

          if (String(h.user) === String(userId)) {
            target = h;
          }
        });
      }

      timeline.push({
        date: target.date,
        position,
        points: target.points
      });
    }

    timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

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
    const dates = await PointsHistory.distinct('date', { leagueId: toLeagueId(leagueId) });
    dates.sort((a, b) => new Date(b) - new Date(a));

    if (dates.length === 0) return res.json([]);

    const lastDate = dates[0];
    const prevDate = dates[1];

    // 2. Busca registros da última data
    const lastEntries = await PointsHistory.find({ date: lastDate, leagueId: toLeagueId(leagueId) })
      .populate('user', 'name')
      .lean();

    // 3. Busca registros da data anterior
    const prevEntries = prevDate 
      ? await PointsHistory.find({ date: prevDate, leagueId: toLeagueId(leagueId) }).lean() 
      : [];

    // 4. Calcula a diferença (ganho do dia)
    // Indexa o snapshot anterior para evitar uma busca O(n²).
    const previousByUser = new Map(
      prevEntries.map(entry => [String(entry.user), Number(entry.points || 0)])
    );

    // Calcula a diferença entre os dois snapshots acumulados.
    const results = lastEntries.map(current => {
      const userId = current.user?._id ?? current.user;
      const totalAtual = Number(current.points || 0);
      const totalAnterior = previousByUser.get(String(userId)) ?? 0;
      const ganhoDoDia = totalAtual - totalAnterior;

      return {
        userName: current.user?.name || 'Anônimo',
        pointsLastRound: ganhoDoDia,
        date: lastDate
      };
    });

    // Maior ganho primeiro; em empate, nome para saída determinística.
    results.sort((a, b) => {
      const pointsDiff = b.pointsLastRound - a.pointsLastRound;
      if (pointsDiff !== 0) return pointsDiff;
      return String(a.userName).localeCompare(String(b.userName), 'pt-BR');
    });

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro ao calcular destaques' });
  }
});

module.exports = router;
