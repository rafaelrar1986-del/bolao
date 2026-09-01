const crypto = require('crypto');
const BetReceipt = require('../models/BetReceipt');

function generateProtocol() {
  return `KB26-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function stableNormalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === 'object' && typeof value.toHexString === 'function') {
    return value.toHexString();
  }
  if (value && typeof value === 'object') {
    if (typeof value.toObject === 'function') return stableNormalize(value.toObject());
    const out = {};
    Object.keys(value).sort().forEach(k => {
      if (value[k] !== undefined) out[k] = stableNormalize(value[k]);
    });
    return out;
  }
  return value;
}

function calculateSnapshotHash(snapshot) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableNormalize(snapshot)))
    .digest('hex');
}

function buildSnapshot(bet, matches = []) {
  const rawBet = bet && typeof bet.toObject === 'function' ? bet.toObject() : bet;
  // Audit metadata belongs to BetReceipt, not to the historical bet snapshot.
  if (rawBet && typeof rawBet === 'object') {
    delete rawBet.currentReceipt;
    delete rawBet.currentProtocol;
  }
  const matchSnapshot = (matches || []).map(m => ({
    matchId: Number(m.matchId),
    group: m.group ?? null,
    phase: m.phase ?? null,
    phaseName: m.phaseName ?? null,
    roundNumber: m.roundNumber ?? null,
    roundName: m.roundName ?? null,
    teamA: m.teamA ?? null,
    teamB: m.teamB ?? null,
    date: m.date ?? null,
    time: m.time ?? null,
    status: m.status ?? null
  }));
  return {
    bet: stableNormalize(rawBet),
    matches: stableNormalize(matchSnapshot)
  };
}

function buildReceiptEmailHtml({ protocol, issuedAt, leagueName, userName, snapshot }) {
  const bet = snapshot?.bet || {};
  const matches = Array.isArray(snapshot?.matches) ? snapshot.matches : [];
  const byId = new Map(matches.map(m => [Number(m.matchId), m]));
  const groupMatches = Array.isArray(bet.groupMatches) ? bet.groupMatches : [];

  const escape = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const getPhaseWeight = phaseName => {
    const p = String(phaseName || '').toLowerCase();
    if (p.includes('3') || p.includes('terceiro')) return 60;
    if (p.includes('semi')) return 50;
    if (p.includes('quartas')) return 40;
    if (p.includes('oitavas')) return 30;
    if (p.includes('16') || p.includes('avos')) return 20;
    if (p.includes('final')) return 70;
    return 10;
  };

  const items = groupMatches.map(item => ({
    ...item,
    gameData: byId.get(Number(item.matchId))
  })).filter(x => x.gameData?.teamA && x.gameData?.teamB);

  items.sort((a,b) => {
    const ga = a.gameData.phaseName || a.gameData.group || 'Geral';
    const gb = b.gameData.phaseName || b.gameData.group || 'Geral';
    const wa = getPhaseWeight(ga), wb = getPhaseWeight(gb);
    if (wa !== wb) return wb - wa;
    return ga.localeCompare(gb, undefined, { numeric: true, sensitivity: 'base' });
  });

  let rows = '';
  let lastGrade = '';
  for (const item of items) {
    const m = item.gameData;
    const grade = m.phaseName || m.group || 'Geral';
    if (grade !== lastGrade) {
      rows += `<tr style="background:#eaeded"><td colspan="2" style="padding:8px 12px;font-weight:bold;color:#2c3e50;text-transform:uppercase;">📂 ${escape(grade)}</td></tr>`;
      lastGrade = grade;
    }
    let prediction = item.winner === 'A' ? `Vitória: ${escape(m.teamA)}` :
      item.winner === 'B' ? `Vitória: ${escape(m.teamB)}` : item.winner === 'draw' ? 'Empate' : '';
    if (item.scoreA != null && item.scoreB != null) {
      prediction += ` <br><span style="font-size:11px;color:#555;">Placar: ${escape(item.scoreA)} x ${escape(item.scoreB)}</span>`;
    }
    if (item.qualifier) {
      const qualified = item.qualifier === 'A' ? m.teamA : item.qualifier === 'B' ? m.teamB : item.qualifier;
      prediction += ` <br><span style="font-size:11px;color:#e67e22;">Classifica: ${escape(qualified)}</span>`;
    }
    rows += `<tr style="border-bottom:1px solid #ecf0f1">
      <td style="padding:12px;color:#2c3e50"><strong>${escape(m.teamA)}</strong> vs <strong>${escape(m.teamB)}</strong></td>
      <td style="padding:12px;text-align:center;font-weight:bold;color:#27ae60;background:#fafdfb">${prediction}</td>
    </tr>`;
  }

  let extrasHtml = '';
  if (Array.isArray(bet.podium) && bet.podium.length) {
    extrasHtml += `<div style="margin-top:25px;padding:15px;background:#fcf8e3;border:1px solid #faebcc;border-radius:4px">
      <h4 style="margin:0 0 10px;color:#8a6d3b">🏆 Seus Palpites de Pódio:</h4>
      ${bet.podium.map((team,i) => `<p style="margin:4px 0"><strong>${i+1}º Lugar:</strong> ${escape(team)}</p>`).join('')}
    </div>`;
  }
  if (bet.extras && typeof bet.extras === 'object') {
    const e = bet.extras;
    if (e.topScorer || e.bestAttack || e.worstDefense || e.upset) {
      extrasHtml += `<div style="margin-top:15px;padding:15px;background:#e8f6f3;border:1px solid #a3e4d7;border-radius:4px">
        <h4 style="margin:0 0 10px;color:#1e8449">🌟 Palpites Extras:</h4>
        ${e.topScorer ? `<p><strong>Artilheiro:</strong> ${escape(e.topScorer)}</p>` : ''}
        ${e.bestAttack ? `<p><strong>Melhor Ataque:</strong> ${escape(e.bestAttack)}</p>` : ''}
        ${e.worstDefense ? `<p><strong>Pior Defesa:</strong> ${escape(e.worstDefense)}</p>` : ''}
        ${e.upset ? `<p><strong>Zebra:</strong> ${escape(e.upset)}</p>` : ''}
      </div>`;
    }
  }

  return `<div style="font-family:sans-serif;max-width:600px;margin:auto">
    <div style="background:#2c3e50;padding:15px;color:white;text-align:center;border-radius:4px 4px 0 0">
      <h2 style="margin:0">Comprovante de Palpites</h2>
      <p style="margin:5px 0;font-size:14px">Protocolo: <strong>${escape(protocol)}</strong></p>
      <p style="margin:5px 0;font-size:12px">Emitido em: ${escape(issuedAt)}</p>
    </div>
    <p style="padding:15px 15px 0">Olá, <strong>${escape(userName)}</strong>! Seus palpites salvos para <strong>${escape(leagueName)}</strong> estão registrados abaixo.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:15px">
      <thead><tr style="background:#f4f6f7"><th style="padding:12px;text-align:left">Confronto / Fase</th><th style="padding:12px;text-align:center">Seu Palpite</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${extrasHtml}
    <div style="margin-top:30px;padding:15px;border-top:1px dashed #bdc3c7;font-size:12px;color:#7f8c8d;background:#f9f9f9">
      <p><strong>⚠️ AVISO DE AUDITORIA:</strong></p>
      <p>Este comprovante corresponde à versão registrada no sistema no momento da emissão. Se houver uma alteração posterior, este protocolo passa a ser histórico e o novo protocolo será o registro atual.</p>
    </div>
  </div>`;
}

async function createBetReceipt({ bet, matches, userId, leagueId, operation = 'save', userName, leagueName }) {
  const previous = await BetReceipt.findOne({ user: userId, leagueId: String(leagueId), isCurrent: true })
    .sort({ version: -1 });

  const version = previous ? Number(previous.version || 0) + 1 : 1;
  const snapshot = buildSnapshot(bet, matches);
  const snapshotHash = calculateSnapshotHash(snapshot);
  const protocol = generateProtocol();

  const receipt = await BetReceipt.create({
    protocol,
    user: userId,
    leagueId: String(leagueId),
    bet: bet._id,
    version,
    operation: previous ? (operation === 'initial_save' ? 'save' : operation) : 'initial_save',
    snapshot,
    snapshotHash,
    isCurrent: true
  });

  if (previous) {
    await BetReceipt.updateOne(
      { _id: previous._id },
      { $set: { isCurrent: false, supersededBy: receipt._id } }
    );
  }

  await BetReceipt.updateMany(
    { user: userId, leagueId: String(leagueId), _id: { $ne: receipt._id }, isCurrent: true },
    { $set: { isCurrent: false, supersededBy: receipt._id } }
  );

  bet.currentReceipt = receipt._id;
  bet.currentProtocol = protocol;
  await bet.save();

  const issuedAt = new Date(receipt.createdAt).toLocaleString('pt-BR');
  const html = buildReceiptEmailHtml({ protocol, issuedAt, leagueName: leagueName || `Liga #${leagueId}`, userName: userName || 'Participante', snapshot });

  return { receipt, protocol, html };
}

module.exports = {
  generateProtocol,
  calculateSnapshotHash,
  buildSnapshot,
  buildReceiptEmailHtml,
  createBetReceipt
};
