const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Importações de Modelos e Serviços
const AllowedEmail = require('../models/AllowedEmail'); 
const { sendBroadcastEmail } = require('../services/emailService');
const { protect, admin } = require('../middleware/auth');

// Configuração do Multer (armazenamento temporário de anexos)
const upload = multer({ dest: 'uploads/' });

/**
 * @route   POST /api/admin/broadcast-email
 * @desc    Envia e-mail para todos os participantes da Whitelist
 * @access  Private (Admin Only)
 */
router.post('/broadcast-email', protect, admin, upload.single('attachment'), async (req, res) => {
  // 🔍 LOGS DE DIAGNÓSTICO (Acompanhe no painel do Render)
  console.log('--- NOVA REQUISIÇÃO DE BROADCAST ---');
  console.log('Headers Content-Type:', req.headers['content-type']); // Deve conter "boundary"
  console.log('Dados (req.body):', req.body); // Aqui devem aparecer assunto e mensagem
  console.log('Arquivo (req.file):', req.file ? req.file.originalname : 'Nenhum');

  try {
    const { subject, message } = req.body;

    // Se subject ou message vierem vazios, o erro 400 é disparado aqui
    if (!subject || !message) {
      return res.status(400).json({ 
        success: false, 
        message: `Dados ausentes. Recebi assunto: "${subject || 'vazio'}" e mensagem: "${message || 'vazio'}"` 
      });
    }

    // 1. Busca todos os e-mails autorizados
    const docs = await AllowedEmail.find({}, 'email');
    const emailList = docs.map(d => d.email);

    if (emailList.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Nenhum e-mail encontrado na lista de autorizados (Whitelist vazia).' 
      });
    }

    // 2. Dispara o envio via serviço Brevo
    await sendBroadcastEmail(emailList, subject, message, req.file);

    // 3. LIMPEZA: Remove o arquivo temporário após o envio
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.json({ 
      success: true, 
      message: `E-mails enviados com sucesso para ${emailList.length} participantes!` 
    });

  } catch (error) {
    console.error('❌ Erro no processamento do broadcast:', error);

    // Garante a limpeza do arquivo mesmo em caso de falha no envio
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }

    res.status(500).json({ 
      success: false, 
      message: error.message || 'Falha ao processar o envio de e-mails.' 
    });
  }
});

module.exports = router;
