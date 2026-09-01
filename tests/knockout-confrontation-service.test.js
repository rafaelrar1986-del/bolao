
const assert = require('assert');

const matchModelPath = require.resolve('../models/Match');
const originalCache = require.cache[matchModelPath];

const store = [];
let bulkOps = [];

const fakeMatch = {
  find: async (query) => store.filter(m =>
    String(m.leagueId) === String(query.leagueId) &&
    m.phase === query.phase &&
    m.knockoutTieKey === query.knockoutTieKey
  ),
  bulkWrite: async (ops) => {
    bulkOps.push(...ops);
    for (const op of ops) {
      const id = String(op.updateOne.filter._id);
      const doc = store.find(x => String(x._id) === id);
      if (doc) Object.assign(doc, op.updateOne.update.$set);
    }
  }
};

require.cache[matchModelPath] = {
  id: matchModelPath,
  filename: matchModelPath,
  loaded: true,
  exports: fakeMatch
};

const { materializeKnockoutConfrontation } =
  require('../services/knockoutConfrontationService');

function doc(id, date, key, a, b) {
  return {
    _id: id,
    matchId: Number(id),
    leagueId: '1',
    phase: 'knockout',
    phaseName: 'Semifinal',
    date,
    time: '20:00',
    teamA: a,
    teamB: b,
    knockoutTieKey: key,
    stageFormat: null,
    knockoutExpectedLegs: null,
    knockoutLeg: null
  };
}

(async () => {
  const key = 'semifinal::argentina::brasil';
  const first = doc('1','01/09/2026',key,'Brasil','Argentina');
  const second = doc('2','08/09/2026',key,'Argentina','Brasil');
  store.push(first, second);

  await materializeKnockoutConfrontation(first, {
    knockoutFormat: 'home_away',
    knockoutFinalFormat: 'single'
  });

  assert.strictEqual(first.knockoutLeg, 1);
  assert.strictEqual(second.knockoutLeg, 2);
  assert.strictEqual(first.knockoutExpectedLegs, 2);
  assert.strictEqual(second.knockoutExpectedLegs, 2);
  assert.strictEqual(first.stageFormat, 'home_away');
  assert.strictEqual(bulkOps.length, 2);

  // Alteração dos nomes não quebra a identidade já materializada.
  second.teamA = 'Brasil';
  second.teamB = 'Argentina';
  await materializeKnockoutConfrontation(second, {
    knockoutFormat: 'home_away',
    knockoutFinalFormat: 'single'
  });
  assert.strictEqual(second.knockoutTieKey, key);
  assert.strictEqual(second.knockoutLeg, 2);

  // Final de campeonato ida/volta global + final única.
  const final = doc('3','15/09/2026',null,'Brasil','Argentina');
  final.phaseName = 'Final';
  final.knockoutTieKey = null;
  store.push(final);
  await materializeKnockoutConfrontation(final, {
    knockoutFormat: 'home_away',
    knockoutFinalFormat: 'single'
  });
  assert.strictEqual(final.stageFormat, 'single');
  assert.strictEqual(final.knockoutExpectedLegs, 1);
  assert.strictEqual(final.knockoutLeg, 1);

  console.log('knockout-confrontation-service: PASS');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  if (originalCache) require.cache[matchModelPath] = originalCache;
  else delete require.cache[matchModelPath];
});
