const axios = require('axios');
const fs = require('fs');

/**
 * Envia e-mail de recuperação de senha (Individual)
 */
async function sendRecoveryEmail(to, code) {
  const url = 'https://api.brevo.com/v3/smtp/email';

  await axios.post(
    url,
    {
      sender: { name: 'Bolão Copa 2026', email: 'bolaokb@gmail.com' },
      to: [{ email: to }],
      subject: 'Recuperação de senha',
      htmlContent: `
        <h2>Recuperação de senha</h2>
        <p>Use o código abaixo:</p>
        <h1>${code}</h1>
        <p>Se você não solicitou, ignore este email.</p>
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
}

/**
 * Envia e-mail para todos os participantes (Broadcast com anexo)
 */
async function sendBroadcastEmail(emails, subject, message, attachment = null) {
  const url = 'https://api.brevo.com/v3/smtp/email';

  const payload = {
    sender: { name: 'Bolão Copa 2026', email: 'bolaokb@gmail.com' },
    // Enviamos para o próprio admin e os usuários em cópia oculta (BCC) para privacidade
    to: [{ email: 'bolaokb@gmail.com' }],
    bcc: emails.map(email => ({ email: email })), 
    subject: subject,
    htmlContent: `
      <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
        ${message.replace(/\n/g, '<br>')}
      </div>
    `
  };

  // Se houver anexo, converte para Base64 (padrão Brevo)
  if (attachment && attachment.path) {
    const fileContent = fs.readFileSync(attachment.path);
    payload.attachments = [{
      content: fileContent.toString('base64'),
      name: attachment.originalname
    }];
  }

  try {
    await axios.post(url, payload, {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    console.log(`📧 Broadcast enviado para ${emails.length} destinatários.`);
  } catch (error) {
    console.error('Erro na API do Brevo:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = { 
  sendRecoveryEmail, 
  sendBroadcastEmail 
};
