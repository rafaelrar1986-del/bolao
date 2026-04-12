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
    // Buscamos os campos necessários, incluindo o hasPaid que estava faltando antes
    const users = await User.find({}, 'name email isAdmin hasPaid createdAt').sort({ createdAt: -1 });
    
    // IMPORTANTE: O frontend espera um objeto com a propriedade "users"
    res.json({
      success: true,
      users: users 
    });
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
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    user.hasPaid = true; 
    await user.save();

    console.log(`💰 Usuário aprovado: ${user.email}`);
    res.json({ success: true, message: `Pagamento de ${user.name} aprovado!` });
  } catch (error) {
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
