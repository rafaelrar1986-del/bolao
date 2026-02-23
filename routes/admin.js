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
  try {
    const { subject, message } = req.body;

    // Validação básica
    if (!subject || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Assunto e mensagem são obrigatórios.' 
      });
    }

    // 1. Busca todos os e-mails autorizados
    const docs = await AllowedEmail.find({}, 'email');
    const emailList = docs.map(d => d.email);

    if (emailList.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Nenhum e-mail encontrado na lista de autorizados.' 
      });
    }

    // 2. Dispara o envio via Brevo API através do serviço
    // req.file conterá o anexo se ele foi enviado no formulário
    await sendBroadcastEmail(emailList, subject, message, req.file);

    // 3. LIMPEZA: Deleta o arquivo da pasta 'uploads' para não ocupar espaço
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    res.json({ 
      success: true, 
      message: `E-mails enviados com sucesso para ${emailList.length} participantes!` 
    });

  } catch (error) {
    console.error('Erro no broadcast de e-mail:', error);

    // Tenta limpar o arquivo mesmo em caso de erro para evitar lixo no servidor
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ 
      success: false, 
      message: 'Falha ao processar o envio de e-mails.' 
    });
  }
});

module.exports = router;
