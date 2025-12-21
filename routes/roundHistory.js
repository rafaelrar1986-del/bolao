const express = require('express');
const router = express.Router();

const Match = require('../models/Match');
const User = require('../models/User');
const PointsHistory = require('../models/PointsHistory');
const { protect, admin } = require('../middleware/auth');

router.post('/rounds/:round/save-points', protect, admin, async (req, res) => {
  const round = Number(req.params.round);

  const alreadySaved = await PointsHistory.findOne({ round });
  if (alreadySaved) {
    return res.status(400).json({ message: 'Rodada já salva' });
  }

  const matches = await Match.find({ round });
  if (matches.some(m => !m.finished)) {
    return res.status(400).json({ message: 'Existem jogos não finalizados' });
  }

  const users = await User.find();

  for (const user of users) {
    if (typeof user.points !== 'number') continue;

    await PointsHistory.create({
      user: user._id,
      points: user.points,
      round
    });
  }

  res.json({ success: true });
});

module.exports = router;