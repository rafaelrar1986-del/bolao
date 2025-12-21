
const express = require('express');
const router = express.Router();
const PointsHistory = require('../models/PointsHistory');
const Match = require('../models/Match');
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');

router.post('/rounds/:round/save-points', protect, admin, async (req, res) => {
  const round = Number(req.params.round);

  const alreadySaved = await PointsHistory.findOne({ round });
  if (alreadySaved) {
    return res.status(400).json({ message: 'Pontos desta rodada já foram salvos' });
  }

  const matches = await Match.find({ round });
  const incomplete = matches.filter(m => !m.finished);

  if (incomplete.length) {
    return res.status(400).json({ message: 'Existem jogos não finalizados nesta rodada' });
  }

  const users = await User.find();

  for (const user of users) {
    if (!user.points && user.points !== 0) continue;

    await PointsHistory.create({
      user: user._id,
      points: user.points,
      round
    });
  }

  res.json({ success: true, message: 'Pontos da rodada salvos com sucesso' });
});

module.exports = router;
