const axios = require('axios');

async function sendRecoveryEmail(to, code) {
  const url = 'https://api.brevo.com/v3/smtp/email';

  await axios.post(
    url,
    {
      sender: {
        name: 'Bolão Copa 2026',
        email: 'no-reply@bolao.com'
      },
      to: [
        { email: to }
      ],
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

module.exports = { sendRecoveryEmail };
