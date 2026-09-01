const assert = require('assert');
const {
  generateProtocol,
  calculateSnapshotHash,
  buildSnapshot,
  buildReceiptEmailHtml
} = require('../services/betReceiptService');

const bet = {
  _id: 'bet1',
  user: 'user1',
  leagueId: '9',
  hasSubmitted: true,
  groupMatches: [
    { matchId: 1, winner: 'A', scoreA: 2, scoreB: 1, qualifier: null, points: 0 }
  ],
  podium: ['Team A'],
  extras: { topScorer: 'Player' }
};
const matches = [{
  matchId: 1, phase: 'points_run', phaseName: 'Rodada 1',
  roundNumber: 1, teamA: 'Team A', teamB: 'Team B',
  date: '2026-09-01', time: '18:00', status: 'scheduled'
}];

const protocol = generateProtocol();
assert(/^KB26-\d{8}-[A-F0-9]{10}$/.test(protocol), 'protocol format');
const snapshot = buildSnapshot(bet, matches);
const hash1 = calculateSnapshotHash(snapshot);
const hash2 = calculateSnapshotHash(JSON.parse(JSON.stringify(snapshot)));
assert.strictEqual(hash1, hash2, 'hash must be deterministic');
const html = buildReceiptEmailHtml({
  protocol, issuedAt: '01/09/2026 10:00', leagueName: 'Liga', userName: 'Teste', snapshot
});
assert(html.includes(protocol), 'email includes protocol');
assert(html.includes('2 x 1'), 'email includes score');
console.log('bet-receipt-service: PASS');
