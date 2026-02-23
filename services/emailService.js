const axios = require('axios');
const fs = require('fs');

/**
 * Envia e-mail de recuperação de senha (Individual)
 */
async function sendRecoveryEmail(to, code) {
  const url = 'https://api.brevo.com/v3/smtp/email';

  try {
    await axios.post(
      url,
      {
        sender: { name: 'Bolão Copa 2026', email: 'bolaokb@gmail.com' },
        to: [{ email: to }],
        subject: 'Recuperação de senha',
        htmlContent: `
          <div style="font-family: sans-serif;">
            <h2>Recuperação de senha</h2>
            <p>Use o código abaixo para redefinir sua senha:</p>
            <h1 style="color: #2ecc71;">${code}</h1>
            <p>Se você não solicitou este código, por favor ignore este e-mail.</p>
          </div>
        `
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('📧 Email enviado via Brevo API para', to);
  } catch (error) {
    console.error('Erro ao enviar recuperação:', error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Envia e-mail para todos os participantes (Broadcast com anexo)
 */
async function sendBroadcastEmail(emails, subject, message, attachment = null) {
  const url = 'https://api.brevo.com/v3/smtp/email';

  // Estrutura base do payload conforme documentação Brevo
  const payload = {
    sender: { name: 'Bolão Copa 2026', email: 'bolaokb@gmail.com' },
    // Enviamos 'to' para o admin para evitar falhas de entrega se o BCC estiver vazio
    to: [{ email: 'bolaokb@gmail.com' }],
    // Lista de usuários em Cópia Oculta (BCC)
    bcc: emails.map(email => ({ email: email })), 
    subject: subject,
    htmlContent: `
      <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
        ${message.replace(/\n/g, '<br>')}
      </div>
    `
  };

  // ✅ CORREÇÃO: O Brevo API v3 usa a chave 'attachment' (no singular)
  if (attachment && attachment.path) {
    try {
      const fileContent = fs.readFileSync(attachment.path);
      payload.attachment = [{
        content: fileContent.toString('base64'), // Arquivo convertido em Base64
        name: attachment.originalname // Nome que aparecerá para o usuário
      }];
    } catch (readError) {
      console.error('❌ Erro ao ler o arquivo de anexo:', readError.message);
      // Prossegue sem o anexo se houver erro na leitura para não travar o envio do texto
    }
  }

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    // Log detalhado para confirmar o sucesso na API externa
    console.log(`✅ Resposta Brevo (MessageId):`, response.data.messageId);
    console.log(`📧 Broadcast enviado para ${emails.length} destinatários.`);
    
    return response.data;
  } catch (error) {
    // Captura erros específicos da API (como limite de quota ou chave inválida)
    console.error('❌ Erro na API do Brevo:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = { 
  sendRecoveryEmail, 
  sendBroadcastEmail 
};
