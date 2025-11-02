const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
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

    // Criar usuário
    console.log('👤 Criando usuário...');
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: password
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

    // Verificar usuário e senha
    if (user && (await user.comparePassword(password))) {
      console.log('✅ Login realizado:', user.email);
      
      res.json({
        success: true,
        message: 'Login realizado com sucesso!',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          isAdmin: user.isAdmin
        },
        token: generateToken(user._id)
      });
    } else {
      console.log('❌ Login falhou para:', email);
      res.status(401).json({
        success: false,
        message: 'Email ou senha inválidos'
      });
    }
  } catch (error) {
    console.error('❌ ERRO NO LOGIN:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro interno: ' + error.message
    });
  }
});

// 👤 PERFIL DO USUÁRIO (PROTEGIDO)
router.get('/profile', async (req, res) => {
  try {
    // Por enquanto retorna mensagem simples
    // Depois implementamos a verificação do token
    res.json({
      success: true,
      message: 'Rota de perfil - implementar verificação de token depois'
    });
  } catch (error) {
    console.error('❌ ERRO NO PERFIL:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro: ' + error.message
    });
  }
});

// 🌐 ROTA DE TESTE
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Rotas de autenticação funcionando!',
    routes: [
      'POST /api/auth/register',
      'POST /api/auth/login', 
      'GET  /api/auth/profile',
      'GET  /api/auth/test'
    ]
  });
});

module.exports = router;