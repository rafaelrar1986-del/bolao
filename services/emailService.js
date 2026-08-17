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

/**
 * 🚀 NOVA: Envia os palpites salvos para o e-mail do usuário logado
 */
async function sendBetsConfirmationEmail(to, userName, leagueName, betsHtml) {
  const url = 'https://api.brevo.com/v3/smtp/email';

  try {
    await axios.post(
      url,
      {
        sender: { name: 'Bolão Copa 2026', email: 'bolaokb@gmail.com' },
        to: [{ email: to }],
        subject: `Meus Palpites Salvos - ${leagueName}`,
        htmlContent: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
            <div style="background-color: #2c3e50; padding: 20px; text-align: center; color: #fff;">
              <h2 style="margin: 0;">Bolão Copa 2026</h2>
              <p style="margin: 5px 0 0 0; opacity: 0.8;">Confirmação de Palpites</p>
            </div>
            
            <div style="padding: 20px; border: 1px solid #eee; border-top: none;">
              <p>Olá, <strong>${userName}</strong>!</p>
              <p>Seus palpites para o torneio <strong>${leagueName}</strong> foram salvos com sucesso no sistema. Veja abaixo o seu comprovante:</p>
              
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              
              <!-- Tabela ou lista gerada dinamicamente pelo controller -->
              ${betsHtml}
              
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              
              <p style="font-size: 13px; color: #7f8c8d; text-align: center;">
                Boa sorte! Acompanhe as atualizações e o ranking em tempo real direto na nossa plataforma.
              </p>
            </div>
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
    console.log('📧 E-mail de palpites enviado via Brevo com sucesso para:', to);
  } catch (error) {
    console.error('❌ Erro ao enviar e-mail de palpites:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = { 
  sendRecoveryEmail, 
  sendBroadcastEmail,
  sendBetsConfirmationEmail // <-- Exportando a nova função
};
