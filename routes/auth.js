const { sendRecoveryEmail } = require('../services/emailService');
const express = require('express');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); 
const axios = require('axios');
const User = require('../models/User');
const Settings = require('../models/Settings');
const AllowedEmail = require('../models/AllowedEmail');
const { protect, isUserPaidForLeague } = require('../middleware/auth');

const router = express.Router();

// ======================
// VALIDAÇÕES
// ======================
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// ======================
// GERAR TOKEN JWT
// ======================
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// ======================
// SISTEMA DE AUTENTICAÇÃO
// ======================
const authenticateUser = async (email, password) => {
  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return { success: false, error: 'USER_NOT_FOUND' };
    }

    const isPasswordValid = await user.comparePassword(password);

    if (isPasswordValid) {
      return { success: true, user };
    } else {
      return { success: false, error: 'INVALID_CREDENTIALS' };
    }
  } catch (error) {
    console.error('❌ Erro na autenticação:', error);
    return { success: false, error: 'AUTH_ERROR' };
  }
};

const normalizeGoogleEmail = (email) => String(email || '').toLowerCase().trim();

const verifyGoogleCredential = async (credential) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    const error = new Error('Login Google não configurado no servidor');
    error.statusCode = 503;
    throw error;
  }

  const response = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
    params: { id_token: credential },
    timeout: 8000
  });
  const profile = response.data || {};
  const issuer = String(profile.iss || '');
  const emailVerified = profile.email_verified === true || profile.email_verified === 'true';

  if (
    !profile.sub ||
    profile.aud !== process.env.GOOGLE_CLIENT_ID ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(issuer) ||
    !emailVerified ||
    !isValidEmail(profile.email)
  ) {
    const error = new Error('Credencial Google inválida');
    error.statusCode = 401;
    throw error;
  }

  return profile;
};

router.get('/google-config', (req, res) => {
  res.json({
    success: true,
    enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
    clientId: process.env.GOOGLE_CLIENT_ID || null
  });
});

router.post('/google', async (req, res) => {
  try {
    const credential = String(req.body?.credential || '').trim();
    if (!credential) {
      return res.status(400).json({ success: false, message: 'Credencial Google não informada' });
    }

    const profile = await verifyGoogleCredential(credential);
    const email = normalizeGoogleEmail(profile.email);
    let user = await User.findOne({
      $or: [{ googleId: profile.sub }, { email }]
    });

    if (!user) {
      const isAllowed = await AllowedEmail.findOne({ email });
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          message: 'Acesso restrito: este e-mail não foi convidado para o bolão.'
        });
      }

      user = await User.create({
        name: String(profile.name || email.split('@')[0]).trim().slice(0, 50),
        email,
        googleId: profile.sub,
        // A senha aleatória preserva o schema e mantém o login Google separado
        // do login por email/senha já existente.
        password: crypto.randomBytes(32).toString('hex'),
        avatar: profile.picture || null
      });
    } else {
      if (!user.googleId) user.googleId = profile.sub;
      if (!user.avatar && profile.picture) user.avatar = profile.picture;
      user.lastLogin = new Date();
      await user.save();
    }

    const token = generateToken(user._id);
    return res.json({
      success: true,
      message: 'Login Google realizado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        hasPaid: user.hasPaid,
        paidLeagues: Array.isArray(user.paidLeagues) ? user.paidLeagues : [],
        createdAt: user.createdAt,
        avatar: user.avatar || null
      },
      token
    });
  } catch (error) {
    console.error('❌ ERRO NO LOGIN GOOGLE:', error);
    const statusCode = Number(error?.statusCode) || 401;
    return res.status(statusCode).json({
      success: false,
      message: statusCode === 503
        ? 'Login Google ainda não foi configurado no servidor'
        : 'Não foi possível validar a conta Google'
    });
  }
});

// ======================
// 📝 REGISTRO COM WHITELIST (CORRIGIDO)
// ======================
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Nome, email e senha são obrigatórios' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Formato de email inválido' });
    }

    const isAllowed = await AllowedEmail.findOne({ email: normalizedEmail });
    if (!isAllowed) {
      console.warn(`🛑 Tentativa de registro negada (fora da lista): ${normalizedEmail}`);
      return res.status(403).json({
        success: false,
        message: 'Acesso restrito: este e-mail não foi convidado para o bolão.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Senha deve ter pelo menos 6 caracteres' });
    }

    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(409).json({ success: false, message: 'Email já cadastrado' });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        hasPaid: user.hasPaid,
        paidLeagues: Array.isArray(user.paidLeagues) ? user.paidLeagues : [],
        createdAt: user.createdAt,
        avatar: user.avatar || null
      },
      token
    });
  } catch (error) {
    console.error('❌ ERRO NO REGISTRO:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// ======================
// 🔐 LOGIN DE USUÁRIO (CORRIGIDO)
// ======================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    const authResult = await authenticateUser(email, password);

    if (!authResult.success) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    }

    const user = authResult.user;
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login realizado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        hasPaid: user.hasPaid,
        paidLeagues: Array.isArray(user.paidLeagues) ? user.paidLeagues : [],
        createdAt: user.createdAt,
        avatar: user.avatar || null
      },
      token
    });
  } catch (error) {
    console.error('❌ ERRO NO LOGIN:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// ======================
// 🛡️ GERENCIAR WHITELIST
// ======================

router.post('/whitelist', protect, async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Acesso negado: apenas administradores' });
    }

    const { email, label } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'E-mail é obrigatório' });

    const exists = await AllowedEmail.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ success: false, message: 'E-mail já está na lista' });

    await AllowedEmail.create({ 
      email: email.toLowerCase().trim(), 
      label: label || 'Convidado',
      addedBy: req.user._id 
    });

    res.json({ success: true, message: `E-mail ${email} autorizado com sucesso!` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao adicionar e-mail' });
  }
});

