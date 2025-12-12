const express = require('express');
const bcrypt = require('bcryptjs'); // (usado no modelo se passwordVersion=1)
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // (fallback usado no modelo)
const User = require('../models/User');
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
// SISTEMA DE AUTENTICAÇÃO ROBUSTO
// ======================
const authenticateUser = async (email, password) => {
  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return { success: false, error: 'USER_NOT_FOUND' };
    }

    // método comparePassword do modelo já lida com bcrypt/crypto e lock
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
// 📝 REGISTRO DE USUÁRIO
// ======================
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validar campos obrigatórios
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nome, email e senha são obrigatórios'
      });
    }

    // Validar formato do email
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de email inválido'
      });
    }

    // Validar senha
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Senha deve ter pelo menos 6 caracteres'
      });
    }

    // Verificar se email já existe
    const userExists = await User.findOne({ email: email.toLowerCase().trim() });
    if (userExists) {
      return res.status(409).json({
        success: false,
        message: 'Email já cadastrado'
      });
    }

    // Criar usuário (o pre-save do modelo faz o hash)
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password
      // isAdmin permanece false por padrão; ajuste no banco se necessário
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,  // 👈 IMPORTANTE
        createdAt: user.createdAt
      },
      token
    });
  } catch (error) {
    console.error('❌ ERRO NO REGISTRO:', error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Email já cadastrado'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ======================
// 🔐 LOGIN DE USUÁRIO
// ======================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validar campos obrigatórios
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email e senha são obrigatórios'
      });
    }

    const authResult = await authenticateUser(email, password);

    if (!authResult.success) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
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
        isAdmin: user.isAdmin,  // 👈 IMPORTANTE
        createdAt: user.createdAt
      },
      token
    });
  } catch (error) {
    console.error('❌ ERRO NO LOGIN:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ======================
// 👑 ROTA TEMPORÁRIA: Tornar usuário admin (opcional)
// ======================
router.post('/make-admin', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      { $set: { isAdmin: true } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    res.json({
      success: true,
      message: `Usuário ${user.name} agora é administrador!`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Erro ao tornar admin:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

// ======================
// 👤 OBTER DADOS DO USUÁRIO LOGADO (/me)
// ======================
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id); // req.user vem do middleware protect

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,   // 👈 IMPORTANTE
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('❌ ERRO NO /ME:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar dados do usuário'
    });
  }
});

// ======================
// 🌐 ROTAS ADICIONAIS (opcional / mantidas para compatibilidade)
// ======================
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: '✅ Rotas de autenticação ativas',
    timestamp: new Date().toISOString()
  });
});

router.get('/test', protect, (req, res) => {
  res.json({
    success: true,
    message: '🔒 Acesso com token OK',
    userId: req.user?._id || null,
    timestamp: new Date().toISOString()
  });
});



// ======================
// RECUPERAÇÃO DE SENHA
// ======================

// 4 dígitos
function generateCode() { return Math.floor(1000 + Math.random()*9000).toString(); }

// Solicitar código
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success:false, message:'Email não encontrado' });
    user.recoveryCode = generateCode();
    await user.save();
    res.json({ success:true, message:'Código gerado', code: user.recoveryCode });
  } catch(e){
    res.status(500).json({ success:false, message:'Erro interno' });
  }
});

// Resetar senha
router.post('/reset-password', async (req, res) => {
  try {
    const { email, recoveryCode, newPassword } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.recoveryCode !== recoveryCode)
      return res.status(400).json({ success:false, message:'Código inválido' });
    const bcrypt = require('bcryptjs');
    user.password = await bcrypt.hash(newPassword, 10);
    user.recoveryCode = null;
    await user.save();
    res.json({ success:true, message:'Senha alterada' });
  } catch(e){
    res.status(500).json({ success:false, message:'Erro interno' });
  }
});

module.exports = router;
