// routes/settings.js
const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');

/**
 * 🛠️ HELPER: Normaliza o ID da liga
 * 🆕 CORREÇÃO: Alinhado com toLeagueId() usado em todo o sistema
 * O schema Settings usa _id como String (ex: '27', 'default')
 */
function toLeagueId(leagueId) {
  return leagueId != null ? String(leagueId).trim() : 'default';
}

/**
 * @route   GET /api/settings/global
 * @desc    Busca as configurações de uma liga específica
 * @access  Público
 */
router.get('/global', async (req, res) => {
  try {
    const leagueId = req.query.leagueId || '1';
    const configId = toLeagueId(leagueId);

    let s = await Settings.findById(configId).lean();
    
    if (!s) {
      // Cria a configuração inicial específica para esta liga se não existir
      s = await Settings.create({ 
        _id: configId,
        leagueId: String(leagueId),
        unlockedPhases: [], // O que o usuário vê (Gerenciador)
        lockedPhases: [],          // O que o Robô tranca (Segurança)
        blockSaveBets: false,
        blockSaveKnockout: false,
        statsLocked: true
      });
    }
    
    res.json({ success: true, data: s });
  } catch (err) {
    console.error('Erro ao ler configurações:', err);
    res.status(500).json({ success: false, message: 'Erro ao ler configurações' });
  }
});

/**
 * @route   POST /api/settings/global
 * @desc    Rota unificada: edita TODAS as configurações da liga (travas, regras de pontuação, regras do campeonato, resultados oficiais, robô)
 */
router.post('/global', protect, admin, async (req, res) => {
  try {
    const targetLeagueId = req.body.leagueId || req.query.leagueId || '1';
    const configId = toLeagueId(targetLeagueId);
    const mainLeagueId = toLeagueId('1');

    // 1. 🔒 CAMPOS DE TRAVA (Vão para a liga alvo)
    const lockUpdates = {};
    const booleanFields = ['blockSaveBets', 'blockSaveKnockout', 'requireAllBets', 'statsLocked'];

    booleanFields.forEach(k => {
      if (req.body[k] !== undefined) lockUpdates[k] = !!req.body[k];
    });

    if (req.body.unlockedPhases && Array.isArray(req.body.unlockedPhases)) {
      lockUpdates.unlockedPhases = req.body.unlockedPhases;
    }

    if (req.body.lockedPhases && Array.isArray(req.body.lockedPhases)) {
      lockUpdates.lockedPhases = req.body.lockedPhases;
    }

    if (req.body.lockedReason !== undefined) lockUpdates.lockedReason = req.body.lockedReason;

    if (req.body.unlockAt !== undefined) {
      lockUpdates.unlockAt = req.body.unlockAt ? new Date(req.body.unlockAt) : null;
    }

    if (req.body.status !== undefined) lockUpdates.status = req.body.status;

    if (req.body.title !== undefined) lockUpdates.title = String(req.body.title).trim();

    // 2. 🏆 REGRAS DE PONTUAÇÃO (Vão para a liga alvo — merge em objetos aninhados)
    if (req.body.scoringRules && typeof req.body.scoringRules === 'object') {
      const settings = await Settings.findById(configId).lean();
      const currentScoring = settings?.scoringRules || {};
      lockUpdates.scoringRules = { ...currentScoring, ...req.body.scoringRules };
    }

    if (req.body.championshipRules && typeof req.body.championshipRules === 'object') {
      const settings = await Settings.findById(configId).lean();
      const currentChamp = settings?.championshipRules || {};
      lockUpdates.championshipRules = { ...currentChamp, ...req.body.championshipRules };
    }

    if (req.body.championshipResults && typeof req.body.championshipResults === 'object') {
      const settings = await Settings.findById(configId).lean();
      const currentResults = settings?.championshipResults || {};
      lockUpdates.championshipResults = { ...currentResults, ...req.body.championshipResults };
    }

    // Salva na liga alvo
    const s = await Settings.findByIdAndUpdate(
      configId,
      { $set: { ...lockUpdates, leagueId: String(targetLeagueId) } },
      { new: true, upsert: true }
    ).lean();

    // 3. 🤖 CAMPOS DO ROBÔ (Sempre forçados para liga 1)
    const robotUpdates = {};
    let hasRobotUpdates = false;

    if (req.body.cron_interval !== undefined) {
      robotUpdates.cron_interval = Number(req.body.cron_interval);
      hasRobotUpdates = true;
    }
    if (req.body.api_season !== undefined) {
      robotUpdates.api_season = Number(req.body.api_season);
      hasRobotUpdates = true;
    }
    if (req.body.api_leagues !== undefined) {
      robotUpdates.api_leagues = Array.isArray(req.body.api_leagues)
        ? req.body.api_leagues.map(id => Number(id))
        : [];
      hasRobotUpdates = true;
    }

    if (hasRobotUpdates) {
      await Settings.findByIdAndUpdate(
        mainLeagueId,
        { $set: robotUpdates },
        { upsert: true }
      );
    }

    res.json({
      success: true,
      message: `Configurações da liga ${targetLeagueId} atualizadas.`,
      data: s
    });

  } catch (err) {
    console.error('Erro ao atualizar configurações:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar configurações' });
  }
});

module.exports = router;
