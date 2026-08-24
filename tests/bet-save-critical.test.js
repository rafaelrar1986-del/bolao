
const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;

const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

function fmtDate(d) {
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

const MATCHES = [
  {
    matchId: 1, leagueId: '1', teamA: 'Q1', teamB: 'Q2',
    date: fmtDate(yesterday), time: '00:00', status: 'scheduled',
    phaseName: 'quartas', group: 'quartas'
  },
  {
    matchId: 2, leagueId: '1', teamA: 'S1', teamB: 'S2',
    date: fmtDate(tomorrow), time: '23:59', status: 'scheduled',
    phaseName: 'semifinal', group: 'semifinal'
  }
];

const BASE_SETTINGS = {
  title: 'Liga Teste',
  blockSaveBets: false,
  betLockMode: 'match',
  lockedPhases: [],
  scoringRules: {
    exactScore: 0,
    scoreTeamA: 0,
    scoreTeamB: 0,
    winner: 1,
    qualifier: 0
  },
  championshipRules: {
    winnerFromScore: false,
    podiumSize: 4
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeBetModel(existing, gradeCheckEnabled) {
  class FakeBet {
    constructor(payload) {
      Object.assign(this, clone(payload));
      this._id = 'new-bet-id';
      this.save = async () => {
        FakeBet.saved = clone(this);
      };
    }

  recalculateTotals() { return this; }


    static validatePodiumSize(podium, size) {
      if (!Array.isArray(podium)) return { valid: false, error: 'Pódio inválido' };
      if (podium.length !== size) {
        return { valid: false, error: `O pódio deve conter ${size} posições.` };
      }
      return { valid: true };
    }

    static findOne() {
      FakeBet.findOneCalls = (FakeBet.findOneCalls || 0) + 1;
      const firstCallIsGradeCheck = gradeCheckEnabled && FakeBet.findOneCalls === 1;

      if (firstCallIsGradeCheck) {
        return {
          lean: async () => existing ? clone(existing) : null
        };
      }

      if (!existing) return null;

      const doc = {
        ...clone(existing),
        _id: existing._id || 'existing-bet-id',
        set(payload) {
          Object.assign(this, clone(payload));
        },
        save: async function() {
          FakeBet.saved = clone(this);
        }
      };

      return doc;
    }
  }

  FakeBet.saved = null;
  return FakeBet;
}

async function executeCase({
  name,
  settingsPatch = {},
  existingBet = null,
  groupMatches,
  podium = ['T1', 'T2', 'T3', 'T4'],
  expectStatus,
  expectSuccess,
  expectSaved = false
}) {
  const settings = {
    ...clone(BASE_SETTINGS),
    ...clone(settingsPatch),
    scoringRules: {
      ...clone(BASE_SETTINGS.scoringRules),
      ...(settingsPatch.scoringRules || {})
    },
    championshipRules: {
      ...clone(BASE_SETTINGS.championshipRules),
      ...(settingsPatch.championshipRules || {})
    }
  };

  const FakeBet = makeBetModel(existingBet, settings.betLockMode === 'grade' && Array.isArray(settings.lockedPhases) && settings.lockedPhases.length > 0);
  let response = null;

  Module._load = function(request, parent, isMain) {
    if (request === '../models/Bet') return FakeBet;

    if (request === '../models/Match') {
      return {
        find: () => ({
          select: () => ({
            lean: async () => clone(MATCHES)
          })
        })
      };
    }

    if (request === '../models/Settings') {
      return {
        findById: () => ({
          lean: async () => clone(settings)
        })
      };
    }

    if (request === '../models/User') {
      return {
        findByIdAndUpdate: async () => ({})
      };
    }

    if (request === '../utils/leagueId') {
      return {
        toLeagueId: value => value != null ? String(value).trim() : 'default'
      };
    }

    if (request === '../services/emailService') {
      return {
        sendBetsConfirmationEmail: async () => {}
      };
    }

    return originalLoad.apply(this, arguments);
  };

  delete require.cache[require.resolve('../controllers/betSaveController')];

  try {
    const { saveBets } = require('../controllers/betSaveController');

    const req = {
      user: {
        _id: 'u1',
        email: 'test@example.com',
        name: 'Tester'
      },
      body: {
        leagueId: '1',
        groupMatches,
        podium
      }
    };

    const res = {
      status(code) {
        return {
          json(payload) {
            response = { status: code, ...payload };
          }
        };
      },
      json(payload) {
        response = { status: 200, ...payload };
      }
    };

    await saveBets(req, res);

    const actualStatus = response?.status ?? 500;

    assert.strictEqual(
      actualStatus,
      expectStatus,
      `${name}: esperado HTTP ${expectStatus}, recebido ${actualStatus}; resposta=${JSON.stringify(response)}`
    );

    if (expectSuccess !== undefined) {
      assert.strictEqual(
        response?.success,
        expectSuccess,
        `${name}: success inesperado`
      );
    }

    if (expectSaved !== undefined) {
      assert.strictEqual(
        Boolean(FakeBet.saved),
        expectSaved,
        `${name}: estado de gravação inesperado`
      );
    }

    return response;
  } finally {
    Module._load = originalLoad;
  }
}

function oldBet(matchId = 1, overrides = {}) {
  return {
    _id: 'existing-bet-id',
    user: 'u1',
    leagueId: '1',
    groupMatches: [
      {
        matchId,
        winner: 'A',
        scoreA: null,
        scoreB: null,
        qualifier: null,
        points: 0,
        pointsBreakdown: {
          exactScore: 0, scoreTeamA: 0, scoreTeamB: 0,
          winner: 0, qualifier: 0
        },
        ...overrides
      }
    ],
    podium: ['T1', 'T2', 'T3', 'T4']
  };
}

async function run() {
  // 1 — grade aberta + partida futura
  await executeCase({
    name: 'SAVE-001',
    groupMatches: {
      2: { winner: 'B', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 200,
    expectSuccess: true,
    expectSaved: true
  });

  // 2 — grade aberta + partida iniciada
  await executeCase({
    name: 'SAVE-002',
    groupMatches: {
      1: { winner: 'A', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 403,
    expectSuccess: false,
    expectSaved: false
  });

  // 3 — partida encerrada/status não scheduled
  const ended = clone(MATCHES);
  ended[1].status = 'finished';
  // Coberto diretamente pelo serviço no teste de lock; /save usa o horário.
  await executeCase({
    name: 'SAVE-003',
    groupMatches: {
      1: { winner: 'A', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 403,
    expectSuccess: false,
    expectSaved: false
  });

  // 4 — grade bloqueada + aposta antiga idêntica + partida iniciada
  await executeCase({
    name: 'SAVE-004',
    settingsPatch: {
      betLockMode: 'grade',
      lockedPhases: ['quartas']
    },
    existingBet: oldBet(),
    groupMatches: {
      1: { winner: 'A', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 200,
    expectSuccess: true,
    expectSaved: true
  });

  // 5 — grade bloqueada + aposta antiga alterada
  await executeCase({
    name: 'SAVE-005',
    settingsPatch: {
      betLockMode: 'grade',
      lockedPhases: ['quartas']
    },
    existingBet: oldBet(),
    groupMatches: {
      1: { winner: 'B', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 403,
    expectSuccess: false,
    expectSaved: false
  });

  // 6 — grade bloqueada + nova aposta
  await executeCase({
    name: 'SAVE-006',
    settingsPatch: {
      betLockMode: 'grade',
      lockedPhases: ['semifinal']
    },
    existingBet: oldBet(),
    groupMatches: {
      2: { winner: 'B', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 403,
    expectSuccess: false,
    expectSaved: false
  });

  // 7 — grade antiga idêntica + semifinal nova aberta
  await executeCase({
    name: 'SAVE-007',
    settingsPatch: {
      betLockMode: 'grade',
      lockedPhases: ['quartas']
    },
    existingBet: oldBet(),
    groupMatches: {
      1: { winner: 'A', scoreA: null, scoreB: null, qualifier: null },
      2: { winner: 'B', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 200,
    expectSuccess: true,
    expectSaved: true
  });

  // 8 — grade antiga alterada + semifinal nova
  await executeCase({
    name: 'SAVE-008',
    settingsPatch: {
      betLockMode: 'grade',
      lockedPhases: ['quartas']
    },
    existingBet: oldBet(),
    groupMatches: {
      1: { winner: 'B', scoreA: null, scoreB: null, qualifier: null },
      2: { winner: 'B', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 403,
    expectSuccess: false,
    expectSaved: false
  });

  // 9 — score habilitado: alterar placar de aposta bloqueada
  await executeCase({
    name: 'SAVE-009',
    settingsPatch: {
      betLockMode: 'grade',
      lockedPhases: ['quartas'],
      scoringRules: { exactScore: 3, scoreTeamA: 0, scoreTeamB: 0 }
    },
    existingBet: oldBet(1, { scoreA: 1, scoreB: 0 }),
    groupMatches: {
      1: { winner: 'A', scoreA: 2, scoreB: 0, qualifier: null }
    },
    expectStatus: 403,
    expectSuccess: false,
    expectSaved: false
  });

  // 10 — score desabilitado: null continua sendo equivalente
  await executeCase({
    name: 'SAVE-010',
    settingsPatch: {
      betLockMode: 'grade',
      lockedPhases: ['quartas'],
      scoringRules: { exactScore: 0, scoreTeamA: 0, scoreTeamB: 0 }
    },
    existingBet: oldBet(),
    groupMatches: {
      1: { winner: 'A', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 200,
    expectSuccess: true,
    expectSaved: true
  });

  // 11 — winner derivado + divergência
  await executeCase({
    name: 'SAVE-011',
    settingsPatch: {
      scoringRules: { exactScore: 3 },
      championshipRules: { winnerFromScore: true }
    },
    groupMatches: {
      2: { winner: 'B', scoreA: 2, scoreB: 1, qualifier: null }
    },
    expectStatus: 400,
    expectSuccess: false,
    expectSaved: false
  });

  // 12 — winner manual independente
  await executeCase({
    name: 'SAVE-012',
    settingsPatch: {
      scoringRules: { exactScore: 3 },
      championshipRules: { winnerFromScore: false }
    },
    groupMatches: {
      2: { winner: 'B', scoreA: 2, scoreB: 1, qualifier: null }
    },
    expectStatus: 200,
    expectSuccess: true,
    expectSaved: true
  });

  // 13 — atualizar aposta sem alterar pódio
  const response13 = await executeCase({
    name: 'SAVE-013',
    existingBet: oldBet(),
    groupMatches: {
      2: { winner: 'B', scoreA: null, scoreB: null, qualifier: null }
    },
    podium: ['T1', 'T2', 'T3', 'T4'],
    expectStatus: 200,
    expectSuccess: true,
    expectSaved: true
  });
  assert.deepStrictEqual(
    response13.success,
    true,
    'SAVE-013: resposta de sucesso esperada'
  );

  // 14 — pódio inválido
  await executeCase({
    name: 'SAVE-014',
    podium: ['T1'],
    groupMatches: {
      2: { winner: 'B', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 400,
    expectSuccess: false,
    expectSaved: false
  });

  // 15 — matchId inválido
  await executeCase({
    name: 'SAVE-015',
    groupMatches: {
      abc: { winner: 'A', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 400,
    expectSuccess: false,
    expectSaved: false
  });

  // 16 — matchId que não pertence à liga
  await executeCase({
    name: 'SAVE-016',
    groupMatches: {
      999: { winner: 'A', scoreA: null, scoreB: null, qualifier: null }
    },
    expectStatus: 400,
    expectSuccess: false,
    expectSaved: false
  });

  console.log('16/16 TESTES CRÍTICOS DO /save: PASS');
}

run().catch(error => {
  console.error('TESTE FUNCIONAL FALHOU');
  console.error(error.stack || error);
  process.exitCode = 1;
});
