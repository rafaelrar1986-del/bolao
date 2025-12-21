const express = require('express');
const router = express.Router();

const PointsHistory = require('../models/PointsHistory');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

router.get('/:userId', protect, async (req, res) => {
  const history = await PointsHistory.find({ user: req.params.userId }).sort({ round: 1 });
  res.json(history);
});

router.get('/users/list', protect, async (req, res) => {
  const users = await User.find({}, '_id name');
  res.json(users);
});

router.get('/compare/:userId', protect, async (req, res) => {
  const { otherUserId } = req.query;

  const userHistory = await PointsHistory.find({ user: req.params.userId }).sort({ round: 1 });
  const otherHistory = await PointsHistory.find({ user: otherUserId }).sort({ round: 1 });

  res.json({ user: userHistory, other: otherHistory });
});

module.exports = router;