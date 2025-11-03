const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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

    console.log('🔐 Tentando autenticar usuário:', user.email);

    // Usar o método comparePassword do modelo User (que já tem fallback)
    const isPasswordValid = await user.comparePassword(password);
    
    if (isPasswordValid) {
      console.log('✅ Autenticação bem-sucedida');
      return { success: true, user };
    } else {
      console.log('❌ Senha inválida');
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

    console.log('👤 Criando novo usuário:', email);

    // Criar usuário - O MODELO User vai automaticamente escolher o melhor método de hash
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: password // O pre-save do modelo vai fazer o hash
    });

    console.log('✅ Usuário criado com sucesso');

    // Gerar token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      },
      token: token
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

    console.log(`🔐 Tentativa de login para: ${email}`);

    // Usar sistema de autenticação robusto
    const authResult = await authenticateUser(email, password);

    if (!authResult.success) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    // Login bem-sucedido
    const user = authResult.user;
    const token = generateToken(user._id);

    console.log(`✅ Login bem-sucedido para: ${user.email}`);

    res.json({
      success: true,
      message: 'Login realizado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      },
      token: token
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
// 👤 OBTER DADOS DO USUÁRIO LOGADO
// ======================
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
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
// 🌐 ROTAS ADICIONAIS (manter as existentes)
// ======================
router.get('/profile', protect, async (req, res) => {
  // ... código existente
});

router.put('/profile', protect, async (req, res) => {
  // ... código existente  
});

router.get('/status', (req, res) => {
  // ... código existente
});

router.get('/test', protect, (req, res) => {
  // ... código existente
});

module.exports = router;
