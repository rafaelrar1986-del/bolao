async function trySaveDailyPoints(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);

  const pending = await Match.countDocuments({
    date: day,
    status: { $ne: 'finalizado' }
  });

  if (pending > 0) return;

  const users = await User.find();

  for (const user of users) {
    const exists = await PointsHistory.findOne({
      user: user._id,
      date: day
    });

    if (exists) continue;

    await PointsHistory.create({
      user: user._id,
      date: day,
      points: user.points
    });
  }
}
