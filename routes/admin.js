const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Importações de Modelos e Serviços
const AllowedEmail = require('../models/AllowedEmail'); 
const User = require('../models/User'); 
const { sendBroadcastEmail } = require('../services/emailService');
const { protect, admin } = require('../middleware/auth');

// Importação do Controller do Robô
const robotController = require('../controllers/robotController');

// Configuração do Multer
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } 
});

/**
 * @route    GET /api/admin/robot/available-leagues
 * @desc     Busca a lista de ligas disponíveis na API externa de esportes
 */
router.get('/robot/available-leagues', protect, admin, robotController.getAvailableLeagues);

/**
 * @route    POST /api/admin/robot/sync
 * @desc     Sincroniza partidas da API externa (Bzzoiro) com paginação
 */
router.post('/robot/sync', protect, admin, robotController.fetchAndSyncMatches);

/**
 * @route    GET /api/admin/users
 * @desc     Lista todos os usuários (CORRIGIDO PARA O FRONTEND)
 */
router.get('/users', protect, admin, async (req, res) => {
  try {
    const leagueId = String(req.query.leagueId || '').trim();
    const users = await User.find({}, 'name email isAdmin hasPaid createdAt leagues leagueAccess').sort({ createdAt: -1 });

    const mappedUsers = users.map(user => {
      const access = leagueId ? user.getLeagueAccess(leagueId) : null;
      return {
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        hasPaid: user.hasPaid,
        createdAt: user.createdAt,
        leagueId: leagueId || null,
        leagueAccessStatus: access?.status || 'not_requested',
        requestedAt: access?.requestedAt || null,
        approvedAt: access?.approvedAt || null,
        participatesInLeague: leagueId ? user.leagues.includes(leagueId) : false
      };
    });

    res.json({ success: true, leagueId: leagueId || null, users: mappedUsers });
  } catch (error) {
    console.error('❌ Erro ao buscar usuários:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários.' });
  }
});

/**
 * @route    PUT /api/admin/approve-user/:id
 * @desc     Aprova manualmente o pagamento de um usuário
 */
router.put('/approve-user/:id', protect, admin, async (req, res) => {
  try {
    const leagueId = String(req.body?.leagueId || req.query?.leagueId || '').trim();
    if (!leagueId) {
      return res.status(400).json({ success: false, message: 'leagueId é obrigatório para aprovar um usuário.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    await user.approveLeagueAccess(leagueId, req.user._id);

    console.log(`💰 Usuário aprovado na liga ${leagueId}: ${user.email}`);
    res.json({
      success: true,
      leagueId,
      message: `Participação de ${user.name} aprovada neste campeonato!`
    });
  } catch (error) {
    console.error('❌ Erro ao aprovar participação:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route    POST /api/admin/send
 * @desc     Envia e-mail para todos os participantes da Whitelist
 */
router.post('/send', protect, admin, upload.single('attachment'), async (req, res) => {
  try {
    const { subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ 
        success: false, 
        message: `Dados ausentes. Verifique o preenchimento.` 
      });
    }

    const docs = await AllowedEmail.find({}, 'email');
    const emailList = docs.map(d => d.email);

    if (emailList.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Whitelist vazia.' 
      });
    }

    await sendBroadcastEmail(emailList, subject, message, req.file);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.json({ 
      success: true, 
      message: `E-mails enviados para ${emailList.length} participantes!` 
    });

  } catch (error) {
    console.error('❌ Erro no broadcast:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Falha ao processar o envio.' 
    });
  }
});

module.exports = router;
