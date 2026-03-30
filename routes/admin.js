const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Importações de Modelos e Serviços
const AllowedEmail = require('../models/AllowedEmail'); 
const User = require('../models/User'); // ✅ IMPORTANTE: Importar o model de Usuário
const { sendBroadcastEmail } = require('../services/emailService');
const { protect, admin } = require('../middleware/auth');

// Configuração do Multer (armazenamento temporário de anexos)
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // Limite de 10MB
});

/**
 * @route   GET /api/admin/users
 * @desc    Lista todos os usuários registrados para gestão de pagamentos
 * @access  Private (Admin Only)
 */
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar usuários.' });
  }
});

/**
 * @route   PUT /api/admin/approve-user/:id
 * @desc    Aprova manualmente o pagamento de um usuário (hasPaid: true)
 * @access  Private (Admin Only)
 */
router.put('/approve-user/:id', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    user.hasPaid = true; // ✅ Ativa o acesso do usuário
    await user.save();

    console.log(`💰 Usuário aprovado: ${user.email}`);
    res.json({ success: true, message: `Pagamento de ${user.name} aprovado!` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   POST /api/admin/send-broadcast
 * @desc    Envia e-mail para todos os participantes da Whitelist
 * @access  Private (Admin Only)
 */
router.post('/send', protect, admin, upload.single('attachment'), async (req, res) => {
  console.log('--- NOVA REQUISIÇÃO DE BROADCAST ---');
  
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
      console.log(`✅ Arquivo removido: ${req.file.path}`);
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
