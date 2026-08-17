const Settings = require('../models/Settings');

function toLeagueId(leagueId) {
  return leagueId != null ? String(leagueId).trim() : 'default';
}

async function blockStatsIfLocked(req, res, next) {
  try {
    // 🛡️ 1. ADMIN SEMPRE IGNORA BLOQUEIO
    const isAdminUser =
      req.user?.isAdmin === true ||
      req.user?.role === 'admin';

    if (isAdminUser) {
      return next();
    }

    // 🔎 2. Busca config da liga atual (via query string)
    const leagueId = req.query.leagueId || req.params.leagueId || 'default';
    const configId = toLeagueId(leagueId);
    const settings = await Settings.findById(configId);

    // Sem settings → não bloqueia
    if (!settings) {
      return next();
    }

    // ⏱️ 3. Desbloqueio automático por data
    if (
      settings.statsLocked === true &&
      settings.unlockAt &&
      new Date() >= settings.unlockAt
    ) {
      settings.statsLocked = false;
      settings.lockedReason = null;
      settings.unlockAt = null;
      await settings.save();
      return next();
    }

    // 🔒 4. Bloqueio ativo
    if (settings.statsLocked === true) {
      return res.status(423).json({
        success: false,
        code: 'STATS_LOCKED',
        message: 'Estatísticas bloqueadas pelo administrador',
        reason: settings.lockedReason || 'PRE_TOURNAMENT'
      });
    }

    // ✅ 5. Livre
    next();

  } catch (err) {
    console.error('❌ Erro blockStatsIfLocked:', err);
    // Nunca derruba o sistema
    next();
  }
}

module.exports = { blockStatsIfLocked };
