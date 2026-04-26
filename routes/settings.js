// routes/settings.js
const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');

/**
 * 🛠️ HELPER: Define o ID do documento
 * Garante que cada liga tenha sua própria "gaveta" no banco de dados.
 */
const getConfigId = (leagueId) => {
  const id = leagueId || '1';
  return `league_${id}`;
};

/**
 * @route   GET /api/settings/global
 * @desc    Busca as configurações de uma liga específica
 * @access  Público
 */
router.get('/global', async (req, res) => {
  try {
    const leagueId = req.query.leagueId || '1';
    const configId = getConfigId(leagueId);

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
 * @desc    Rota unificada: Travas vão para a liga Alvo, Robô vai sempre para a Liga 1
 */
router.post('/global', protect, admin, async (req, res) => {
  try {
    const targetLeagueId = req.body.leagueId || req.query.leagueId || '1';
    const configId = getConfigId(targetLeagueId);
    const mainLeagueId = getConfigId('1'); 

    // 1. 🔒 CAMPOS DE TRAVA (Vão para a liga que você está mexendo agora)
    const lockUpdates = {};
    const booleanFields = ['blockSaveBets', 'blockSaveKnockout', 'requireAllBets', 'statsLocked'];
    
    booleanFields.forEach(k => {
      if (req.body[k] !== undefined) lockUpdates[k] = !!req.body[k];
    });

    // Sincroniza a lógica de Grade (Visibilidade)
    if (req.body.unlockedPhases && Array.isArray(req.body.unlockedPhases)) {
      lockUpdates.unlockedPhases = req.body.unlockedPhases;
    }

    // 🛡️ NOVO: Sincroniza a lógica de Grade de Bloqueio (Segurança/Robô)
    // Permite que o admin remova uma grade do cadeado manualmente se necessário
    if (req.body.lockedPhases && Array.isArray(req.body.lockedPhases)) {
      lockUpdates.lockedPhases = req.body.lockedPhases;
    }
    
    if (req.body.lockedReason !== undefined) lockUpdates.lockedReason = req.body.lockedReason;
    
    if (req.body.unlockAt !== undefined) {
      lockUpdates.unlockAt = req.body.unlockAt ? new Date(req.body.unlockAt) : null;
    }

    // Salva na liga alvo (ex: league_27)
    const s = await Settings.findByIdAndUpdate(
      configId,
      { $set: { ...lockUpdates, leagueId: String(targetLeagueId) } },
      { new: true, upsert: true }
    ).lean();

    // 2. 🤖 CAMPOS DO ROBÔ (Sempre forçados para league_1)
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

/**
 * ✅ ROTA: POST /api/settings/admin/update
 * Sincronização secundária
 */
router.post('/admin/update', protect, admin, async (req, res) => {
  try {
    const targetLeagueId = req.body.leagueId || req.query.leagueId || '1';
    const configId = getConfigId(targetLeagueId);
    const mainLeagueId = getConfigId('1');

    const updates = {};
    const robotUpdates = {};

    // Dados do Robô -> Liga 1
    if (req.body.cron_interval !== undefined) robotUpdates.cron_interval = Number(req.body.cron_interval);
    if (req.body.api_season !== undefined) robotUpdates.api_season = Number(req.body.api_season);
    if (req.body.api_leagues !== undefined) {
      robotUpdates.api_leagues = Array.isArray(req.body.api_leagues) ? req.body.api_leagues : [];
    }

    // Travas -> Liga Alvo
    const lockFields = ['blockSaveBets', 'blockSaveKnockout', 'requireAllBets', 'statsLocked'];
    lockFields.forEach(f => {
        if (req.body[f] !== undefined) updates[f] = !!req.body[f];
    });

    // Sincronização manual das fases (Visíveis e Trancadas)
    if (req.body.unlockedPhases) updates.unlockedPhases = req.body.unlockedPhases;
    if (req.body.lockedPhases) updates.lockedPhases = req.body.lockedPhases;

    const s = await Settings.findByIdAndUpdate(
      configId,
      { $set: { ...updates, leagueId: String(targetLeagueId) } },
      { new: true, upsert: true }
    ).lean();

    if (Object.keys(robotUpdates).length > 0) {
      await Settings.findByIdAndUpdate(mainLeagueId, { $set: robotUpdates }, { upsert: true });
    }

    res.json({ success: true, data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao salvar' });
  }
});

/**
 * ✅ ROTA: POST /api/settings/robot
 * Atualiza especificamente os dados da API (Sempre na liga 1).
 */
router.post('/robot', protect, admin, async (req, res) => {
  try {
    const mainLeagueId = getConfigId('1');
    const { cron_interval, api_season, api_leagues } = req.body;
    
    const s = await Settings.findByIdAndUpdate(
      mainLeagueId,
      { 
        $set: { 
          cron_interval: Number(cron_interval) || 5,
          api_season: Number(api_season) || 2026,
          api_leagues: Array.isArray(api_leagues) ? api_leagues : []
        } 
      },
      { new: true, upsert: true }
    ).lean();

    res.json({ success: true, message: `Robô atualizado na Liga 1`, data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro ao atualizar robô' });
  }
});

module.exports = router;
