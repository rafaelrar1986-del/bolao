const { sendRecoveryEmail } = require('../services/emailService');
const express = require('express');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); 
const User = require('../models/User');
const AllowedEmail = require('../models/AllowedEmail'); // 👈 IMPORTADO
const { protect } = require('../middleware/auth');

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

// ======================
// 📝 REGISTRO COM WHITELIST (ATUALIZADO)
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

    // 🛡️ TRAVA DE SEGURANÇA: CONSULTA WHITELIST NO BANCO
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
        createdAt: user.createdAt
      },
      token
    });
  } catch (error) {
    console.error('❌ ERRO NO REGISTRO:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// ======================
// 🔐 LOGIN DE USUÁRIO
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
        createdAt: user.createdAt
      },
      token
    });
  } catch (error) {
    console.error('❌ ERRO NO LOGIN:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// ======================
// 🛡️ GERENCIAR WHITELIST (NOVO)
// ======================

// Adicionar e-mail à lista (Apenas Admin)
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

// Listar e-mails da whitelist (Apenas Admin)
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
// 👤 OUTRAS ROTAS (Padrão)
// ======================

router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar dados' });
  }
});

router.post('/make-admin', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      { $set: { isAdmin: true } },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: 'Não encontrado' });
    res.json({ success: true, message: 'Admin atualizado!' });
  } catch (error) {
    res.status(500).json({ success: false });
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
