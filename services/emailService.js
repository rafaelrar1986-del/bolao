const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false, // 587 = false
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendRecoveryEmail(to, code) {
  await transporter.sendMail({
    from: `"Bolão Copa 2026" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Recuperação de senha',
    html: `
      <h2>Recuperação de senha</h2>
      <p>Seu código é:</p>
      <h1>${code}</h1>
      <p>Se você não solicitou, ignore este email.</p>
    `
  });

  console.log('📧 Email enviado com sucesso para', to);
}

module.exports = { sendRecoveryEmail };
