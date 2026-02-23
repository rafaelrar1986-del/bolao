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
// Certifique-se de que a pasta 'uploads' existe ou o Multer a criará
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // Limite de 10MB por segurança
});

/**
 * @route   POST /api/email-broadcast/send
 * @desc    Envia e-mail para todos os participantes da Whitelist
 * @access  Private (Admin Only)
 */
router.post('/send', protect, admin, upload.single('attachment'), async (req, res) => {
  // 🔍 LOGS DE DIAGNÓSTICO (Acompanhe no painel do Render)
  console.log('--- NOVA REQUISIÇÃO DE BROADCAST ---');
  console.log('Dados Texto (req.body):', req.body); 
  console.log('Arquivo (req.file):', req.file ? req.file.originalname : 'Nenhum');

  try {
    const { subject, message } = req.body;

    // Validação de presença de dados após o processamento do Multer
    if (!subject || !message) {
      return res.status(400).json({ 
        success: false, 
        message: `Dados ausentes. Verifique se o formulário foi preenchido corretamente.` 
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
    // Passamos a lista de e-mails, assunto, mensagem e o objeto do arquivo
    await sendBroadcastEmail(emailList, subject, message, req.file);

    // 3. LIMPEZA: Remove o arquivo temporário após o envio para economizar espaço no disco
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log(`✅ Arquivo temporário removido: ${req.file.path}`);
    }

    res.json({ 
      success: true, 
      message: `E-mails enviados com sucesso para ${emailList.length} participantes!` 
    });

  } catch (error) {
    console.error('❌ Erro no processamento do broadcast:', error);

    // Garante a limpeza do arquivo mesmo em caso de falha no envio para evitar "lixo"
    if (req.file && fs.existsSync(req.file.path)) {
      try { 
        fs.unlinkSync(req.file.path); 
        console.log('🧹 Limpeza de segurança executada após erro.');
      } catch (e) {
        console.error('Erro ao tentar deletar arquivo após falha:', e);
      }
    }

    res.status(500).json({ 
      success: false, 
      message: error.message || 'Falha ao processar o envio de e-mails.' 
    });
  }
});

module.exports = router;
