const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Gerar token JWT
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// 📝 REGISTRO DE USUÁRIO
router.post('/register', async (req, res) => {
  try {
    console.log('🔍 REGISTER - Body recebido:', req.body);
    
    const { name, email, password } = req.body;

    // Validar campos
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Todos os campos são obrigatórios'
      });
    }

    // Verificar se email já existe
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'Email já cadastrado'
      });
    }

    // Criar hash da senha
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Criar usuário
    console.log('👤 Criando usuário...');
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword
    });

    console.log('✅ Usuário criado:', user.email);

    res.status(201).json({
      success: true,
      message: 'Usuário criado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      },
      token: generateToken(user._id)
    });

  } catch (error) {
    console.error('❌ ERRO NO REGISTRO:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro: ' + error.message
    });
  }
});

// 🔐 LOGIN DE USUÁRIO
router.post('/login', async (req, res) => {
  try {
    console.log('🔐 LOGIN - Body recebido:', req.body);
    
    const { email, password } = req.body;

    // Validar campos
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email e senha são obrigatórios'
      });
    }

    // Buscar usuário
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    
    if (!user) {
      console.log('❌ Usuário não encontrado:', email);
      return res.status(401).json({
        success: false,
        message: 'Email ou senha inválidos'
      });
    }

    // Verificar senha
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log('❌ Senha inválida para:', email);
      return res.status(401).json({
        success: false,
        message: 'Email ou senha inválidos'
      });
    }

    console.log('✅ Login realizado:', user.email);
    
    res.json({
      success: true,
      message: 'Login realizado com sucesso!',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt
      },
      token: generateToken(user._id)
    });

  } catch (error) {
    console.error('❌ ERRO NO LOGIN:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro interno: ' + error.message
    });
  }
});

// 👤 OBTER DADOS DO USUÁRIO LOGADO (ROTA QUE ESTAVA FALTANDO!)
router.get('/me', protect, async (req, res) => {
  try {
    console.log('📋 ME - Buscando dados do usuário:', req.user._id);
    
    res.json({
      success: true,
      user: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        createdAt: req.user.createdAt
      }
    });

  } catch (error) {
    console.error('❌ ERRO NO /ME:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar dados do usuário'
    });
  }
});

// 👤 PERFIL DO USUÁRIO (PROTEGIDO)
router.get('/profile', protect, async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Perfil do usuário',
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        createdAt: req.user.createdAt
      }
    });
  } catch (error) {
    console.error('❌ ERRO NO PERFIL:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro: ' + error.message
    });
  }
});

// 🌐 ROTA DE STATUS (PÚBLICA)
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'API de autenticação online!',
    timestamp: new Date().toISOString(),
    routes: [
      'POST /api/auth/register',
      'POST /api/auth/login', 
      'GET  /api/auth/me',
      'GET  /api/auth/profile',
      'GET  /api/auth/status'
    ]
  });
});

// 🧪 ROTA DE TESTE (PROTEGIDA)
router.get('/test', protect, (req, res) => {
  res.json({
    success: true,
    message: 'Rota protegida funcionando!',
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email
    }
  });
});

module.exports = router;