router.get('/whitelist', protect, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ success: false });
    const list = await AllowedEmail.find().sort({ createdAt: -1 });
    res.json({ success: true, emails: list });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ======================
// 👤 PERFIL /ME (CRUCIAL PARA O PAYWALL)
// ======================
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });

    const leagueId = req.query?.leagueId != null
      ? String(req.query.leagueId).trim()
      : '';
    const currentLeaguePaid = user.isAdmin
      ? true
      : (leagueId ? isUserPaidForLeague(user, leagueId) : false);

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        hasPaid: user.hasPaid,
        paidLeagues: Array.isArray(user.paidLeagues) ? user.paidLeagues : [],
        leaguePaymentRequests: Array.isArray(user.leaguePaymentRequests) ? user.leaguePaymentRequests : [],
        currentLeagueId: leagueId || null,
        currentLeaguePaid,
        currentLeaguePaymentRequired: leagueId
          ? ((await Settings.findById(leagueId).select('payment.required').lean())?.payment?.required !== false)
          : false,
        createdAt: user.createdAt,
        avatar: user.avatar || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar dados' });
  }
});

// ======================
// 💰 SOLICITAR ENTRADA/PAGAMENTO DE UMA LIGA
// ======================
router.post('/league-payment-request', protect, async (req, res) => {
  try {
    const leagueId = req.body?.leagueId != null
      ? String(req.body.leagueId).trim()
      : '';

    if (!leagueId) {
      return res.status(400).json({
        success: false,
        message: 'leagueId é obrigatório.'
      });
    }

    const settings = await Settings.findById(leagueId).lean();
    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Campeonato não encontrado.'
      });
    }

    const requiresPayment = settings.payment?.required !== false;
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado.'
      });
    }

    // Administradores não precisam solicitar acesso.
    if (user.isAdmin) {
      return res.json({
        success: true,
        leagueId,
        requiresPayment,
        alreadyPaid: true,
        requested: false
      });
    }

    // Liga gratuita: não cria pedido de PIX. A entrada é liberada pelo próprio
    // status da liga, sem alterar o estado de pagamento.
    if (!requiresPayment) {
      const leagues = Array.isArray(user.leagues) ? user.leagues.map(String) : [];
      if (!leagues.includes(leagueId)) {
        leagues.push(leagueId);
        user.leagues = leagues;
        await user.save();
      }
      return res.json({
        success: true,
        leagueId,
        requiresPayment: false,
        alreadyPaid: false,
        requested: false,
        accessGranted: true
      });
    }

    const paidLeagues = Array.isArray(user.paidLeagues)
      ? user.paidLeagues.map(String)
      : [];

    if (paidLeagues.includes(leagueId)) {
      const leagues = Array.isArray(user.leagues) ? user.leagues.map(String) : [];
      if (!leagues.includes(leagueId)) {
        leagues.push(leagueId);
        user.leagues = leagues;
        await user.save();
      }
      return res.json({
        success: true,
        leagueId,
        requiresPayment: true,
        alreadyPaid: true,
        requested: false
      });
    }

    const requests = Array.isArray(user.leaguePaymentRequests)
      ? user.leaguePaymentRequests.map(String)
      : [];

    if (!requests.includes(leagueId)) {
      requests.push(leagueId);
      user.leaguePaymentRequests = requests;
      await user.save();
    }

    return res.json({
      success: true,
      leagueId,
      requiresPayment: true,
      alreadyPaid: false,
      requested: true
    });
  } catch (error) {
    console.error('❌ Erro ao registrar solicitação de pagamento da liga:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao registrar solicitação de pagamento.'
    });
  }
});

// ======================
// 🖼️ AVATAR DO PRÓPRIO PERFIL
// ======================
// Recebe uma imagem já reduzida pelo frontend como data URL.
// O usuário só pode alterar o próprio avatar.
router.put('/me/avatar', protect, async (req, res) => {
  try {
    const { avatar } = req.body || {};

    if (typeof avatar !== 'string' || !avatar) {
      return res.status(400).json({
        success: false,
        message: 'Imagem de perfil não informada'
      });
    }

    // Aceita somente imagens em data URL.
    const match = avatar.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      return res.status(400).json({
        success: false,
        message: 'Formato de imagem inválido'
      });
    }

    // Limite de 1,5 MB para a representação final armazenada.
    if (Buffer.byteLength(avatar, 'utf8') > 1.5 * 1024 * 1024) {
      return res.status(413).json({
        success: false,
        message: 'A imagem final é muito grande'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { avatar } },
      { new: true, runValidators: true }
    ).select('_id name avatar');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Foto de perfil atualizada',
      user: {
        _id: user._id,
        name: user.name,
        avatar: user.avatar || null
      }
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar avatar:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao atualizar foto de perfil'
    });
  }
});

// ======================
// RECUPERAÇÃO DE SENHA
// ======================
function generateCode() { return Math.floor(1000 + Math.random()*9000).toString(); }

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'Email não encontrado' });

    const code = generateCode();
    user.recoveryCode = code;
    await user.save();
    await sendRecoveryEmail(email, code);

    res.json({ success: true, message: 'Código enviado para o email' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao enviar email' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, recoveryCode, newPassword } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.recoveryCode !== recoveryCode) {
      return res.status(400).json({ success: false, message: 'Código inválido' });
    }
    user.password = newPassword;
    user.recoveryCode = null;
    await user.save();
    res.json({ success: true, message: 'Senha alterada com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

module.exports = router;
