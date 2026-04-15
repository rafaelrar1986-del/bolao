const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');

/**
 * 🛠️ HELPER: Define o ID do documento
 * Usado para separar as gavetas de configuração por liga.
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
    const configId = getConfigId(req.query.leagueId);

    let s = await Settings.findById(configId).lean();
    
    if (!s) {
      // Cria a configuração inicial específica para esta liga se não existir
      s = await Settings.create({ _id: configId });
    }
    
    res.json({ success: true, data: s });
  } catch (err) {
    console.error('Erro ao ler configurações:', err);
    res.status(500).json({ success: false, message: 'Erro ao ler configurações' });
  }
});

/**
 * @route   POST /api/settings/global
 * @desc    Atualiza travas de interface (Individual por liga) e Robô (Sempre na liga 1)
 * @access  Privado (Admin)
 */
router.post('/global', protect, admin, async (req, res) => {
  try {
    const targetLeagueId = req.body.leagueId || '1';
    const configId = getConfigId(targetLeagueId);
    const mainLeagueId = getConfigId('1'); 

    // 1. 🔒 Separar campos de TRAVA (Respeitam a liga selecionada)
    const lockUpdates = {};
    const booleanFields = ['blockSaveBets', 'blockSaveKnockout', 'requireAllBets', 'statsLocked'];
    
    booleanFields.forEach(k => {
      if (req.body[k] !== undefined) lockUpdates[k] = !!req.body[k];
    });

    if (req.body.unlockedPhases && Array.isArray(req.body.unlockedPhases)) {
      lockUpdates.unlockedPhases = req.body.unlockedPhases;
    }
    if (req.body.lockedReason !== undefined) lockUpdates.lockedReason = req.body.lockedReason;
    if (req.body.unlockAt !== undefined) {
      lockUpdates.unlockAt = req.body.unlockAt ? new Date(req.body.unlockAt) : null;
    }

    // Salva as travas na liga alvo (ex: league_27)
    const s = await Settings.findByIdAndUpdate(
      configId,
      { $set: lockUpdates },
      { new: true, upsert: true }
    ).lean();

    // 2. 🤖 Separar campos do ROBÔ (Forçados sempre para league_1)
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
      message: `Travas aplicadas à liga ${targetLeagueId}. API configurada na liga 1.`,
      data: s 
    });

  } catch (err) {
    console.error('Erro ao atualizar configurações:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar configurações' });
  }
});

/**
 * ✅ ROTA: POST /api/settings/admin/update
 * Sincronização completa. Mantém a lógica de proteção por ID.
 */
router.post('/admin/update', protect, admin, async (req, res) => {
  try {
    const targetLeagueId = req.body.leagueId || '1';
    const configId = getConfigId(targetLeagueId);
    const mainLeagueId = getConfigId('1');

    const updates = {};
    const robotUpdates = {};

    // Dados do Robô (Vão para a 1)
    if (req.body.cron_interval !== undefined) robotUpdates.cron_interval = Number(req.body.cron_interval);
    if (req.body.api_season !== undefined) robotUpdates.api_season = Number(req.body.api_season);
    if (req.body.api_leagues !== undefined) {
      robotUpdates.api_leagues = Array.isArray(req.body.api_leagues) 
        ? req.body.api_leagues.map(id => Number(id)) 
        : [];
    }

    // Travas (Vão para a liga alvo)
    if (req.body.blockSaveBets !== undefined) updates.blockSaveBets = !!req.body.blockSaveBets;
    if (req.body.blockSaveKnockout !== undefined) updates.blockSaveKnockout = !!req.body.blockSaveKnockout;
    if (req.body.requireAllBets !== undefined) updates.requireAllBets = !!req.body.requireAllBets;
    if (req.body.statsLocked !== undefined) updates.statsLocked = !!req.body.statsLocked;

    // Executa atualizações
    const s = await Settings.findByIdAndUpdate(
      configId,
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    ).lean();

    if (Object.keys(robotUpdates).length > 0) {
      await Settings.findByIdAndUpdate(mainLeagueId, { $set: robotUpdates }, { upsert: true });
    }

    res.json({ success: true, message: `Configurações salvas com sucesso!`, data: s });
  } catch (err) {
    console.error('Erro na rota /admin/update:', err);
    res.status(500).json({ success: false, message: 'Erro ao salvar configurações' });
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

    res.json({ success: true, message: `Robô atualizado na configuração global (Liga 1)!`, data: s });
  } catch (err) {
    console.error('Erro ao atualizar robô:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar robô' });
  }
});

module.exports = router;
